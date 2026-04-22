import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  handleRequest,
  runAnalyzeStep,
  runBuildStep,
  runCheckStep,
  runImproveStep,
  runInitStep,
  runPlanStep,
} from "../src/cli";
import type { CliJobRunner, ProjectJobSnapshot, ProjectTmuxJobOptions } from "../src/types";

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

const createRunner = (snapshots: ProjectJobSnapshot[]) => {
  const submitted: ProjectTmuxJobOptions[] = [];
  const destroyed: string[] = [];
  let index = 0;

  const runner: CliJobRunner = {
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
    getJobSnapshot: async () => null,
    destroySession: async (projectId: string) => {
      destroyed.push(projectId);
    },
  };

  return {
    runner,
    submitted,
    destroyed,
  };
};

describe("cli wrappers", () => {
  test("runInitStep creates project metadata without bootstrap when disabled", async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), "work-helper-cli-init-"));

    const result = await runInitStep({
      projectId: "demo-project",
      projectType: "code",
      request: "Create a React todo app",
      workspaceDir,
      provider: "codex",
      bootstrap: false,
    });

    expect(result.ok).toBe(true);
    expect(result.bootstrap).toBeNull();
    expect(await Bun.file(result.projectFilePath).text()).toContain("Create a React todo app");
  });

  test("runPlanStep and runAnalyzeStep create job and draft artifacts", async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), "work-helper-cli-plan-"));
    await mkdir(join(workspaceDir, ".project"), { recursive: true });

    const plan = await runPlanStep({
      projectId: "demo-project",
      projectType: "code",
      request: "학생 선물 출력 기능 추가",
      workspaceDir,
      provider: "codex",
    });
    const analyze = await runAnalyzeStep({
      projectId: "demo-project",
      projectType: "code",
      request: "학생 선물 출력 기능 추가",
      workspaceDir,
      provider: "codex",
      timestamp: plan.timestamp,
      summary: plan.summary,
      projectSpec: plan.projectSpec,
      jobFilePath: plan.jobFilePath,
      jobDocument: plan.jobDocument,
    });

    expect(plan.jobDocument).toContain("# check");
    expect(analyze.drafts.length).toBeGreaterThan(0);
    expect(await Bun.file(analyze.drafts[0]!.path).text()).toContain("priority:");
    expect(await Bun.file(plan.jobFilePath).text()).toContain("[analyze] generated drafts");
  });

  test("runBuildStep executes drafts in dependency order and appends build reports", async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), "work-helper-cli-build-"));
    await mkdir(join(workspaceDir, ".project"), { recursive: true });
    const { runner, submitted, destroyed } = createRunner([
      baseSnapshot({ answerPreview: "draft 1 complete" }),
      baseSnapshot({ answerPreview: "draft 2 complete" }),
      baseSnapshot({ answerPreview: "draft 3 complete" }),
    ]);

    const plan = await runPlanStep({
      projectId: "demo-project",
      projectType: "code",
      request: "학생 선물 출력 기능 추가",
      workspaceDir,
      provider: "codex",
    });
    const analyze = await runAnalyzeStep({
      projectId: "demo-project",
      projectType: "code",
      request: "학생 선물 출력 기능 추가",
      workspaceDir,
      provider: "codex",
      timestamp: plan.timestamp,
      summary: plan.summary,
      projectSpec: plan.projectSpec,
      jobFilePath: plan.jobFilePath,
      jobDocument: plan.jobDocument,
    });
    const build = await runBuildStep({
      projectId: "demo-project",
      projectType: "code",
      request: "학생 선물 출력 기능 추가",
      workspaceDir,
      provider: "codex",
      timestamp: analyze.timestamp,
      summary: analyze.summary,
      jobFilePath: analyze.jobFilePath,
      drafts: analyze.drafts,
      runner,
    });

    expect(build.ok).toBe(true);
    expect(build.executions).toHaveLength(3);
    expect(submitted).toHaveLength(3);
    expect(submitted[0]?.prompt).toContain("Draft priority: 1");
    expect(submitted[1]?.prompt).toContain("Draft priority: 2");
    expect(submitted[2]?.prompt).toContain("Draft priority: 3");
    expect(destroyed).toEqual(["demo-project", "demo-project"]);

    const jobDocument = await readFile(plan.jobFilePath, "utf8");
    expect(jobDocument).toContain("[build:age_band]");
    expect(jobDocument).toContain("[build:gift_rule]");
    expect(jobDocument).toContain("[build:gift_print]");
  });

  test("runCheckStep and runImproveStep produce a follow-up request when check halts", async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), "work-helper-cli-check-"));
    await mkdir(join(workspaceDir, ".project"), { recursive: true });
    const { runner } = createRunner([
      baseSnapshot({
        answerPreview: "needs more work",
        panePreview: "needs more work",
      }),
    ]);

    const plan = await runPlanStep({
      projectId: "demo-project",
      projectType: "code",
      request: "게시물 삭제 기능 추가",
      workspaceDir,
      provider: "codex",
    });
    const check = await runCheckStep({
      projectId: "demo-project",
      projectType: "code",
      request: "게시물 삭제 기능 추가",
      workspaceDir,
      provider: "codex",
      timestamp: plan.timestamp,
      summary: plan.summary,
      jobFilePath: plan.jobFilePath,
      runner,
    });
    const improve = await runImproveStep({
      projectId: "demo-project",
      projectType: "code",
      request: "게시물 삭제 기능 추가",
      workspaceDir,
      provider: "codex",
      jobFilePath: plan.jobFilePath,
      check,
    });

    expect(check.ok).toBe(false);
    expect(check.decision).toBe("halt");
    expect(improve.decision).toBe("continue");
    expect(improve.nextRequest).toContain("작업 마무리(개선) 단계");
    expect(improve.report).toContain("[check]");
  });

  test("handleRequest runs init and one improve retry before completing", async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), "work-helper-cli-handler-"));
    const { runner } = createRunner([
      baseSnapshot({ answerPreview: "build complete" }),
      baseSnapshot({ answerPreview: "needs more work", panePreview: "needs more work" }),
      baseSnapshot({ answerPreview: "improved build complete" }),
      baseSnapshot({ answerPreview: "COMPLETED" }),
    ]);

    const result = await handleRequest({
      projectId: "demo-project",
      projectType: "code",
      request: "게시물 삭제 기능 추가",
      workspaceDir,
      provider: "codex",
      bootstrap: false,
      runner,
      maxImproveIterations: 1,
    });

    expect(result.ok).toBe(true);
    expect(result.request.transition).toBe("request->init");
    expect(result.init?.projectFilePath).toContain(".project/project.md");
    expect(result.cycles).toHaveLength(2);
    expect(result.cycles[0]?.improve?.decision).toBe("continue");
    expect(result.cycles[1]?.check?.decision).toBe("complete");
    expect(result.finalDecision).toBe("complete");
  });
});
