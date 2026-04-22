import { Effect } from "effect";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  destroyProjectTmuxSession,
  getProjectJobSnapshot,
  submitProjectJobToTmux,
  waitForProjectJob,
} from "./projectManager";
import { MakeDraftTag, MakeJobTag, MakeProjectTag, ProjectTag, createProjectLayerForType } from "./server/artifacts";
import {
  buildJobFilePaths,
  buildUniqueTaskName,
  buildProjectMetadataPath,
  formatJobTimestamp,
  getAgentWorkflowRules,
  getConfig,
  getConfigValue,
  inferProjectSpec,
  toLimitedSnakeCase,
  toSnakeCaseSummary,
} from "./server/project";
import type {
  ManagerAttemptRecord,
  ManagerDecision,
  ManagerDraftArtifact,
  ManagerDraftExecution,
  ManagerJobAssessment,
  ManagerRequest,
  ManagerResult,
  ManagerVerificationResult,
  ProjectArtifactContext,
  ProjectJobHandle,
  ProjectJobSnapshot,
  ProjectTmuxJobOptions,
} from "./types";

interface ManagerJobRunner {
  readonly submitJob: (options: ProjectTmuxJobOptions) => Promise<ProjectJobHandle>;
  readonly waitForJob: (projectId: string, jobId: string) => Promise<ProjectJobSnapshot>;
  readonly getJobSnapshot: (projectId: string, jobId: string) => Promise<ProjectJobSnapshot | null>;
  readonly destroySession: (projectId: string) => Promise<void>;
}

interface ManagerPromptPolicies {
  readonly testFirstPolicy: string;
  readonly uiMobileCheck: string;
  readonly workflowGuide: string;
}

interface AttemptArtifacts {
  readonly timestamp: string;
  readonly summary: string;
  readonly projectFilePath: string;
  readonly jobFilePath: string;
  readonly drafts: readonly ManagerDraftArtifact[];
}

const defaultJobRunner: ManagerJobRunner = {
  submitJob: (options) => Effect.runPromise(submitProjectJobToTmux(options)),
  waitForJob: (projectId, jobId) => Effect.runPromise(waitForProjectJob(projectId, jobId)),
  getJobSnapshot: (projectId, jobId) => Effect.runPromise(getProjectJobSnapshot(projectId, jobId)),
  destroySession: (projectId) => Effect.runPromise(destroyProjectTmuxSession(projectId)),
};

const defaultOptions = {
  maxAttempts: 3,
} as const;
const managerPollIntervalMs = 10;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const providerCompletedPattern = /\b(completed|complete|done|finished|success)\b|완료/iu;

function buildJobId(projectId: string, attempt: number, kind: "build" | "check", suffix: string): string {
  return `${sanitize(projectId)}-attempt-${attempt}-${kind}-${suffix}`;
}

function sanitize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "default";
}

function buildDraftExecutionPrompt(
  artifacts: AttemptArtifacts,
  draft: ManagerDraftArtifact,
  policies: ManagerPromptPolicies,
): string {
  return [
    "You are executing a build job through tmux.",
    "Use only the assigned draft document as the implementation source of truth.",
    "Follow TDD: write or update unit tests first, then implement the code.",
    "Run the relevant unit tests inside this session and do not finish until they pass.",
    "Do not perform the final browser-level or integration-level check in this session.",
    "Return exactly COMPLETED on a single line only after implementation and unit-test pass are finished.",
    "",
    `Draft document: ${draft.path}`,
    `Draft id: ${draft.draftId}`,
    `Draft priority: ${draft.priority}`,
    `Draft kind: ${draft.kind}`,
    `Draft input: ${draft.input.join(", ") || "none"}`,
    `Draft output: ${draft.output.join(", ") || "none"}`,
    `Draft tests: ${draft.test.join(", ") || "none"}`,
    `Draft targets: ${draft.target.join(", ") || "none"}`,
    `Draft dependencies: ${draft.dependsOn.join(", ") || "none"}`,
    `Policy: ${policies.testFirstPolicy}`,
    `Workflow: ${policies.workflowGuide}`,
  ].join("\n");
}

function buildCheckPrompt(artifacts: AttemptArtifacts, policies: ManagerPromptPolicies): string {
  return [
    "You are executing a final check job through tmux.",
    "Use only the job document as the source of truth for the requested outcome.",
    "Verify whether the request described in the job document is actually fulfilled in the workspace.",
    "Use the effect_check skill guidance if it is available, and explicitly verify that the Effect TS schema, Context.Tag providers, and tagged stage-entry errors are wired correctly.",
    "When relevant, start the app or temporary server, use Playwright, simulate user actions, inspect logs or messages, and capture screenshots.",
    "Decide whether the request is complete or still needs more work based on real execution evidence.",
    "Return exactly COMPLETED on a single line only after the final check is finished.",
    "",
    `Job document: ${artifacts.jobFilePath}`,
    `Policy: ${policies.uiMobileCheck}`,
    `Workflow: ${policies.workflowGuide}`,
  ].join("\n");
}

