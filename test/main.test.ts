import { describe, expect, test } from "bun:test";
import { Effect, Layer, Schema } from "effect";
import {
  BuildSubstage,
  ProjectStage,
  ProjectTransition,
  RequestStageEntryError,
  RequestStageInputSchema,
  runRequestStageEffect,
  runAnalyzeStage,
  runBuildStageEffect,
  runBuildStage,
  runCheckStageEffect,
  runCheckStage,
  runInitStage,
  runPlanStage,
  runProjectPipeline,
  runRequestStage,
} from "../src/main";
import { MakeDraftTag, MakeJobTag, MakeProjectTag, ProjectTag, StageRuntimeTag, createProjectLayer } from "../src/server/artifacts";
import type { MakeDraftService, MakeJobService, MakeProjectService, ProjectArtifactService, StageRuntimeService } from "../src/types";

describe("project pipeline", () => {
  test("defines the fixed project stages", () => {
    expect(String(ProjectStage.Request)).toBe("request");
    expect(String(ProjectStage.Init)).toBe("init");
    expect(String(ProjectStage.Plan)).toBe("plan");
    expect(String(ProjectStage.Analyze)).toBe("analyze");
    expect(String(ProjectStage.Build)).toBe("build");
    expect(String(ProjectStage.Check)).toBe("check");
  });

  test("defines the documented transitions and build substages", () => {
    expect(String(ProjectTransition.RequestToInit)).toBe("request->init");
    expect(String(ProjectTransition.RequestToImportProject)).toBe("request->import-project");
    expect(String(ProjectTransition.RequestToPlan)).toBe("request->plan");
    expect(String(ProjectTransition.RequestToCheck)).toBe("request->check");
    expect(String(ProjectTransition.PlanToAnalyze)).toBe("plan->analyze");
    expect(String(ProjectTransition.AnalyzeToBuild)).toBe("analyze->build");
    expect(String(ProjectTransition.BuildToCheck)).toBe("build->check");
    expect(String(BuildSubstage.Implement)).toBe("implement");
  });

  test("request stage chooses check for explicit fix requests on existing projects", () => {
    const logs: string[] = [];
    const result = runRequestStage(
      {
        request: "기존 프로젝트 버그 수정",
        hasProjectMetadata: true,
        workspaceEmpty: false,
        hasSourceFiles: true,
      },
      (message) => logs.push(message),
    );

    expect(result.transition).toBe(ProjectTransition.RequestToCheck);
    expect(logs).toEqual(["request", "request->check"]);
  });

  test("request stage exposes effect schema and tagged entry error", async () => {
    const requestError = await Effect.runPromise(Effect.flip(runRequestStageEffect({})));
    expect(requestError).toBeInstanceOf(RequestStageEntryError);
    const decoded = Effect.runSync(
      Schema.decodeUnknown(RequestStageInputSchema)({
        request: "기능 추가",
        hasProjectMetadata: true,
        workspaceEmpty: false,
        hasSourceFiles: true,
      }),
    );
    expect(decoded.request).toBe("기능 추가");
  });

  test("request stage chooses init for empty workspaces without .project", () => {
    const result = runRequestStage({
      request: "새 프로젝트 시작",
      hasProjectMetadata: false,
      workspaceEmpty: true,
      hasSourceFiles: false,
    });

    expect(result.transition).toBe(ProjectTransition.RequestToInit);
  });

  test("request stage chooses import-project when sources exist without metadata", () => {
    const result = runRequestStage({
      request: "기존 소스를 가져와",
      hasProjectMetadata: false,
      workspaceEmpty: false,
      hasSourceFiles: true,
    });

    expect(result.transition).toBe(ProjectTransition.RequestToImportProject);
  });

  test("request stage chooses plan otherwise", () => {
    const result = runRequestStage({
      request: "기능 추가해줘",
      hasProjectMetadata: true,
      workspaceEmpty: false,
      hasSourceFiles: true,
    });

    expect(result.transition).toBe(ProjectTransition.RequestToPlan);
  });

  test("build stage runs the documented implementation substage", () => {
    const logs: string[] = [];
    const result = runBuildStage((message) => logs.push(message));

    expect(result).toEqual([BuildSubstage.Implement]);
    expect(logs).toEqual(["build", "build:implement"]);
  });

  test("pipeline runs request -> init for a new project", () => {
    const logs: string[] = [];
    const result = runProjectPipeline(
      {
        request: "새 프로젝트 생성",
        hasProjectMetadata: false,
        workspaceEmpty: true,
        hasSourceFiles: false,
      },
      (message) => logs.push(message),
    );

    expect(result.executedStages).toEqual([ProjectStage.Request, ProjectStage.Init]);
    expect(result.transitions).toEqual([ProjectTransition.RequestToInit]);
    expect(logs).toEqual(["request", "request->init", "init"]);
  });

  test("pipeline runs request -> plan -> analyze -> build -> check for feature work", () => {
    const logs: string[] = [];
    const result = runProjectPipeline(
      {
        request: "게시물 삭제 기능 추가",
        hasProjectMetadata: true,
        workspaceEmpty: false,
        hasSourceFiles: true,
      },
      (message) => logs.push(message),
    );

    expect(result.executedStages).toEqual([
      ProjectStage.Request,
      ProjectStage.Plan,
      ProjectStage.Analyze,
      ProjectStage.Build,
      ProjectStage.Check,
    ]);
    expect(result.transitions).toEqual([
      ProjectTransition.RequestToPlan,
      ProjectTransition.PlanToAnalyze,
      ProjectTransition.AnalyzeToBuild,
      ProjectTransition.BuildToCheck,
    ]);
    expect(logs).toEqual([
      "request",
      "request->plan",
      "plan",
      "plan->analyze",
      "analyze",
      "analyze->build",
      "build",
      "build:implement",
      "build->check",
      "check",
    ]);
  });

  test("individual stage helpers return their matching stage", () => {
    expect(runInitStage()).toBe(ProjectStage.Init);
    expect(runPlanStage()).toBe(ProjectStage.Plan);
    expect(runAnalyzeStage()).toBe(ProjectStage.Analyze);
    expect(runCheckStage()).toBe(ProjectStage.Check);
  });

  test("build/check effect stages can be overridden by a project layer", () => {
    const messages: string[] = [];
    const customProject: ProjectArtifactService = {
      projectType: "mono",
      renderProjectDocument: () => "project",
      readProjectDocument: () => "project doc",
      renderJobDocument: () => "job",
      renderDraftDocuments: () => [],
      readJobDocument: () => "job reader",
      runBuildStage: (logger) => {
        logger("custom-build");
        return ["custom-implement"];
      },
      runCheckStage: (logger) => {
        logger("custom-check");
        return "custom-check";
      },
      buildBootstrapPrompt: () => "bootstrap prompt",
    };
    const layer = createProjectLayer(customProject);

    const overriddenBuild = Effect.runSync(
      runBuildStageEffect((message) => messages.push(message)).pipe(Effect.provide(layer)),
    );
    const overriddenCheck = Effect.runSync(
      runCheckStageEffect((message) => messages.push(message)).pipe(Effect.provide(layer)),
    );

    expect(overriddenBuild).toEqual(["custom-implement"]);
    expect(overriddenCheck).toBe("custom-check");
    expect(messages).toEqual(["custom-build", "custom-check"]);
  });

  test("individual provider tags can be overridden independently", async () => {
    const makeProjectLayer = Layer.succeed(MakeProjectTag, {
      projectType: "code",
      makeProject: () => "project-doc",
      readProject: () => "project-doc",
    } satisfies MakeProjectService);
    const makeJobLayer = Layer.succeed(MakeJobTag, {
      projectType: "code",
      makeJob: () => "job-doc",
      readJob: () => "job-doc",
    } satisfies MakeJobService);
    const makeDraftLayer = Layer.succeed(MakeDraftTag, {
      projectType: "code",
      makeDraft: () => [],
    } satisfies MakeDraftService);
    const stageRuntimeLayer = Layer.succeed(StageRuntimeTag, {
      projectType: "code",
      runBuildStage: () => ["tag-build"],
      runCheckStage: () => "tag-check",
    } satisfies StageRuntimeService);
    const projectLayer = Layer.succeed(ProjectTag, {
      projectType: "code",
      renderProjectDocument: () => "project-doc",
      readProjectDocument: () => "project-doc",
      renderJobDocument: () => "job-doc",
      renderDraftDocuments: () => [],
      readJobDocument: () => "job-doc",
      runBuildStage: () => ["tag-build"],
      runCheckStage: () => "tag-check",
      buildBootstrapPrompt: () => "bootstrap-doc",
    } satisfies ProjectArtifactService);

    const buildResult = Effect.runSync(
      runBuildStageEffect(() => {}).pipe(
        Effect.provide(Layer.mergeAll(makeProjectLayer, makeJobLayer, makeDraftLayer, stageRuntimeLayer, projectLayer)),
      ),
    );
    const checkResult = Effect.runSync(
      runCheckStageEffect(() => {}).pipe(
        Effect.provide(Layer.mergeAll(makeProjectLayer, makeJobLayer, makeDraftLayer, stageRuntimeLayer, projectLayer)),
      ),
    );

    expect(buildResult).toEqual(["tag-build"]);
    expect(checkResult).toBe("tag-check");
  });
});
