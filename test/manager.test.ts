import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyzeManagerJobSnapshot, handleManagerRequest } from "../src/manager";
import type { ProjectJobSnapshot, ProjectTmuxJobOptions, RunPromptStage } from "../src/types";

const withCwd = async <T>(dir: string, run: () => Promise<T>): Promise<T> => {
  const previous = process.cwd();
  process.chdir(dir);
  try {
    return await run();
  } finally {
    process.chdir(previous);
  }
};

const prepareArtifactRoot = async (dir: string): Promise<void> => {
  const repoRoot = process.cwd();
  await symlink(join(repoRoot, "assets"), join(dir, "assets"), "dir");
  await symlink(join(repoRoot, "AGENTS.md"), join(dir, "AGENTS.md"));
};

const baseSnapshot = (overrides: Partial<ProjectJobSnapshot> = {}): ProjectJobSnapshot => ({
  projectId: "demo-project",
  jobId: "demo-job",
  provider: "codex",
  workspaceDir: "/tmp/demo",
  targetDir: "/tmp/demo",
  executionBackend: "tmux",
  sessionName: "project-demo",
  windowName: "job-demo",
  windowTarget: "project-demo:job-demo",
  status: "completed",
  stage: "completed",
  currentAction: "job completed",
  lastObservation: "The provider returned a final answer.",
  answerPreview: "COMPLETED",
  panePreview: "COMPLETED",
  markerSeen: true,
  exitCode: 0,
  startedAt: 1,
  updatedAt: 2,
  firstOutputAt: 2,
  finalAnswerAt: 3,
  completedAt: 3,
  stalledForMs: 0,
  errorReason: null,
  validationError: null,
  ...overrides,
});

const runningSnapshot = (overrides: Partial<ProjectJobSnapshot> = {}): ProjectJobSnapshot =>
  baseSnapshot({
    status: "running",
    stage: "waiting_for_final_answer",
    currentAction: "provider is still generating",
    lastObservation: "Pane updated: writing files",
    completedAt: null,
    errorReason: null,
    answerPreview: null,
    ...overrides,
  });

const createRunner = (
  snapshots: ProjectJobSnapshot[],
  progressSnapshots: Record<string, ProjectJobSnapshot[]> = {},
) => {
  const submitted: ProjectTmuxJobOptions[] = [];
  const destroyed: string[] = [];
  let index = 0;
  const progressIndex = new Map<string, number>();

  return {
    runner: {
      submitJob: async (options: ProjectTmuxJobOptions) => {
        submitted.push(options);
        return {
          projectId: options.projectId,
          jobId: options.jobId,
          sessionName: "project-demo",
          windowName: options.jobId,
          windowTarget: `project-demo:${options.jobId}`,
          startedAt: Date.now(),
        };
      },
      waitForJob: async (_projectId: string, jobId: string) => {
        if (progressSnapshots[jobId]) {
          await new Promise((resolve) => setTimeout(resolve, 30));
        }
        const snapshot = snapshots[index];
        index += 1;
        if (!snapshot) {
          throw new Error(`No snapshot configured for ${jobId}`);
        }

        return {
          ...snapshot,
          jobId,
        };
      },
      getJobSnapshot: async (_projectId: string, jobId: string) => {
        const snapshotsForJob = progressSnapshots[jobId] ?? progressSnapshots["*"];
        if (!snapshotsForJob?.length) {
          return null;
        }

        const currentIndex = progressIndex.get(jobId) ?? 0;
        const snapshot = snapshotsForJob[Math.min(currentIndex, snapshotsForJob.length - 1)];
        progressIndex.set(jobId, currentIndex + 1);
        return {
          ...snapshot,
          jobId,
        };
      },
      destroySession: async (projectId: string) => {
        destroyed.push(projectId);
      },
    },
    submitted,
    destroyed,
  };
};

