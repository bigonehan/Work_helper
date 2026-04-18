import { describe, expect, test } from "bun:test";
import { Layer } from "effect";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyzeManagerTaskSnapshot, handleManagerRequest } from "../src/manager";
import { ProjectTag } from "../src/server/artifacts";
import type {
  ProjectArtifactService,
  ProjectTaskSnapshot,
  ProjectTmuxTaskOptions,
  RunPromptStage,
} from "../src/types";

const baseSnapshot = (overrides: Partial<ProjectTaskSnapshot> = {}): ProjectTaskSnapshot => ({
  projectId: "demo-project",
  taskId: "demo-task",
  provider: "codex",
  workspaceDir: "/tmp/demo",
  sessionName: "project-demo",
  windowName: "task-demo",
  windowTarget: "project-demo:task-demo",
  status: "completed",
  stage: "completed",
  currentAction: "task completed",
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

const runningSnapshot = (overrides: Partial<ProjectTaskSnapshot> = {}): ProjectTaskSnapshot =>
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
  snapshots: ProjectTaskSnapshot[],
  progressSnapshots: Record<string, ProjectTaskSnapshot[]> = {},
) => {
  const submitted: ProjectTmuxTaskOptions[] = [];
  const destroyed: string[] = [];
  let index = 0;
  const progressIndex = new Map<string, number>();

  return {
    runner: {
      submitTask: async (options: ProjectTmuxTaskOptions) => {
        submitted.push(options);
        return {
          projectId: options.projectId,
          taskId: options.taskId,
          sessionName: "project-demo",
          windowName: options.taskId,
          windowTarget: `project-demo:${options.taskId}`,
          startedAt: Date.now(),
        };
      },
      waitForTask: async (_projectId: string, taskId: string) => {
        if (progressSnapshots[taskId]) {
          await new Promise((resolve) => setTimeout(resolve, 30));
        }
        const snapshot = snapshots[index];
        index += 1;
        if (!snapshot) {
          throw new Error(`No snapshot configured for ${taskId}`);
        }

        return {
          ...snapshot,
          taskId,
        };
      },
      getTaskSnapshot: async (_projectId: string, taskId: string) => {
        const snapshotsForTask = progressSnapshots[taskId];
        if (!snapshotsForTask?.length) {
          return null;
        }

        const currentIndex = progressIndex.get(taskId) ?? 0;
        const snapshot = snapshotsForTask[Math.min(currentIndex, snapshotsForTask.length - 1)];
        progressIndex.set(taskId, currentIndex + 1);
        return {
          ...snapshot,
          taskId,
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
    expect(analyzeManagerTaskSnapshot(runningSnapshot()).kind).toBe("working");
    expect(
      analyzeManagerTaskSnapshot(
        runningSnapshot({
          stalledForMs: 45_000,
          lastObservation: "Pane updated: no new output",
        }),
      ).kind,
    ).toBe("stalled");
    expect(
      analyzeManagerTaskSnapshot(
        runningSnapshot({
          panePreview: "npm ERR! missing script: test",
          lastObservation: "Pane updated: npm ERR! missing script: test",
        }),
      ).kind,
    ).toBe("error");
  });

  test("creates .project artifacts and runs implementation then verification sessions", async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), "work-helper-manager-"));
    const { runner, submitted, destroyed } = createRunner([
      baseSnapshot({ answerPreview: "implementation complete" }),
      baseSnapshot({ answerPreview: "verification complete" }),
    ]);

    const result = await handleManagerRequest(
      {
        projectId: "demo-project",
        projectType: "code",
        request: "Create a React todo app",
        workspaceDir,
        provider: "codex",
        maxAttempts: 1,
        verifyCompletion: async () => ({ ok: true, summary: "filesystem verified" }),
      },
      runner,
    );

    expect(result.ok).toBe(true);
    expect(result.decision).toBe("complete");
    expect(result.attempts).toHaveLength(1);
    expect(submitted).toHaveLength(2);
    expect(submitted[0]?.taskId).toContain("implement");
    expect(submitted[1]?.taskId).toContain("verify");
    expect(submitted[0]?.prompt).toContain("draft_");
    expect(submitted[0]?.prompt).toContain("Implement the requested code changes");
    expect(submitted[1]?.prompt).toContain("Verify the implementation");
    expect(submitted[1]?.prompt).toContain("Playwright");
    expect(destroyed).toEqual(["demo-project", "demo-project"]);

    const projectPath = join(workspaceDir, ".project", "project.md");
    const jobRoot = join(workspaceDir, ".project", "job");
    const dates = await Bun.file(projectPath).text();
    expect(dates).toContain("Create a React todo app");

    const jobDirs = await Array.fromAsync(new Bun.Glob("*").scan({ cwd: jobRoot, onlyFiles: false }));
    expect(jobDirs.length).toBe(1);

    const jobDir = join(jobRoot, jobDirs[0] as string);
    const jobFiles = await Array.fromAsync(new Bun.Glob("job_*.md").scan({ cwd: jobDir }));
    const draftFiles = await Array.fromAsync(new Bun.Glob("draft_*.yaml").scan({ cwd: jobDir }));

    expect(jobFiles).toHaveLength(1);
    expect(draftFiles).toHaveLength(1);

    const jobDocument = await readFile(join(jobDir, jobFiles[0] as string), "utf8");
    const draftDocument = await readFile(join(jobDir, draftFiles[0] as string), "utf8");
    expect(jobDocument).toContain("# check");
    expect(jobDocument).toContain("verification complete");
    expect(draftDocument).toContain("tasks:");
  });

  test("does not run verification session when implementation session fails", async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), "work-helper-manager-"));
    const { runner, submitted } = createRunner([
      baseSnapshot({
        status: "failed",
        stage: "provider_output_started_no_final_answer",
        errorReason: "implementation failed",
        answerPreview: "still working",
      }),
    ]);

    const result = await handleManagerRequest(
      {
        projectId: "demo-project",
        projectType: "code",
        request: "Create a React todo app",
        workspaceDir,
        provider: "codex",
        maxAttempts: 1,
      },
      runner,
    );

    expect(result.ok).toBe(false);
    expect(result.decision).toBe("halt");
    expect(submitted).toHaveLength(1);
    expect(submitted[0]?.taskId).toContain("implement");
  });

  test("uses progress analysis to explain likely errors before task exit", async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), "work-helper-manager-"));
    const implementationTaskId = "demo-project-attempt-1-implement";
    const { runner } = createRunner(
      [
        baseSnapshot({
          status: "failed",
          stage: "timeout" as RunPromptStage,
          errorReason: "The task exceeded the configured total timeout.",
          answerPreview: null,
        }),
      ],
      {
        [implementationTaskId]: [
          runningSnapshot({
            panePreview: "npm ERR! missing script: test",
            lastObservation: "Pane updated: npm ERR! missing script: test",
          }),
        ],
      },
    );

    const result = await handleManagerRequest(
      {
        projectId: "demo-project",
        projectType: "code",
        request: "Create a React todo app",
        workspaceDir,
        provider: "codex",
        maxAttempts: 1,
      },
      runner,
    );

    expect(result.ok).toBe(false);
    expect(result.reason).toContain("npm ERR! missing script: test");
  });

  test("truncates long requests so artifact file names remain writable", async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), "work-helper-manager-"));
    const { runner } = createRunner([
      baseSnapshot({ answerPreview: "implementation complete" }),
      baseSnapshot({ answerPreview: "verification complete" }),
    ]);

    await handleManagerRequest(
      {
        projectId: "demo-project",
        projectType: "code",
        request:
          "Create a minimal React todo app directly in ~/temp. Put the app root at ~/temp and create package.json, index.html, vite.config.js, src/main.jsx, src/App.jsx, and src/styles.css. Add a simple todo UI. Do not install dependencies or run the dev server. Reply with only COMPLETED.",
        workspaceDir,
        provider: "codex",
        maxAttempts: 1,
        verifyCompletion: async () => ({ ok: true, summary: "filesystem verified" }),
      },
      runner,
    );

    const jobRoot = join(workspaceDir, ".project", "job");
    const jobDirs = await Array.fromAsync(new Bun.Glob("*").scan({ cwd: jobRoot, onlyFiles: false }));
    const jobDir = join(jobRoot, jobDirs[0] as string);
    const jobFiles = await Array.fromAsync(new Bun.Glob("job_*.md").scan({ cwd: jobDir }));

    expect(jobFiles).toHaveLength(1);
    expect((jobFiles[0] as string).length).toBeLessThan(120);
  });

  test("uses an injected project layer for project, job, and draft documents", async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), "work-helper-manager-"));
    const { runner } = createRunner([
      baseSnapshot({ answerPreview: "implementation complete" }),
      baseSnapshot({ answerPreview: "verification complete" }),
    ]);
    const artifactService: ProjectArtifactService = {
      projectType: "mono",
      renderProjectDocument: () => "project: custom-mono",
      readProjectDocument: () => "project doc: custom-mono",
      renderJobDocument: () => "job: custom-mono",
      renderDraftDocument: () => "draft: custom-mono",
      readJobDocument: () => "job reader: custom-mono",
      runBuildStage: () => ["draft", "classify", "test", "implement", "verify"],
      runCheckStage: () => "check",
      buildBootstrapPrompt: () => "bootstrap prompt: custom-mono",
    };
    const projectLayer = Layer.succeed(ProjectTag, artifactService);

    await handleManagerRequest(
      {
        projectId: "demo-project",
        projectType: "mono",
        request: "Create a React todo app",
        workspaceDir,
        provider: "codex",
        maxAttempts: 1,
        projectLayer,
        verifyCompletion: async () => ({ ok: true, summary: "filesystem verified" }),
      },
      runner,
    );

    const projectDocument = await readFile(join(workspaceDir, ".project", "project.md"), "utf8");
    const jobRoot = join(workspaceDir, ".project", "job");
    const jobDirs = await Array.fromAsync(new Bun.Glob("*").scan({ cwd: jobRoot, onlyFiles: false }));
    const jobDir = join(jobRoot, jobDirs[0] as string);
    const jobFiles = await Array.fromAsync(new Bun.Glob("job_*.md").scan({ cwd: jobDir }));
    const draftFiles = await Array.fromAsync(new Bun.Glob("draft_*.yaml").scan({ cwd: jobDir }));
    const jobDocument = await readFile(join(jobDir, jobFiles[0] as string), "utf8");
    const draftDocument = await readFile(join(jobDir, draftFiles[0] as string), "utf8");

    expect(projectDocument).toContain("project: custom-mono");
    expect(jobDocument).toContain("job: custom-mono");
    expect(draftDocument).toContain("draft: custom-mono");
  });
});