function didProviderClaimCompletion(answer: string | null): boolean {
  if (!answer) {
    return false;
  }

  return providerCompletedPattern.test(answer);
}

function buildDraftExecutionBatches(drafts: readonly ManagerDraftArtifact[]): ManagerDraftArtifact[][] {
  const remaining = new Map(drafts.map((draft) => [draft.draftId, draft]));
  const completed = new Set<string>();
  const batches: ManagerDraftArtifact[][] = [];

  while (remaining.size > 0) {
    const ready = [...remaining.values()]
      .filter((draft) => draft.dependsOn.every((dependency) => completed.has(dependency)))
      .sort((left, right) => left.priority - right.priority || left.kind.localeCompare(right.kind) || left.draftId.localeCompare(right.draftId));
    if (ready.length === 0) {
      throw new Error(`Draft dependency cycle detected: ${[...remaining.keys()].join(", ")}`);
    }

    const nextPriority = ready[0]!.priority;
    const batch = ready.filter((draft) => draft.priority === nextPriority);
    batches.push(batch);
    for (const draft of batch) {
      remaining.delete(draft.draftId);
      completed.add(draft.draftId);
    }
  }

  return batches;
}

async function dispatchManagerJobToTmux(
  runner: ManagerJobRunner,
  request: ManagerRequest,
  jobId: string,
  prompt: string,
): Promise<{ snapshot: ProjectJobSnapshot; jobAssessment: ManagerJobAssessment | null }> {
  await runner.submitJob({
    projectId: request.projectId,
    jobId,
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

  return monitorManagerJob(runner, request.projectId, jobId);
}

async function executeDraftBatch(
  runner: ManagerJobRunner,
  request: ManagerRequest,
  attempt: number,
  artifacts: AttemptArtifacts,
  drafts: readonly ManagerDraftArtifact[],
  policies: ManagerPromptPolicies,
): Promise<ManagerDraftExecution[]> {
  const executions = await Promise.all(
    drafts.map(async (draft) => {
      const jobId = buildJobId(request.projectId, attempt, "build", draft.summary);
      const prompt = buildDraftExecutionPrompt(artifacts, draft, policies);
      const result = await dispatchManagerJobToTmux(runner, request, jobId, prompt);

      return {
        draftId: draft.draftId,
        jobId,
        priority: draft.priority,
        kind: draft.kind,
        target: draft.target,
        dependsOn: draft.dependsOn,
        snapshot: result.snapshot,
        providerClaimedCompletion: didProviderClaimCompletion(result.snapshot.answerPreview),
        jobAssessment: result.jobAssessment,
      } satisfies ManagerDraftExecution;
    }),
  );

  return executions;
}

function classifyManagerDecision(
  snapshot: ProjectJobSnapshot,
  providerClaimedCompletion: boolean,
  verification: ManagerVerificationResult | null,
  isLastAttempt: boolean,
): { decision: ManagerDecision; reason: string } {
  if (snapshot.status !== "completed") {
    return {
      decision: isLastAttempt ? "halt" : "retry",
      reason: snapshot.errorReason ?? `tmux job ended with status ${snapshot.status}`,
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
    reason: verification?.summary ?? "Provider reported completion and final check passed.",
  };
}

export const handleManagerRequest = async (
  input: ManagerRequest,
  runner: ManagerJobRunner = defaultJobRunner,
): Promise<ManagerResult> => {
  return Effect.runPromise(handleManagerRequestEffect(input, runner).pipe(Effect.provide(resolveProjectLayer(input))));
};

export const handleManagerRequestEffect = (
  input: ManagerRequest,
  runner: ManagerJobRunner = defaultJobRunner,
) =>
  Effect.gen(function* () {
    yield* ProjectTag;
    const makeProject = yield* MakeProjectTag;
    const makeJob = yield* MakeJobTag;
    const makeDraft = yield* MakeDraftTag;
    return yield* Effect.promise(() => handleManagerRequestWithProject(input, runner, makeProject, makeJob, makeDraft));
  });

const handleManagerRequestWithProject = async (
  input: ManagerRequest,
  runner: ManagerJobRunner,
  makeProjectService: { readonly makeProject: (context: ProjectArtifactContext) => Promise<string> | string },
  makeJobService: {
    readonly makeJob: (context: ProjectArtifactContext) => Promise<string> | string;
    readonly readJob: (jobFilePath: string) => Promise<string> | string;
  },
  makeDraftService: {
    readonly makeDraft: (context: ProjectArtifactContext) => Promise<readonly ManagerDraftArtifact[]> | readonly ManagerDraftArtifact[];
  },
): Promise<ManagerResult> => {
  const request: ManagerRequest = { ...defaultOptions, ...input };
  const attempts: ManagerAttemptRecord[] = [];
  const policies = await loadPromptPolicies();

  await request.prepareWorkspace?.();
  await runner.destroySession(request.projectId);

  try {
    for (let attempt = 1; attempt <= (request.maxAttempts ?? defaultOptions.maxAttempts); attempt += 1) {
      const artifacts = await ensureAttemptArtifacts(request, attempt, makeProjectService, makeJobService, makeDraftService);
      const draftExecutions: ManagerDraftExecution[] = [];
      const batches = buildDraftExecutionBatches(artifacts.drafts);

      let failedBuildExecution: ManagerDraftExecution | null = null;
      for (const batch of batches) {
        const executions = await executeDraftBatch(runner, request, attempt, artifacts, batch, policies);
        draftExecutions.push(...executions);

        for (const execution of executions) {
          await appendJobCheckResult(
            artifacts.jobFilePath,
            `[build:${execution.draftId}] ${execution.snapshot.answerPreview ?? execution.snapshot.errorReason ?? execution.snapshot.status}`,
          );

          if (execution.snapshot.status !== "completed") {
            failedBuildExecution = execution;
            break;
          }
        }

        if (failedBuildExecution) {
          break;
        }
      }

      if (failedBuildExecution) {
        const reason =
          failedBuildExecution.jobAssessment?.reason ??
          failedBuildExecution.snapshot.errorReason ??
          `tmux job ended with status ${failedBuildExecution.snapshot.status}`;
        const record: ManagerAttemptRecord = {
          attempt,
          jobId: failedBuildExecution.jobId,
          prompt: "build batch failed",
          snapshot: failedBuildExecution.snapshot,
          providerClaimedCompletion: failedBuildExecution.providerClaimedCompletion,
          verification: null,
          jobAssessment: failedBuildExecution.jobAssessment,
          decision: attempt === (request.maxAttempts ?? defaultOptions.maxAttempts) ? "halt" : "retry",
          reason,
          draftExecutions,
          checkJobId: null,
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
            finalAnswer: failedBuildExecution.snapshot.answerPreview,
            finalSnapshot: failedBuildExecution.snapshot,
          };
        }

        continue;
      }

      const checkJobId = buildJobId(request.projectId, attempt, "check", "final");
      const checkPrompt = buildCheckPrompt(artifacts, policies);
      const checkResult = await dispatchManagerJobToTmux(runner, request, checkJobId, checkPrompt);
      const snapshot = checkResult.snapshot;
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
        `[check] ${snapshot.answerPreview ?? snapshot.errorReason ?? "final check finished without message"}`,
      );
      const { decision, reason } = classifyManagerDecision(
        snapshot,
        providerClaimedCompletion,
        verification,
        attempt === (request.maxAttempts ?? defaultOptions.maxAttempts),
      );

      const record: ManagerAttemptRecord = {
        attempt,
        jobId: checkJobId,
        prompt: checkPrompt,
        snapshot,
        providerClaimedCompletion,
        verification,
        jobAssessment: checkResult.jobAssessment,
        decision,
        reason: checkResult.jobAssessment?.kind === "error" ? checkResult.jobAssessment.reason : reason,
        draftExecutions,
        checkJobId,
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
  const workflowGuide = await getAgentWorkflowRules();
  return {
    testFirstPolicy:
      getConfigValue(config, "testFirstPolicy") ?? "Write unit tests before implementation for changes and new features.",
    uiMobileCheck:
      getConfigValue(config, "uiMobileCheck") ??
      "Use Playwright to open the browser in mobile mode and check for broken layout.",
    workflowGuide,
  };
}

async function ensureAttemptArtifacts(
  request: ManagerRequest,
  attempt: number,
  makeProjectService: { readonly makeProject: (context: ProjectArtifactContext) => Promise<string> | string },
  makeJobService: {
    readonly makeJob: (context: ProjectArtifactContext) => Promise<string> | string;
    readonly readJob: (jobFilePath: string) => Promise<string> | string;
  },
  makeDraftService: {
    readonly makeDraft: (context: ProjectArtifactContext) => Promise<readonly ManagerDraftArtifact[]> | readonly ManagerDraftArtifact[];
  },
): Promise<AttemptArtifacts> {
  const timestamp = formatJobTimestamp(new Date(Date.now() + attempt * 60_000));
  const summary = toLimitedSnakeCase(request.request, 10, "job");
  const projectFilePath = buildProjectMetadataPath(request.workspaceDir);
  const filePaths = buildJobFilePaths(request.workspaceDir, timestamp, summary);

  await mkdir(join(request.workspaceDir, ".project"), { recursive: true });
  await mkdir(filePaths.jobDir, { recursive: true });
  await mkdir(filePaths.draftsDir, { recursive: true });
  await mkdir(join(request.workspaceDir, "evidence"), { recursive: true });
  await mkdir(filePaths.captureDir, { recursive: true });

  const artifactContext = {
    projectId: request.projectId,
    projectType: request.projectType,
    projectSpec: inferProjectSpec(request.request),
    request: request.request,
    jobDocument: "",
    workspaceDir: request.workspaceDir,
    timestamp,
    summary,
  };

  await writeFile(projectFilePath, await makeProjectService.makeProject(artifactContext), "utf8");
  const renderedJobDocument = await makeJobService.makeJob(artifactContext);
  await writeFile(filePaths.jobFilePath, renderedJobDocument, "utf8");
  const jobDocument = await makeJobService.readJob(filePaths.jobFilePath);

  const draftSeeds = await Promise.resolve(
    makeDraftService.makeDraft({
      ...artifactContext,
      jobDocument,
    }),
  );
  const usedDraftNames = new Set<string>();
  const drafts = await Promise.all(
    draftSeeds.map(async (draft) => {
      const safeDraftSummary = buildUniqueTaskName(draft.summary, usedDraftNames, 10);
      const filePath = join(filePaths.draftsDir, `${safeDraftSummary}.yaml`);
      await writeFile(filePath, draft.content, "utf8");
      return {
        ...draft,
        path: filePath,
      } satisfies ManagerDraftArtifact;
    }),
  );
  await appendJobCheckResult(
    filePaths.jobFilePath,
    `[analyze] generated drafts: ${drafts
      .map((draft) => `${draft.draftId}:${draft.kind}:p${draft.priority}:${draft.dependsOn.join("+") || "none"}`)
      .join(", ")}`,
  );

  return {
    timestamp,
    summary,
    projectFilePath,
    jobFilePath: filePaths.jobFilePath,
    drafts,
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

async function monitorManagerJob(
  runner: ManagerJobRunner,
  projectId: string,
  jobId: string,
): Promise<{ snapshot: ProjectJobSnapshot; jobAssessment: ManagerJobAssessment | null }> {
  const finalPromise = runner.waitForJob(projectId, jobId);
  let lastAssessment: ManagerJobAssessment | null = null;

  while (true) {
    const result = await Promise.race([
      finalPromise.then((snapshot) => ({ done: true as const, snapshot })),
      sleep(managerPollIntervalMs).then(() => ({ done: false as const })),
    ]);

    if (result.done) {
      return {
        snapshot: result.snapshot,
        jobAssessment: analyzeManagerJobSnapshot(result.snapshot, lastAssessment),
      };
    }

    const currentSnapshot = await runner.getJobSnapshot(projectId, jobId);
    if (currentSnapshot) {
      lastAssessment = analyzeManagerJobSnapshot(currentSnapshot, lastAssessment);
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

export const analyzeManagerJobSnapshot = (
  snapshot: ProjectJobSnapshot,
  previousAssessment: ManagerJobAssessment | null = null,
): ManagerJobAssessment => {
  if (snapshot.status === "failed") {
    if (previousAssessment && (previousAssessment.kind === "error" || previousAssessment.kind === "stalled")) {
      return previousAssessment;
    }

    return {
      kind: "failed",
      reason: snapshot.errorReason ?? snapshot.lastObservation ?? "The job failed without a detailed error.",
    };
  }

  const combinedOutput = [snapshot.lastObservation, snapshot.answerPreview, snapshot.panePreview].filter(Boolean).join("\n");
  const matchingErrorPattern = errorSignalPatterns.find((pattern) => pattern.test(combinedOutput));
  if (matchingErrorPattern) {
    return {
      kind: "error",
      reason: snapshot.lastObservation || combinedOutput.trim().split("\n").slice(-1)[0] || "The job emitted error output while running.",
    };
  }

  if (snapshot.status === "running" && snapshot.stalledForMs > 30_000) {
    return {
      kind: "stalled",
      reason: `The job appears stalled for ${snapshot.stalledForMs}ms. Last observation: ${snapshot.lastObservation}`,
    };
  }

  if (snapshot.status === "running" || snapshot.status === "waiting") {
    return {
      kind: "working",
      reason: snapshot.currentAction || snapshot.lastObservation || previousAssessment?.reason || "The job is still making progress.",
    };
  }

  return previousAssessment ?? {
    kind: "working",
    reason: snapshot.lastObservation || "The job is still being monitored.",
  };
};
