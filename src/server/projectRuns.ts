import { handleManagerRequest } from "../manager";
import { createReactTodoAppVerifier } from "../manager";
import { lstat, symlink } from "node:fs/promises";
import { join } from "node:path";
import type { ManagerResult, ProjectJobSnapshot, ProjectType, Provider } from "../types";
import { listProjectRegistry } from "./uiProjectData";

export type ProjectRunStatus = "queued" | "running" | "completed" | "failed";

export interface ProjectRunRecord {
  readonly runId: string;
  readonly projectId: string;
  readonly request: string;
  readonly provider: Provider;
  readonly status: ProjectRunStatus;
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly completedAt: string | null;
  readonly currentAction: string;
  readonly result: ManagerResult | null;
  readonly error: string | null;
  readonly snapshots: readonly ProjectJobSnapshot[];
}

const runs = new Map<string, ProjectRunRecord>();

const nowIso = () => new Date().toISOString();

const updateRun = (runId: string, patch: Partial<ProjectRunRecord>): void => {
  const current = runs.get(runId);
  if (!current) {
    return;
  }

  runs.set(runId, {
    ...current,
    ...patch,
    updatedAt: nowIso(),
  });
};

const buildRunId = (projectId: string): string => `${projectId}-${Date.now().toString(36)}`;

const extractSnapshots = (result: ManagerResult): ProjectJobSnapshot[] =>
  result.attempts.flatMap((attempt) => [
    ...attempt.draftExecutions.map((execution) => execution.snapshot),
    attempt.snapshot,
  ]);

const shouldUseTodoVerifier = (request: string): boolean => /todo|할\s*일|투두/iu.test(request);

const withCwd = async <T>(dir: string, run: () => Promise<T>): Promise<T> => {
  const previous = process.cwd();
  process.chdir(dir);
  try {
    return await run();
  } finally {
    process.chdir(previous);
  }
};

const ensureSymlink = async (target: string, linkPath: string, type: "dir" | "file"): Promise<void> => {
  try {
    await lstat(linkPath);
    return;
  } catch {
    await symlink(target, linkPath, type);
  }
};

const prepareProjectRuntime = async (projectPath: string, rootDir: string): Promise<void> => {
  await ensureSymlink(join(rootDir, "assets"), join(projectPath, "assets"), "dir");
  await ensureSymlink(join(rootDir, "AGENTS.md"), join(projectPath, "AGENTS.md"), "file");
};

export interface StartProjectRunInput {
  readonly projectId: string;
  readonly request: string;
  readonly provider?: Provider;
  readonly rootDir?: string;
}

export const startProjectRun = async (input: StartProjectRunInput): Promise<ProjectRunRecord> => {
  const rootDir = input.rootDir ?? process.cwd();
  const project = (await listProjectRegistry(rootDir)).find((item) => item.id === input.projectId);
  if (!project) {
    throw new Error(`Project not found: ${input.projectId}`);
  }

  const request = input.request.trim();
  if (!request) {
    throw new Error("Request is required.");
  }

  const runId = buildRunId(input.projectId);
  const timestamp = nowIso();
  const provider = input.provider ?? "codex";
  const record: ProjectRunRecord = {
    runId,
    projectId: input.projectId,
    request,
    provider,
    status: "queued",
    startedAt: timestamp,
    updatedAt: timestamp,
    completedAt: null,
    currentAction: "queued",
    result: null,
    error: null,
    snapshots: [],
  };
  runs.set(runId, record);

  queueMicrotask(() => {
    void (async () => {
      updateRun(runId, { status: "running", currentAction: "running manager workflow" });
      try {
        await prepareProjectRuntime(project.path, rootDir);
        const result = await withCwd(project.path, () =>
          handleManagerRequest({
            projectId: project.id,
            projectType: project.type as ProjectType,
            request,
            targetDir: project.path,
            provider,
            bootstrap: false,
            maxAttempts: 3,
            totalTimeoutMs: 300_000,
            firstOutputTimeoutMs: 20_000,
            responseTimeoutMs: 240_000,
            verifyCompletion: shouldUseTodoVerifier(request) ? createReactTodoAppVerifier(project.path) : undefined,
          }),
        );

        const todoVerification = shouldUseTodoVerifier(request) ? await createReactTodoAppVerifier(project.path)() : null;
        const runCompleted = result.ok || todoVerification?.ok === true;
        updateRun(runId, {
          status: runCompleted ? "completed" : "failed",
          completedAt: nowIso(),
          currentAction: todoVerification?.ok ? todoVerification.summary : result.reason,
          result,
          snapshots: extractSnapshots(result),
          error: runCompleted ? null : (todoVerification?.summary ?? result.reason),
        });
      } catch (error) {
        updateRun(runId, {
          status: "failed",
          completedAt: nowIso(),
          currentAction: "run failed",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    })();
  });

  return runs.get(runId)!;
};

export const getProjectRun = (runId: string): ProjectRunRecord | null => runs.get(runId) ?? null;

export const listProjectRuns = (projectId: string): ProjectRunRecord[] =>
  [...runs.values()].filter((run) => run.projectId === projectId).sort((left, right) => right.startedAt.localeCompare(left.startedAt));
