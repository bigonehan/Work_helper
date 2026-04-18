import { Effect } from "effect";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  destroyProjectTmuxSession,
  getProjectTaskSnapshot,
  submitProjectTaskToTmux,
  waitForProjectTask,
} from "./projectManager";
import { ProjectTag, createProjectLayerForType } from "./server/artifacts";
import {
  buildJobFilePaths,
  buildProjectMetadataPath,
  formatJobTimestamp,
  getConfig,
  getConfigValue,
  inferProjectSpec,
  toSnakeCaseSummary,
} from "./server/project";
import type {
  ManagerAttemptRecord,
  ManagerDecision,
  ManagerRequest,
  ManagerResult,
  ManagerTaskAssessment,
  ManagerVerificationResult,
  ProjectArtifactService,
  ProjectTaskHandle,
  ProjectTaskSnapshot,
  ProjectTmuxTaskOptions,
} from "./types";

interface ManagerTaskRunner {
  readonly submitTask: (options: ProjectTmuxTaskOptions) => Promise<ProjectTaskHandle>;
  readonly waitForTask: (projectId: string, taskId: string) => Promise<ProjectTaskSnapshot>;
  readonly getTaskSnapshot: (projectId: string, taskId: string) => Promise<ProjectTaskSnapshot | null>;
  readonly destroySession: (projectId: string) => Promise<void>;
}

const defaultTaskRunner: ManagerTaskRunner = {
  submitTask: (options) => Effect.runPromise(submitProjectTaskToTmux(options)),
  waitForTask: (projectId, taskId) => Effect.runPromise(waitForProjectTask(projectId, taskId)),
  getTaskSnapshot: (projectId, taskId) => Effect.runPromise(getProjectTaskSnapshot(projectId, taskId)),
  destroySession: (projectId) => Effect.runPromise(destroyProjectTmuxSession(projectId)),
};

const defaultOptions = {
  maxAttempts: 3,
} as const;
const managerPollIntervalMs = 10;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const providerCompletedPattern = /\b(completed|complete|done|finished|success)\b|완료/iu;

interface AttemptArtifacts {
  readonly timestamp: string;
  readonly summary: string;
  readonly projectFilePath: string;
  readonly jobFilePath: string;
  readonly draftFilePath: string;
}

function buildTaskId(projectId: string, attempt: number, kind: "implement" | "verify"): string {
  return `${sanitize(projectId)}-attempt-${attempt}-${kind}`;
}

function sanitize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "default";
}

function buildImplementationPrompt(
  request: string,
  artifacts: AttemptArtifacts,
  policies: ManagerPromptPolicies,
): string {
  return [
    "You are executing an implementation task through tmux.",
    "Implement the requested code changes using the draft file as the source of truth.",
    "Do not perform the final verification run in this session.",
    "Prefer direct file edits or shell commands.",
    "Return exactly COMPLETED on a single line only after the code changes are finished.",
    "",
    `Project metadata: ${artifacts.projectFilePath}`,
    `Job document: ${artifacts.jobFilePath}`,
    `Draft document: ${artifacts.draftFilePath}`,
    `Policy: ${policies.testFirstPolicy}`,
    `User request: ${request}`,
  ].join("\n");
}

function buildVerificationPrompt(
  request: string,
  artifacts: AttemptArtifacts,
  policies: ManagerPromptPolicies,
): string {
  return [
    "You are executing a verification task through tmux.",
    "Verify the implementation described by the draft file.",
    "Run the relevant tests and app checks without changing the requested feature scope.",
    "For UI-related work, use Playwright to open the browser and check the mobile layout for visual breakage.",
    "Return exactly COMPLETED on a single line only after verification is finished.",
    "",
    `Project metadata: ${artifacts.projectFilePath}`,
    `Job document: ${artifacts.jobFilePath}`,
    `Draft document: ${artifacts.draftFilePath}`,
    `Policy: ${policies.uiMobileCheck}`,
    `User request: ${request}`,
  ].join("\n");
}

interface ManagerPromptPolicies {
  readonly testFirstPolicy: string;
  readonly uiMobileCheck: string;
}

function classifyManagerDecision(
  snapshot: ProjectTaskSnapshot,
  providerClaimedCompletion: boolean,
  verification: ManagerVerificationResult | null,
  isLastAttempt: boolean,
): { decision: ManagerDecision; reason: string } {
  if (snapshot.status !== "completed") {
    return {
      decision: isLastAttempt ? "halt" : "retry",
      reason: snapshot.errorReason ?? `tmux task ended with status ${snapshot.status}`,
    };
  }

  if (verification?.ok) {
    return {
      decision: "complete",
      reason: verification.summary,
    };
  }

  if (!providerClaimedCompletion) {
    return {
      decision: isLastAttempt ? "halt" : "retry",
      reason: "Provider did not explicitly report completion.",
    };
  }

  if (verification && !verification.ok) {
    return {
      decision: isLastAttempt ? "halt" : "retry",
      reason: verification.summary,
    };
  }

  return {
    decision: "complete",
    reason: verification?.summary ?? "Provider reported completion and verification passed.",
  };
}

