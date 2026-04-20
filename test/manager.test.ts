import { describe, expect, test } from "bun:test";
import { Layer } from "effect";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyzeManagerJobSnapshot, handleManagerRequest } from "../src/manager";
import { ProjectTag } from "../src/server/artifacts";
import type {
  ProjectArtifactService,
  ProjectJobSnapshot,
  ProjectTmuxJobOptions,
  RunPromptStage,
} from "../src/types";

const baseSnapshot = (overrides: Partial<ProjectJobSnapshot> = {}): ProjectJobSnapshot => ({
  projectId: "demo-project",
  jobId: "demo-job",
  provider: "codex",
  workspaceDir: "/tmp/demo",
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
        const snapshotsForJob = progressSnapshots[jobId];
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
    expect(submitted[0]?.jobId).toContain("build");
    expect(submitted[1]?.jobId).toContain("check");
    expect(submitted[0]?.prompt).toContain("/drafts/");
    expect(submitted[0]?.prompt).toContain("Follow TDD");
    expect(submitted[1]?.prompt).toContain("Use only the job document as the source of truth");
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
    const draftFiles = await Array.fromAsync(new Bun.Glob("drafts/*.yaml").scan({ cwd: jobDir }));

    expect(jobFiles).toHaveLength(1);
    expect(draftFiles.length).toBeGreaterThan(0);

    const jobDocument = await readFile(join(jobDir, jobFiles[0] as string), "utf8");
    const draftDocument = await readFile(join(jobDir, draftFiles[0] as string), "utf8");
    expect(jobDocument).toContain("# check");
    expect(jobDocument).toContain("[check]");
    expect(draftDocument).toContain("tasks:");
    expect(result.attempts[0]?.draftExecutions.length).toBeGreaterThan(0);
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
    expect(submitted[0]?.jobId).toContain("build");
  });

  test("uses progress analysis to explain likely errors before job exit", async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), "work-helper-manager-"));
    const implementationJobId = "demo-project-attempt-1-build-create_a_react_todo_app";
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
        [implementationJobId]: [
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

    const request = "Create ".repeat(80);
    const result = await handleManagerRequest(
      {
        projectId: "demo-project",
        projectType: "code",
        request,
        workspaceDir,
        provider: "codex",
        maxAttempts: 1,
        verifyCompletion: async () => ({ ok: true, summary: "filesystem verified" }),
      },
      runner,
    );

    expect(result.ok).toBe(true);

    const jobRoot = join(workspaceDir, ".project", "job");
    const jobDirs = await Array.fromAsync(new Bun.Glob("*").scan({ cwd: jobRoot, onlyFiles: false }));
    expect(jobDirs).toHaveLength(1);
    expect((jobDirs[0] as string).length).toBeLessThanOrEqual(120);
  });

  test("uses supplied project layer when reading and writing artifacts", async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), "work-helper-manager-"));
    const { runner } = createRunner([
      baseSnapshot({ answerPreview: "implementation complete" }),
      baseSnapshot({ answerPreview: "verification complete" }),
    ]);

    const artifactService: ProjectArtifactService = {
      projectType: "code",
      renderProjectDocument: ({ request }) => `project:${request}`,
      readProjectDocument: () => "project",
      renderJobDocument: ({ request }) => `job:${request}`,
      renderDraftDocuments: ({ request }) => [
        {
          draftId: "custom_draft",
          title: request,
          summary: "custom_draft",
          path: "",
          kind: "action",
          dependsOn: [],
          content: `draft:${request}`,
        },
      ],
      readJobDocument: () => "job",
      runBuildStage: () => [],
      runCheckStage: () => "check",
      buildBootstrapPrompt: async () => "bootstrap",
    };

    const projectLayer = Layer.succeed(ProjectTag, artifactService);
    const result = await handleManagerRequest(
      {
        projectId: "demo-project",
        projectType: "code",
        request: "Create a React todo app",
        workspaceDir,
        provider: "codex",
        maxAttempts: 1,
        projectLayer,
        verifyCompletion: async () => ({ ok: true, summary: "filesystem verified" }),
      },
      runner,
    );

    expect(result.ok).toBe(true);
    expect(await Bun.file(join(workspaceDir, ".project", "project.md")).text()).toBe("project:Create a React todo app");
  });
});
