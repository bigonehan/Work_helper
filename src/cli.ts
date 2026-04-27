import { Effect } from "effect";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import {
  detectWorkspaceState,
  ensureArtifactRootWritable,
  ensureTargetDirWritable,
  resolveExecutionPaths,
} from "./executionPaths";
import { runRequestStage } from "./main";
import { analyzeManagerJobSnapshot } from "./manager";
import {
  bootstrapProject,
  createBootstrapVerifier,
  readProjectBootstrapMetadata,
} from "./bootstrap";
import {
  destroyProjectTmuxSession,
  getProjectJobSnapshot,
  submitProjectJobToTmux,
  waitForProjectJob,
} from "./projectManager";
import {
  MakeDraftTag,
  MakeJobTag,
  MakeProjectTag,
  createProjectLayerForType,
} from "./server/artifacts";
import {
  buildJobFilePaths,
  buildProjectMetadataPath,
  buildUniqueTaskName,
  createDraftDocument,
  formatJobTimestamp,
  getAgentWorkflowRules,
  getConfig,
  getConfigValue,
  inferProjectSpec,
  parseProjectMetadataDocument,
  readDraftDocument,
  toLimitedSnakeCase,
  toSnakeCaseSummary,
} from "./server/project";
import type { DraftDocumentChecks } from "./server/project";
import type {
  CliAnalyzeStepInput,
  CliAnalyzeStepResult,
  CliBootstrapStepInput,
  CliBootstrapStepResult,
  CliBuildStepInput,
  CliBuildStepResult,
  CliCheckStepInput,
  CliCheckStepResult,
  CliImproveStepInput,
  CliImproveStepResult,
  CliInitStepInput,
  CliInitStepResult,
  CliJobRunner,
  CliPlanStepInput,
  CliPlanStepResult,
  CliRequestCycleResult,
  CliRequestHandlerInput,
  CliRequestHandlerResult,
  CliRequestStepResult,
  ManagerDecision,
  ManagerDraftArtifact,
  ManagerDraftExecution,
  ManagerJobAssessment,
  ManagerVerificationResult,
  ProjectArtifactContext,
  ProjectJobSnapshot,
  ProjectTmuxJobOptions,
  ProjectType,
} from "./types";

interface CliPromptPolicies {
  readonly testFirstPolicy: string;
  readonly uiMobileCheck: string;
  readonly workflowGuide: string;
}

interface AttemptArtifacts {
  readonly timestamp: string;
  readonly summary: string;
  readonly jobFilePath: string;
  readonly targetDir: string;
  readonly jobDocument: string;
  readonly draftDocument: string;
  readonly draftChecks: DraftDocumentChecks;
  readonly drafts: readonly ManagerDraftArtifact[];
}

const defaultJobRunner: CliJobRunner = {
  submitJob: (options) => Effect.runPromise(submitProjectJobToTmux(options)),
  waitForJob: (projectId, jobId) => Effect.runPromise(waitForProjectJob(projectId, jobId)),
  getJobSnapshot: (projectId, jobId) => Effect.runPromise(getProjectJobSnapshot(projectId, jobId)),
  destroySession: (projectId) => Effect.runPromise(destroyProjectTmuxSession(projectId)),
};

const managerPollIntervalMs = 10;
const providerCompletedPattern = /\b(completed|complete|done|finished|success)\b|완료/iu;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function resolveProjectLayer(projectType: ProjectType, projectLayer?: CliPlanStepInput["projectLayer"]) {
  return projectLayer ?? createProjectLayerForType(projectType);
}

function buildArtifactContext(input: CliPlanStepInput | CliAnalyzeStepInput, timestamp: string, summary: string): ProjectArtifactContext {
  const paths = resolveExecutionPaths(input);
  return {
    projectId: input.projectId,
    projectType: input.projectType,
    projectSpec: "projectSpec" in input && input.projectSpec ? input.projectSpec : inferProjectSpec(input.request),
    request: input.request,
    jobDocument: "jobDocument" in input ? input.jobDocument ?? "" : "",
    workspaceDir: paths.targetDir,
    timestamp,
    summary,
  };
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function buildJobId(projectId: string, attempt: number, kind: "build" | "check", suffix: string): string {
  return `${sanitize(projectId)}-attempt-${attempt}-${kind}-${suffix}`;
}

function sanitize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "default";
}

