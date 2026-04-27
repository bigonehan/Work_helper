import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { handleRequest } from "./cli";
import { resolveExecutionPaths } from "./executionPaths";
import { createDefaultCliJobRunner } from "./cli";
import type {
  CliJobRunner,
  ManagerAttemptRecord,
  ManagerJobAssessment,
  ManagerRequest,
  ManagerResult,
  ManagerVerificationResult,
  ProjectJobSnapshot,
} from "./types";

const defaultOptions = {
  maxAttempts: 3,
} as const;

export const handleManagerRequest = async (
  input: ManagerRequest,
  runner: CliJobRunner = createDefaultCliJobRunner(),
): Promise<ManagerResult> => {
  return handleManagerRequestWithProject(input, runner);
};

export const handleManagerRequestEffect = (
  input: ManagerRequest,
  runner: CliJobRunner = createDefaultCliJobRunner(),
) => Promise.resolve(handleManagerRequestWithProject(input, runner));

const handleManagerRequestWithProject = async (
  input: ManagerRequest,
  runner: CliJobRunner,
): Promise<ManagerResult> => {
  const request: ManagerRequest = { ...defaultOptions, ...input };
  const paths = resolveExecutionPaths(request);

  await request.prepareWorkspace?.();

  const result = await handleRequest({
    ...request,
    targetDir: paths.targetDir,
    runner,
    verifyCompletion: request.verifyCompletion,
    maxImproveIterations: Math.max(0, (request.maxAttempts ?? defaultOptions.maxAttempts) - 1),
  });

  const attempts: ManagerAttemptRecord[] = result.cycles.map((cycle) => {
    const snapshot =
      cycle.check?.snapshot ??
      cycle.build.failedExecution?.snapshot ??
      cycle.build.executions.at(-1)?.snapshot ??
      makeSyntheticSnapshot(request.projectId, request.provider, paths.targetDir, cycle.build.reason, cycle.attempt);

    return {
      attempt: cycle.attempt,
      jobId: cycle.build.executions[0]?.jobId ?? cycle.check?.jobId ?? snapshot.jobId,
      prompt: cycle.check?.prompt ?? "",
      snapshot,
      providerClaimedCompletion: cycle.check?.providerClaimedCompletion ?? false,
      verification: cycle.check?.verification ?? null,
      jobAssessment: cycle.check?.jobAssessment ?? cycle.build.failedExecution?.jobAssessment ?? null,
      decision: cycle.check?.decision ?? "halt",
      reason: cycle.check?.reason ?? cycle.build.reason,
      draftExecutions: cycle.build.executions,
      checkJobId: cycle.check?.jobId ?? null,
    } satisfies ManagerAttemptRecord;
  });

  const finalAttempt = attempts.at(-1) ?? null;
  return {
    ok: result.ok,
    projectId: request.projectId,
    request: request.request,
    workspaceDir: paths.targetDir,
    targetDir: paths.targetDir,
    provider: request.provider,
    attempts,
    decision: result.finalDecision,
    reason: result.finalReason,
    finalAnswer: finalAttempt?.snapshot.answerPreview ?? null,
    finalSnapshot: finalAttempt?.snapshot ?? null,
  };
};

function makeSyntheticSnapshot(
  projectId: string,
  provider: ManagerRequest["provider"],
  targetDir: string,
  reason: string,
  attempt: number,
): ProjectJobSnapshot {
  return {
    projectId,
    jobId: `${projectId}-attempt-${attempt}`,
    provider,
    workspaceDir: targetDir,
    targetDir,
    executionBackend: "direct",
    sessionName: "manager",
    windowName: "manager",
    windowTarget: "manager",
    status: "failed",
    stage: "provider_process_not_started",
    currentAction: "job failed",
    lastObservation: reason,
    answerPreview: null,
    panePreview: "",
    markerSeen: false,
    exitCode: null,
    startedAt: 0,
    updatedAt: 0,
    firstOutputAt: null,
    finalAnswerAt: null,
    completedAt: null,
    stalledForMs: 0,
    errorReason: reason,
    validationError: null,
  };
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