async function dispatchManagerAttemptToTmux(
  runner: ManagerTaskRunner,
  request: ManagerRequest,
  taskId: string,
  prompt: string,
): Promise<{ snapshot: ProjectTaskSnapshot; taskAssessment: ManagerTaskAssessment | null }> {
  await runner.submitTask({
    projectId: request.projectId,
    taskId,
    provider: request.provider,
    prompt,
    workspaceDir: request.workspaceDir,
    debugLogging: request.debugLogging,
    totalTimeoutMs: request.totalTimeoutMs,
    firstOutputTimeoutMs: request.firstOutputTimeoutMs,
    responseTimeoutMs: request.responseTimeoutMs,
    pollIntervalMs: request.pollIntervalMs,
    stableAnswerWindowMs: request.stableAnswerWindowMs,
    preserveWindowOnFailure: request.preserveWindowOnFailure,
  });

  return monitorManagerTask(runner, request.projectId, taskId);
}

function didProviderClaimCompletion(answer: string | null): boolean {
  if (!answer) {
    return false;
  }

  return providerCompletedPattern.test(answer);
}

export const handleManagerRequest = async (
  input: ManagerRequest,
  runner: ManagerTaskRunner = defaultTaskRunner,
): Promise<ManagerResult> => {
  return Effect.runPromise(handleManagerRequestEffect(input, runner).pipe(Effect.provide(resolveProjectLayer(input))));
};

export const handleManagerRequestEffect = (
  input: ManagerRequest,
  runner: ManagerTaskRunner = defaultTaskRunner,
) =>
  Effect.gen(function* () {
    const artifactService = yield* ProjectTag;
    return yield* Effect.promise(() => handleManagerRequestWithProject(input, runner, artifactService));
  });

const handleManagerRequestWithProject = async (
  input: ManagerRequest,
  runner: ManagerTaskRunner,
  artifactService: ProjectArtifactService,
): Promise<ManagerResult> => {
  const request: ManagerRequest = { ...defaultOptions, ...input };
  const attempts: ManagerAttemptRecord[] = [];
  const policies = await loadPromptPolicies();

  await request.prepareWorkspace?.();
  await runner.destroySession(request.projectId);

  try {
    for (let attempt = 1; attempt <= (request.maxAttempts ?? defaultOptions.maxAttempts); attempt += 1) {
      const artifacts = await ensureAttemptArtifacts(request, attempt, artifactService);
      const implementationTaskId = buildTaskId(request.projectId, attempt, "implement");
      const implementationPrompt = buildImplementationPrompt(request.request, artifacts, policies);
      const implementationResult = await dispatchManagerAttemptToTmux(
        runner,
        request,
        implementationTaskId,
        implementationPrompt,
      );
      const implementationSnapshot = implementationResult.snapshot;

      if (implementationSnapshot.status !== "completed") {
        await appendJobCheckResult(artifacts.jobFilePath, implementationSnapshot.answerPreview ?? implementationSnapshot.errorReason ?? "implementation failed");
        const reason =
          implementationResult.taskAssessment?.reason ??
          implementationSnapshot.errorReason ??
          `tmux task ended with status ${implementationSnapshot.status}`;
        const record: ManagerAttemptRecord = {
          attempt,
          taskId: implementationTaskId,
          prompt: implementationPrompt,
          snapshot: implementationSnapshot,
          providerClaimedCompletion: didProviderClaimCompletion(implementationSnapshot.answerPreview),
          verification: null,
          taskAssessment: implementationResult.taskAssessment,
          decision: attempt === (request.maxAttempts ?? defaultOptions.maxAttempts) ? "halt" : "retry",
          reason,
        };
        attempts.push(record);

        if (record.decision !== "retry") {
          return {
            ok: false,
            projectId: request.projectId,
            request: request.request,
            workspaceDir: request.workspaceDir,
            provider: request.provider,
            attempts,
            decision: record.decision,
            reason,
            finalAnswer: implementationSnapshot.answerPreview,
            finalSnapshot: implementationSnapshot,
          };
        }

        continue;
      }

      const verificationTaskId = buildTaskId(request.projectId, attempt, "verify");
      const verificationPrompt = buildVerificationPrompt(request.request, artifacts, policies);
      const verificationResult = await dispatchManagerAttemptToTmux(runner, request, verificationTaskId, verificationPrompt);
      const snapshot = verificationResult.snapshot;
      const providerClaimedCompletion = didProviderClaimCompletion(snapshot.answerPreview);
      const verification =
        snapshot.status === "completed" && request.verifyCompletion
          ? await request.verifyCompletion({
              attempt,
              answer: snapshot.answerPreview,
              projectId: request.projectId,
              provider: request.provider,
              request: request.request,
              snapshot,
              workspaceDir: request.workspaceDir,
            })
          : null;
      await appendJobCheckResult(
        artifacts.jobFilePath,
        snapshot.answerPreview ?? snapshot.errorReason ?? "verification finished without message",
      );
      const { decision, reason } = classifyManagerDecision(
        snapshot,
        providerClaimedCompletion,
        verification,
        attempt === (request.maxAttempts ?? defaultOptions.maxAttempts),
      );

      const record: ManagerAttemptRecord = {
        attempt,
        taskId: verificationTaskId,
        prompt: verificationPrompt,
        snapshot,
        providerClaimedCompletion,
        verification,
        taskAssessment: verificationResult.taskAssessment,
        decision,
        reason: verificationResult.taskAssessment?.kind === "error" ? verificationResult.taskAssessment.reason : reason,
      };
      attempts.push(record);

      if (decision !== "retry") {
        return {
          ok: decision === "complete",
          projectId: request.projectId,
          request: request.request,
          workspaceDir: request.workspaceDir,
          provider: request.provider,
          attempts,
          decision,
          reason,
          finalAnswer: decision === "complete" ? "COMPLETED" : snapshot.answerPreview,
          finalSnapshot: snapshot,
        };
      }
    }

    const lastAttempt = attempts.at(-1) ?? null;
    return {
      ok: false,
      projectId: request.projectId,
      request: request.request,
      workspaceDir: request.workspaceDir,
      provider: request.provider,
      attempts,
      decision: "halt",
      reason: lastAttempt?.reason ?? "Manager exhausted all attempts.",
      finalAnswer: lastAttempt?.snapshot.answerPreview ?? null,
      finalSnapshot: lastAttempt?.snapshot ?? null,
    };
  } finally {
    await runner.destroySession(request.projectId);
  }
};