function didProviderClaimCompletion(answer: string | null): boolean {
  return answer ? providerCompletedPattern.test(answer) : false;
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

function buildDraftExecutionPrompt(artifacts: AttemptArtifacts, draft: ManagerDraftArtifact, policies: CliPromptPolicies): string {
  return [
    "You are executing a build job through the delegated provider session.",
    "Use only the assigned draft content as the implementation source of truth.",
    "Follow TDD: write or update unit tests first, then implement the code.",
    "Run the relevant unit tests inside this session and do not finish until they pass.",
    "Do not perform the final browser-level or integration-level check in this session.",
    "Return exactly COMPLETED on a single line only after implementation and unit-test pass are finished.",
    "",
    `Target directory: ${artifacts.targetDir}`,
    `Workflow record: ${artifacts.jobFilePath}`,
    `Draft bundle: ${artifacts.summary}`,
    `Draft id: ${draft.draftId}`,
    `Draft priority: ${draft.priority}`,
    `Draft kind: ${draft.kind}`,
    `Draft file: ${draft.path}`,
    `Draft description: ${draft.description}`,
    `Draft input: ${draft.input.join(", ") || "none"}`,
    `Draft output: ${draft.output.join(", ") || "none"}`,
    `Draft tests: ${draft.test.join(", ") || "none"}`,
    `Draft targets: ${draft.target.join(", ") || "none"}`,
    `Draft dependencies: ${draft.dependsOn.join(", ") || "none"}`,
    "Draft content:",
    draft.content,
    `Policy: ${policies.testFirstPolicy}`,
    `Workflow: ${policies.workflowGuide}`,
  ].join("\n");
}

function buildCheckPrompt(artifacts: AttemptArtifacts, policies: CliPromptPolicies): string {
  const automatedChecks = artifacts.draftChecks.automated.map((item) => `- ${item}`).join("\n") || "- none";
  const assertions = artifacts.draftChecks.assertions.map((item) => `- ${item}`).join("\n") || "- none";
  return [
    "You are executing a final check job through the delegated provider session.",
    "Use the inline draft bundle document as the source of truth for the requested outcome.",
    "Verify whether the request described in the draft bundle document is actually fulfilled in the target directory.",
    "Use the effect_check skill guidance if it is available, and explicitly verify that the Effect TS schema, Context.Tag providers, and tagged stage-entry errors are wired correctly.",
    "When relevant, start the app or temporary server, use Playwright, simulate user actions, inspect logs or messages, and capture screenshots.",
    "Decide whether the request is complete or still needs more work based on real execution evidence.",
    "Return exactly COMPLETED on a single line only after the final check is finished.",
    "",
    `Target directory: ${artifacts.targetDir}`,
    `Workflow record: ${artifacts.jobFilePath}`,
    "Automated checks:",
    automatedChecks,
    "Assertions:",
    assertions,
    "Draft bundle document:",
    artifacts.draftDocument,
    "Supporting job document:",
    "Job document:",
    artifacts.jobDocument,
    `Policy: ${policies.uiMobileCheck}`,
    `Workflow: ${policies.workflowGuide}`,
  ].join("\n");
}

function buildDraftChecks(drafts: readonly ManagerDraftArtifact[]): DraftDocumentChecks {
  return {
    automated: ["bun test", "bunx tsc --noEmit"],
    assertions: drafts.map((draft) => `${draft.draftId}: ${draft.description}`),
  };
}

async function appendJobCheckResult(jobFilePath: string, message: string): Promise<void> {
  const existing = await readFile(jobFilePath, "utf8");
  const normalized = message.trim();
  if (!normalized) {
    return;
  }

  await writeFile(jobFilePath, `${existing}\n- ${normalized}\n`, "utf8");
}

async function monitorJob(
  runner: CliJobRunner,
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

function classifyCheckDecision(
  snapshot: ProjectJobSnapshot,
  providerClaimedCompletion: boolean,
  verification: ManagerVerificationResult | null,
): { decision: ManagerDecision; reason: string } {
  if (snapshot.status !== "completed") {
    return {
      decision: "halt",
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
      decision: "halt",
      reason: "Provider did not explicitly report completion.",
    };
  }

  if (verification && !verification.ok) {
    return {
      decision: "halt",
      reason: verification.summary,
    };
  }

  return {
    decision: "complete",
    reason: verification?.summary ?? "Provider reported completion and final check passed.",
  };
}

async function loadPromptPolicies(): Promise<CliPromptPolicies> {
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

export const runRequestStep = async (
  request: string,
  workspaceDir: string,
): Promise<CliRequestStepResult> => {
  const workspaceState = await detectWorkspaceState(workspaceDir, process.cwd());
  const result = runRequestStage({
    request,
    ...workspaceState,
  });

  return {
    stage: "request",
    request,
    transition: result.transition,
    ...workspaceState,
  };
};

export const runProjectBootstrapStep = async (input: CliBootstrapStepInput): Promise<CliBootstrapStepResult> => {
  const paths = resolveExecutionPaths(input);
  await ensureArtifactRootWritable(paths.artifactRoot, "bootstrap");
  const snapshot = await bootstrapProject({
    projectId: input.projectId,
    targetDir: paths.targetDir,
    provider: input.provider,
    debugLogging: input.debugLogging,
    totalTimeoutMs: input.totalTimeoutMs,
    firstOutputTimeoutMs: input.firstOutputTimeoutMs,
      responseTimeoutMs: input.responseTimeoutMs,
  });
  const metadata = await readProjectBootstrapMetadata(paths.artifactRoot);
  const verification = await createBootstrapVerifier(metadata.spec)(paths.targetDir);

  return {
    stage: "bootstrap",
    ok: verification.ok,
    metadata,
    snapshot,
    verification,
  };
};

export const runInitStep = async (input: CliInitStepInput): Promise<CliInitStepResult> => {
  const layer = resolveProjectLayer(input.projectType, input.projectLayer);
  const paths = resolveExecutionPaths(input);
  const projectFilePath = buildProjectMetadataPath(paths.artifactRoot);
  const projectSpec = inferProjectSpec(input.request);
  await ensureArtifactRootWritable(paths.artifactRoot, "init");
  const artifactContext = {
    projectId: input.projectId,
    projectType: input.projectType,
    projectSpec,
    request: input.request,
    jobDocument: "",
    workspaceDir: paths.targetDir,
    timestamp: formatJobTimestamp(new Date()),
    summary: toLimitedSnakeCase(input.request, 10, "job"),
  } satisfies ProjectArtifactContext;

  await mkdir(join(paths.artifactRoot, ".project"), { recursive: true });
  const projectDocument = await Effect.runPromise(
    Effect.gen(function* () {
      const makeProject = yield* MakeProjectTag;
      return yield* Effect.promise(() => Promise.resolve(makeProject.makeProject(artifactContext)));
    }).pipe(Effect.provide(layer)),
  );
  await writeFile(projectFilePath, projectDocument, "utf8");

  const bootstrap = input.bootstrap === false ? null : await runProjectBootstrapStep(input);

  return {
    stage: "init",
    ok: bootstrap ? bootstrap.ok : true,
    projectFilePath,
    projectDocument,
    projectSpec,
    bootstrap,
  };
};

export const runPlanStep = async (input: CliPlanStepInput): Promise<CliPlanStepResult> => {
  const layer = resolveProjectLayer(input.projectType, input.projectLayer);
  const paths = resolveExecutionPaths(input);
  const attempt = input.attempt ?? 1;
  const timestamp = formatJobTimestamp(new Date(Date.now() + attempt * 60_000));
  const summary = toLimitedSnakeCase(input.request, 10, "job");
  const projectSpec = inferProjectSpec(input.request);
  const projectFilePath = buildProjectMetadataPath(paths.artifactRoot);
  const filePaths = buildJobFilePaths(paths.artifactRoot, timestamp, summary);

  await ensureArtifactRootWritable(paths.artifactRoot, "plan");
  await mkdir(join(paths.artifactRoot, ".project"), { recursive: true });
  await mkdir(filePaths.draftsRootDir, { recursive: true });
  await mkdir(filePaths.captureDir, { recursive: true });

  const artifactContext = buildArtifactContext(input, timestamp, summary);
  const jobDocument = await Effect.runPromise(
    Effect.gen(function* () {
      const makeJob = yield* MakeJobTag;
      return yield* Effect.promise(() => Promise.resolve(makeJob.makeJob(artifactContext)));
    }).pipe(Effect.provide(layer)),
  );
  await writeFile(filePaths.jobFilePath, jobDocument, "utf8");

  if (!(await pathExists(projectFilePath))) {
    const projectDocument = await Effect.runPromise(
      Effect.gen(function* () {
        const makeProject = yield* MakeProjectTag;
        return yield* Effect.promise(() => Promise.resolve(makeProject.makeProject(artifactContext)));
      }).pipe(Effect.provide(layer)),
    );
    await writeFile(projectFilePath, projectDocument, "utf8");
  }

  return {
    stage: "plan",
    ok: true,
    timestamp,
    summary,
    projectSpec,
    projectFilePath,
    jobFilePath: filePaths.jobFilePath,
    jobDocument,
  };
};

export const runAnalyzeStep = async (input: CliAnalyzeStepInput): Promise<CliAnalyzeStepResult> => {
  const layer = resolveProjectLayer(input.projectType, input.projectLayer);
  const paths = resolveExecutionPaths(input);
  const projectSpec = input.projectSpec ?? inferProjectSpec(input.request);
  const filePaths = buildJobFilePaths(paths.artifactRoot, input.timestamp, input.summary);
  const jobDocument = input.jobDocument ?? (await readFile(input.jobFilePath, "utf8"));

  await ensureArtifactRootWritable(paths.artifactRoot, "analyze");
  await mkdir(filePaths.draftDir, { recursive: true });
  const draftSeeds = await Effect.runPromise(
    Effect.gen(function* () {
      const makeDraft = yield* MakeDraftTag;
      return yield* Effect.promise(() =>
        Promise.resolve(
          makeDraft.makeDraft({
            ...buildArtifactContext(input, input.timestamp, input.summary),
            projectSpec,
            jobDocument,
          }),
        ),
      );
    }).pipe(Effect.provide(layer)),
  );

  const usedDraftNames = new Set<string>();
  const drafts = await Promise.all(
    draftSeeds.map(async (draft) => {
      const safeDraftSummary = buildUniqueTaskName(draft.summary, usedDraftNames, 10);
      const filePath = join(filePaths.draftDir, `${safeDraftSummary}.yaml`);
      const content = draft.content.replace(/^summary:\s.+$/m, `summary: ${safeDraftSummary}`);
      await writeFile(filePath, content, "utf8");
      return {
        ...draft,
        summary: safeDraftSummary,
        path: filePath,
        content,
      } satisfies ManagerDraftArtifact;
    }),
  );

  const draftChecks = buildDraftChecks(drafts);
  const draftDocument = await createDraftDocument({
    request: input.request,
    summary: input.summary,
    draftItems: drafts.map((draft) => ({
      id: draft.draftId,
      file: basename(draft.path),
      description: draft.description,
    })),
    checks: draftChecks,
  });
  await writeFile(filePaths.draftDocumentPath, draftDocument, "utf8");

  await appendJobCheckResult(
    input.jobFilePath,
    `[analyze] generated drafts: ${drafts
      .map((draft) => `${draft.draftId}:${draft.kind}:p${draft.priority}:${draft.dependsOn.join("+") || "none"}`)
      .join(", ")}`,
  );
  await appendJobCheckResult(input.jobFilePath, `[analyze] draft bundle: ${filePaths.draftDocumentPath}`);

  return {
    stage: "analyze",
    ok: true,
    timestamp: input.timestamp,
    summary: input.summary,
    projectSpec,
    jobFilePath: input.jobFilePath,
    draftDir: filePaths.draftDir,
    draftDocumentPath: filePaths.draftDocumentPath,
    draftDocument,
    drafts,
  };
};

export const runBuildStep = async (input: CliBuildStepInput): Promise<CliBuildStepResult> => {
  const runner = input.runner ?? defaultJobRunner;
  const policies = await loadPromptPolicies();
  const paths = resolveExecutionPaths(input);
  const attempt = input.attempt ?? 1;
  await ensureTargetDirWritable(paths.targetDir, "build");
  const jobDocument = await readFile(input.jobFilePath, "utf8");
  const artifacts: AttemptArtifacts = {
    timestamp: input.timestamp,
    summary: input.summary,
    jobFilePath: input.jobFilePath,
    targetDir: paths.targetDir,
    jobDocument,
    draftDocument: "",
    draftChecks: buildDraftChecks(input.drafts),
    drafts: input.drafts,
  };
  const batches = buildDraftExecutionBatches(input.drafts);
  const executions: ManagerDraftExecution[] = [];
  let failedExecution: ManagerDraftExecution | null = null;

  await runner.destroySession(input.projectId);

  try {
    for (const batch of batches) {
      const batchExecutions = await Promise.all(
        batch.map(async (draft) => {
          const jobId = buildJobId(input.projectId, attempt, "build", draft.summary);
          const prompt = buildDraftExecutionPrompt(artifacts, draft, policies);
          await runner.submitJob({
            projectId: input.projectId,
            jobId,
            provider: input.provider,
            prompt,
            targetDir: paths.targetDir,
            debugLogging: input.debugLogging,
            totalTimeoutMs: input.totalTimeoutMs,
            firstOutputTimeoutMs: input.firstOutputTimeoutMs,
            responseTimeoutMs: input.responseTimeoutMs,
            pollIntervalMs: input.pollIntervalMs,
            stableAnswerWindowMs: input.stableAnswerWindowMs,
            preserveWindowOnFailure: input.preserveWindowOnFailure,
          } satisfies ProjectTmuxJobOptions);
          const result = await monitorJob(runner, input.projectId, jobId);
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

      executions.push(...batchExecutions);
      for (const execution of batchExecutions) {
        await appendJobCheckResult(
          input.jobFilePath,
          `[build:${execution.draftId}] ${execution.snapshot.answerPreview ?? execution.snapshot.errorReason ?? execution.snapshot.status}`,
        );

        if (execution.snapshot.status !== "completed") {
          failedExecution = execution;
          break;
        }
      }

      if (failedExecution) {
        break;
      }
    }
  } finally {
    await runner.destroySession(input.projectId);
  }

  const reason =
    failedExecution?.jobAssessment?.reason ??
    failedExecution?.snapshot.errorReason ??
    (failedExecution ? `tmux job ended with status ${failedExecution.snapshot.status}` : "All build drafts completed.");

  return {
    stage: "build",
    ok: failedExecution === null,
    attempt,
    timestamp: input.timestamp,
    summary: input.summary,
    jobFilePath: input.jobFilePath,
    executions,
    failedExecution,
    decision: failedExecution ? "halt" : "continue",
    reason,
  };
};

export const runCheckStep = async (input: CliCheckStepInput): Promise<CliCheckStepResult> => {
  const runner = input.runner ?? defaultJobRunner;
  const policies = await loadPromptPolicies();
  const paths = resolveExecutionPaths(input);
  const attempt = input.attempt ?? 1;
  const jobId = buildJobId(input.projectId, attempt, "check", "final");
  await ensureArtifactRootWritable(paths.artifactRoot, "check");
  const jobDocument = await readFile(input.jobFilePath, "utf8");
  const draftDocument = await readFile(input.draftDocumentPath, "utf8");
  const draftMetadata = await readDraftDocument(input.draftDocumentPath);
  const artifacts: AttemptArtifacts = {
    timestamp: input.timestamp,
    summary: input.summary,
    jobFilePath: input.jobFilePath,
    targetDir: paths.targetDir,
    jobDocument,
    draftDocument,
    draftChecks: draftMetadata.checks,
    drafts: [],
  };
  const prompt = buildCheckPrompt(artifacts, policies);

  await runner.destroySession(input.projectId);

  try {
    await runner.submitJob({
      projectId: input.projectId,
      jobId,
      provider: input.provider,
      prompt,
      targetDir: paths.targetDir,
      debugLogging: input.debugLogging,
      totalTimeoutMs: input.totalTimeoutMs,
      firstOutputTimeoutMs: input.firstOutputTimeoutMs,
      responseTimeoutMs: input.responseTimeoutMs,
      pollIntervalMs: input.pollIntervalMs,
      stableAnswerWindowMs: input.stableAnswerWindowMs,
      preserveWindowOnFailure: input.preserveWindowOnFailure,
    } satisfies ProjectTmuxJobOptions);

    const result = await monitorJob(runner, input.projectId, jobId);
    const snapshot = result.snapshot;
    const providerClaimedCompletion = didProviderClaimCompletion(snapshot.answerPreview);
    const verification =
      snapshot.status === "completed" && input.verifyCompletion
        ? await input.verifyCompletion({
            attempt,
            answer: snapshot.answerPreview,
            projectId: input.projectId,
            provider: input.provider,
            request: input.request,
            snapshot,
            workspaceDir: paths.targetDir,
          })
        : null;
    const decision = classifyCheckDecision(snapshot, providerClaimedCompletion, verification);
    await appendJobCheckResult(
      input.jobFilePath,
      `[check] ${snapshot.answerPreview ?? snapshot.errorReason ?? "final check finished without message"}`,
    );

    return {
      stage: "check",
      ok: decision.decision === "complete",
      attempt,
      jobId,
      prompt,
      snapshot,
      providerClaimedCompletion,
      verification,
      jobAssessment: result.jobAssessment,
      decision: decision.decision,
      reason: result.jobAssessment?.kind === "error" ? result.jobAssessment.reason : decision.reason,
    };
  } finally {
    await runner.destroySession(input.projectId);
  }
};

export const runImproveStep = async (input: CliImproveStepInput): Promise<CliImproveStepResult> => {
  const report = await readFile(input.jobFilePath, "utf8");

  if (input.check.decision === "complete") {
    return {
      stage: "improve",
      decision: "halt",
      reason: input.check.reason,
      nextRequest: null,
      report,
    };
  }

  return {
    stage: "improve",
    decision: "continue",
    reason: input.check.reason,
    nextRequest: [
      input.request,
      "",
      "작업 마무리(개선) 단계:",
      `- source of truth: ${input.jobFilePath}`,
      "- check 결과와 job.md 보고를 반영해 남은 문제를 수정한다.",
      "- 기존 구현을 보존하면서 실패 원인과 누락된 요구사항만 보완한다.",
    ].join("\n"),
    report,
  };
};

export const handleRequest = async (input: CliRequestHandlerInput): Promise<CliRequestHandlerResult> => {
  const paths = resolveExecutionPaths(input);
  const request = await runRequestStep(input.request, paths.targetDir);
  const cycles: CliRequestCycleResult[] = [];
  const maxImproveIterations = input.maxImproveIterations ?? 1;
  let currentRequest = input.request;
  let initResult: CliInitStepResult | null = null;

  if (request.transition === "request->init" || request.transition === "request->import-project") {
    initResult = await runInitStep({
      ...input,
      targetDir: paths.targetDir,
      request: currentRequest,
      bootstrap: request.transition === "request->init" ? input.bootstrap : false,
    });
  }

  for (let attempt = 1; attempt <= maxImproveIterations + 1; attempt += 1) {
    const stepInput = {
      ...input,
      targetDir: paths.targetDir,
      request: currentRequest,
    };
    const plan = await runPlanStep({
      ...stepInput,
      attempt,
    });
    const analyze = await runAnalyzeStep({
      ...stepInput,
      timestamp: plan.timestamp,
      summary: plan.summary,
      projectSpec: plan.projectSpec,
      jobFilePath: plan.jobFilePath,
      jobDocument: plan.jobDocument,
    });
    const build = await runBuildStep({
      ...stepInput,
      attempt,
      timestamp: analyze.timestamp,
      summary: analyze.summary,
      jobFilePath: analyze.jobFilePath,
      drafts: analyze.drafts,
      runner: input.runner,
    });

    if (!build.ok) {
      cycles.push({
        attempt,
        plan,
        analyze,
        build,
        check: null,
        improve: null,
      });
      return {
        ok: false,
        request,
        init: initResult,
        cycles,
        finalDecision: "halt",
        finalReason: build.reason,
      };
    }

    const check = await runCheckStep({
      ...stepInput,
      attempt,
      timestamp: analyze.timestamp,
      summary: analyze.summary,
      jobFilePath: analyze.jobFilePath,
      draftDocumentPath: analyze.draftDocumentPath,
      runner: input.runner,
      verifyCompletion: input.verifyCompletion,
    });
    const improve = await runImproveStep({
      ...stepInput,
      jobFilePath: analyze.jobFilePath,
      check,
    });

    cycles.push({
      attempt,
      plan,
      analyze,
      build,
      check,
      improve,
    });

    if (improve.decision === "halt" || attempt > maxImproveIterations) {
      return {
        ok: check.ok,
        request,
        init: initResult,
        cycles,
        finalDecision: check.ok ? "complete" : "halt",
        finalReason: improve.reason,
      };
    }

    currentRequest = improve.nextRequest ?? currentRequest;
  }

  return {
    ok: false,
    request,
    init: initResult,
    cycles,
    finalDecision: "halt",
    finalReason: "Request handler exhausted improvement iterations.",
  };
};

export const createDefaultCliJobRunner = (): CliJobRunner => defaultJobRunner;

export const toSafeRequestSummary = (request: string): string =>
  toSnakeCaseSummary(request).slice(0, 80).replace(/_+$/g, "") || "job";

export const readProjectMetadata = async (workspaceDir: string) => {
  const document = await readFile(buildProjectMetadataPath(workspaceDir), "utf8");
  return parseProjectMetadataDocument(document);
};