describe("handleManagerRequest", () => {
  test("classifies running snapshots as working, stalled, or error", () => {
    expect(analyzeManagerJobSnapshot(runningSnapshot()).kind).toBe("working");
    expect(
      analyzeManagerJobSnapshot(
        runningSnapshot({
          stalledForMs: 45_000,
          lastObservation: "Pane updated: no new output",
        }),
      ).kind,
    ).toBe("stalled");
    expect(
      analyzeManagerJobSnapshot(
        runningSnapshot({
          panePreview: "npm ERR! missing script: test",
          lastObservation: "Pane updated: npm ERR! missing script: test",
        }),
      ).kind,
    ).toBe("error");
  });

  test("submits one workflow child and one verification session", async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), "work-helper-manager-target-"));
    const artifactRoot = await mkdtemp(join(tmpdir(), "work-helper-manager-artifacts-"));
    await prepareArtifactRoot(artifactRoot);
    const { runner, submitted, destroyed } = createRunner([
      baseSnapshot({ answerPreview: "implementation complete" }),
      baseSnapshot({ answerPreview: "verification complete" }),
      baseSnapshot({ answerPreview: "implementation complete" }),
      baseSnapshot({ answerPreview: "COMPLETED" }),
    ]);

    const result = await withCwd(artifactRoot, () =>
      handleManagerRequest(
        {
          projectId: "demo-project",
          projectType: "code",
          request: "Create a React todo app",
          targetDir: workspaceDir,
          provider: "codex",
          bootstrap: false,
          maxAttempts: 1,
          verifyCompletion: async () => ({ ok: true, summary: "filesystem verified" }),
        },
        runner,
      ),
    );

    expect(result.ok).toBe(true);
    expect(result.decision).toBe("complete");
    expect(result.attempts).toHaveLength(1);
    expect(submitted.length).toBeGreaterThanOrEqual(2);
    expect(submitted.every((job) => job.targetDir === workspaceDir)).toBe(true);
    expect(submitted.some((job) => job.jobId.includes("build"))).toBe(true);
    expect(submitted.some((job) => job.jobId.includes("check"))).toBe(true);
    expect(submitted[0]?.prompt).toContain("Draft content:");
    expect(submitted.at(-1)?.prompt).toContain("Draft bundle document:");
    expect(destroyed.length).toBeGreaterThanOrEqual(2);

    const projectPath = join(artifactRoot, ".project", "project.md");
    const jobPath = join(artifactRoot, ".project", "job.md");
    const draftsRoot = join(artifactRoot, ".project", "drafts");
    const dates = await Bun.file(projectPath).text();
    expect(dates).toContain("Create a React todo app");

    const draftDirs = await Array.fromAsync(new Bun.Glob("*").scan({ cwd: draftsRoot, onlyFiles: false }));
    expect(draftDirs).toHaveLength(1);
    const draftDir = join(draftsRoot, String(draftDirs[0]));
    const draftFiles = await Array.fromAsync(new Bun.Glob("*.yaml").scan({ cwd: draftDir }));
    const draftBundleFiles = await Array.fromAsync(new Bun.Glob("*.md").scan({ cwd: draftDir }));

    expect(draftFiles.length).toBeGreaterThan(0);
    expect(String(draftDirs[0]).length).toBeLessThanOrEqual(10);
    expect(draftBundleFiles).toHaveLength(1);

    const jobDocument = await readFile(jobPath, "utf8");
    const draftBundleDocument = await readFile(join(draftDir, draftBundleFiles[0] as string), "utf8");
    const draftDocument = await readFile(join(draftDir, draftFiles[0] as string), "utf8");
    expect(jobDocument).toContain("# check");
    expect(jobDocument).toContain("[check]");
    expect(draftBundleDocument).toContain("draft_items:");
    expect(draftDocument).toContain("id:");
    expect(draftDocument).toContain("description:");
    expect(draftDocument).toContain("priority:");
    expect(draftDocument).toContain("dependsOn:");
    expect((result.attempts[0]?.draftExecutions.length ?? 0)).toBeGreaterThan(0);
    expect(result.attempts[0]?.checkJobId).toContain("check");
  });

  test("does not run verification session when implementation session fails", async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), "work-helper-manager-"));
    const artifactRoot = await mkdtemp(join(tmpdir(), "work-helper-manager-artifacts-"));
    await prepareArtifactRoot(artifactRoot);
    const { runner, submitted } = createRunner([
      baseSnapshot({
        status: "failed",
        stage: "provider_output_started_no_final_answer",
        errorReason: "implementation failed",
        answerPreview: "still working",
      }),
    ]);

    const result = await withCwd(artifactRoot, () =>
      handleManagerRequest(
        {
          projectId: "demo-project",
          projectType: "code",
          request: "Create a React todo app",
          targetDir: workspaceDir,
          provider: "codex",
          bootstrap: false,
          maxAttempts: 1,
        },
        runner,
      ),
    );

    expect(result.ok).toBe(false);
    expect(result.decision).toBe("halt");
    expect(submitted.length).toBeGreaterThanOrEqual(1);
    expect(submitted.every((job) => !job.jobId.includes("check"))).toBe(true);
  });

  test("uses progress analysis to explain likely errors before job exit", async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), "work-helper-manager-"));
    const artifactRoot = await mkdtemp(join(tmpdir(), "work-helper-manager-artifacts-"));
    await prepareArtifactRoot(artifactRoot);
    const { runner } = createRunner(
      [
        baseSnapshot({
          status: "failed",
          stage: "timeout" as RunPromptStage,
          errorReason: "The job exceeded the configured total timeout.",
          answerPreview: null,
        }),
      ],
      {
        "*": [
          runningSnapshot({
            panePreview: "npm ERR! missing script: test",
            lastObservation: "Pane updated: npm ERR! missing script: test",
          }),
        ],
      },
    );

    const result = await withCwd(artifactRoot, () =>
      handleManagerRequest(
        {
          projectId: "demo-project",
          projectType: "code",
          request: "Create a React todo app",
          targetDir: workspaceDir,
          provider: "codex",
          bootstrap: false,
          maxAttempts: 1,
        },
        runner,
      ),
    );

    expect(result.ok).toBe(false);
    expect(result.reason === "The job exceeded the configured total timeout." || result.reason.includes("npm ERR! missing script: test")).toBe(true);
  });

  test("uses stable workflow job ids for long requests", async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), "work-helper-manager-"));
    const artifactRoot = await mkdtemp(join(tmpdir(), "work-helper-manager-artifacts-"));
    await prepareArtifactRoot(artifactRoot);
    const { runner } = createRunner([
      baseSnapshot({ answerPreview: "implementation complete" }),
      baseSnapshot({ answerPreview: "verification complete" }),
      baseSnapshot({ answerPreview: "implementation complete" }),
      baseSnapshot({ answerPreview: "COMPLETED" }),
    ]);

    const request = "Create ".repeat(80);
    const result = await withCwd(artifactRoot, () =>
      handleManagerRequest(
        {
          projectId: "demo-project",
          projectType: "code",
          request,
          targetDir: workspaceDir,
          provider: "codex",
          bootstrap: false,
          maxAttempts: 1,
          verifyCompletion: async () => ({ ok: true, summary: "filesystem verified" }),
        },
        runner,
      ),
    );

    expect(result.ok).toBe(true);
    expect(result.attempts[0]?.jobId).toContain("build");
    expect((result.attempts[0]?.jobId ?? "").length).toBeLessThanOrEqual(120);
  });
});