function resolveProjectLayer(request: ManagerRequest) {
  return request.projectLayer ?? createProjectLayerForType(request.projectType);
}

export const createReactTodoAppVerifier =
  (targetDir: string) =>
  async (): Promise<ManagerVerificationResult> => {
    const requiredPaths = [join(targetDir, "package.json"), join(targetDir, "src")];
    const optionalSourcePaths = [
      join(targetDir, "src", "main.tsx"),
      join(targetDir, "src", "main.jsx"),
      join(targetDir, "src", "main.ts"),
      join(targetDir, "src", "main.js"),
      join(targetDir, "src", "App.tsx"),
      join(targetDir, "src", "App.jsx"),
      join(targetDir, "src", "App.ts"),
      join(targetDir, "src", "App.js"),
    ];

    const missing: string[] = [];
    for (const path of requiredPaths) {
      try {
        await stat(path);
      } catch {
        missing.push(path);
      }
    }

    const hasAnySource = await Promise.all(
      optionalSourcePaths.map(async (path) => {
        try {
          await stat(path);
          return true;
        } catch {
          return false;
        }
      }),
    ).then((results) => results.some(Boolean));

    if (!hasAnySource) {
      missing.push(`${join(targetDir, "src")} with main/App entry`);
    }

    if (missing.length > 0) {
      return {
        ok: false,
        summary: `React app verification failed. Missing: ${missing.join(", ")}`,
      };
    }

    const entries = await readdir(targetDir);
    if (entries.length === 0) {
      return {
        ok: false,
        summary: `React app verification failed. ${targetDir} is empty.`,
      };
    }

    return {
      ok: true,
      summary: `React app sources verified in ${targetDir}.`,
    };
  };

async function loadPromptPolicies(): Promise<ManagerPromptPolicies> {
  const config = await getConfig();
  return {
    testFirstPolicy:
      getConfigValue(config, "testFirstPolicy") ?? "Write unit tests before implementation for changes and new features.",
    uiMobileCheck:
      getConfigValue(config, "uiMobileCheck") ??
      "Use Playwright to open the browser in mobile mode and check for broken layout.",
  };
}

async function ensureAttemptArtifacts(
  request: ManagerRequest,
  attempt: number,
  artifactService: ProjectArtifactService,
): Promise<AttemptArtifacts> {
  const timestamp = formatJobTimestamp(new Date(Date.now() + attempt * 60_000));
  const summary = toSafeSummary(request.request);
  const projectFilePath = buildProjectMetadataPath(request.workspaceDir);
  const filePaths = buildJobFilePaths(request.workspaceDir, timestamp, summary);

  await mkdir(join(request.workspaceDir, ".project"), { recursive: true });
  await mkdir(filePaths.jobDir, { recursive: true });
  await mkdir(join(request.workspaceDir, "evidence"), { recursive: true });
  await mkdir(filePaths.captureDir, { recursive: true });

  const artifactContext = {
    projectId: request.projectId,
    projectType: request.projectType,
    projectSpec: inferProjectSpec(request.request),
    request: request.request,
    workspaceDir: request.workspaceDir,
    timestamp,
    summary,
  } as const;

  await writeFile(projectFilePath, await artifactService.renderProjectDocument(artifactContext), "utf8");
  await writeFile(filePaths.jobFilePath, await artifactService.renderJobDocument(artifactContext), "utf8");
  await writeFile(filePaths.draftFilePath, await artifactService.renderDraftDocument(artifactContext), "utf8");

  return {
    timestamp,
    summary,
    projectFilePath,
    jobFilePath: filePaths.jobFilePath,
    draftFilePath: filePaths.draftFilePath,
  };
}

function toSafeSummary(request: string): string {
  return toSnakeCaseSummary(request).slice(0, 80).replace(/_+$/g, "") || "job";
}

async function appendJobCheckResult(jobFilePath: string, message: string): Promise<void> {
  const existing = await readFile(jobFilePath, "utf8");
  const normalized = message.trim();
  if (!normalized) {
    return;
  }

  await writeFile(jobFilePath, `${existing}\n- ${normalized}\n`, "utf8");
}

async function monitorManagerTask(
  runner: ManagerTaskRunner,
  projectId: string,
  taskId: string,
): Promise<{ snapshot: ProjectTaskSnapshot; taskAssessment: ManagerTaskAssessment | null }> {
  const finalPromise = runner.waitForTask(projectId, taskId);
  let lastAssessment: ManagerTaskAssessment | null = null;

  while (true) {
    const result = await Promise.race([
      finalPromise.then((snapshot) => ({ done: true as const, snapshot })),
      sleep(managerPollIntervalMs).then(() => ({ done: false as const })),
    ]);

    if (result.done) {
      return {
        snapshot: result.snapshot,
        taskAssessment: analyzeManagerTaskSnapshot(result.snapshot, lastAssessment),
      };
    }

    const currentSnapshot = await runner.getTaskSnapshot(projectId, taskId);
    if (currentSnapshot) {
      lastAssessment = analyzeManagerTaskSnapshot(currentSnapshot, lastAssessment);
    }
  }
}

const errorSignalPatterns = [
  /error:/iu,
  /exception/iu,
  /traceback/iu,
  /npm err!/iu,
  /command not found/iu,
  /enoent/iu,
  /syntaxerror/iu,
  /failed/iu,
];

export const analyzeManagerTaskSnapshot = (
  snapshot: ProjectTaskSnapshot,
  previousAssessment: ManagerTaskAssessment | null = null,
): ManagerTaskAssessment => {
  if (snapshot.status === "failed") {
    if (previousAssessment && (previousAssessment.kind === "error" || previousAssessment.kind === "stalled")) {
      return previousAssessment;
    }

    return {
      kind: "failed",
      reason: snapshot.errorReason ?? snapshot.lastObservation ?? "The task failed without a detailed error.",
    };
  }

  const combinedOutput = [snapshot.lastObservation, snapshot.answerPreview, snapshot.panePreview].filter(Boolean).join("\n");
  const matchingErrorPattern = errorSignalPatterns.find((pattern) => pattern.test(combinedOutput));
  if (matchingErrorPattern) {
    return {
      kind: "error",
      reason: snapshot.lastObservation || combinedOutput.trim().split("\n").slice(-1)[0] || "The task emitted error output while running.",
    };
  }

  if (snapshot.status === "running" && snapshot.stalledForMs > 30_000) {
    return {
      kind: "stalled",
      reason: `The task appears stalled for ${snapshot.stalledForMs}ms. Last observation: ${snapshot.lastObservation}`,
    };
  }

  if (snapshot.status === "running" || snapshot.status === "waiting") {
    return {
      kind: "working",
      reason: snapshot.currentAction || snapshot.lastObservation || previousAssessment?.reason || "The task is still making progress.",
    };
  }

  return previousAssessment ?? {
    kind: "working",
    reason: snapshot.lastObservation || "The task is still being monitored.",
  };
};
