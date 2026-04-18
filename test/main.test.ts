import { describe, expect, test } from "bun:test";
import { Effect, Layer } from "effect";
import {
  BuildSubstage,
  ProjectStage,
  ProjectTransition,
  runBuildStageEffect,
  runBuildStage,
  runCheckStageEffect,
  runCheckStage,
  runDecompileStage,
  runInitStage,
  runProjectPipeline,
  runRequestStage,
} from "../src/main";
import { ProjectTag } from "../src/server/artifacts";
import type { ProjectArtifactService } from "../src/types";

describe("project pipeline", () => {
  test("defines the fixed project stages", () => {
    expect(String(ProjectStage.Request)).toBe("request");
    expect(String(ProjectStage.Init)).toBe("init");
    expect(String(ProjectStage.Decompile)).toBe("decompile");
    expect(String(ProjectStage.Build)).toBe("build");
    expect(String(ProjectStage.Check)).toBe("check");
  });

  test("defines the documented transitions and build substages", () => {
    expect(String(ProjectTransition.RequestToInit)).toBe("request->init");
    expect(String(ProjectTransition.RequestToImportProject)).toBe("request->import-project");
    expect(String(ProjectTransition.RequestToPlan)).toBe("request->plan");
    expect(String(ProjectTransition.RequestToCheck)).toBe("request->check");
    expect(String(ProjectTransition.PlanToDecompile)).toBe("plan->disassemble");
    expect(String(ProjectTransition.DecompileToBuildDraft)).toBe("disassemble->build:draft");
    expect(String(BuildSubstage.Draft)).toBe("draft");
    expect(String(BuildSubstage.Classify)).toBe("classify");
    expect(String(BuildSubstage.Test)).toBe("test");
    expect(String(BuildSubstage.Implement)).toBe("implement");
    expect(String(BuildSubstage.Verify)).toBe("verify");
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

  test("build stage runs all documented substages in order", () => {
    const logs: string[] = [];
    const result = runBuildStage((message) => logs.push(message));

    expect(result).toEqual([
      BuildSubstage.Draft,
      BuildSubstage.Classify,
      BuildSubstage.Test,
      BuildSubstage.Implement,
      BuildSubstage.Verify,
    ]);
    expect(logs).toEqual([
      "build",
      "build:draft",
      "build:classify",
      "build:test",
      "build:implement",
      "build:verify",
    ]);
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

  test("pipeline runs request -> plan -> decompile -> build -> check for feature work", () => {
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
      ProjectStage.Decompile,
      ProjectStage.Build,
      ProjectStage.Check,
    ]);
    expect(result.transitions).toEqual([
      ProjectTransition.RequestToPlan,
      ProjectTransition.PlanToDecompile,
      ProjectTransition.DecompileToBuildDraft,
      ProjectTransition.BuildDraftToClassify,
      ProjectTransition.BuildClassifyToTest,
      ProjectTransition.BuildTestToImplement,
      ProjectTransition.BuildImplementToVerify,
      ProjectTransition.BuildVerifyToCheck,
    ]);
    expect(logs).toEqual([
      "request",
      "request->plan",
      "plan->disassemble",
      "decompile",
      "disassemble->build:draft",
      "build",
      "build:draft",
      "build:classify",
      "build:test",
      "build:implement",
      "build:verify",
      "build:verify->check",
      "check",
    ]);
  });

  test("individual stage helpers return their matching stage", () => {
    expect(runInitStage()).toBe(ProjectStage.Init);
    expect(runDecompileStage()).toBe(ProjectStage.Decompile);
    expect(runCheckStage()).toBe(ProjectStage.Check);
  });

  test("build/check effect stages can be overridden by a project layer", () => {
    const messages: string[] = [];
    const customProject: ProjectArtifactService = {
      projectType: "mono",
      renderProjectDocument: () => "project",
      readProjectDocument: () => "project doc",
      renderJobDocument: () => "job",
      renderDraftDocument: () => "draft",
      readJobDocument: () => "job reader",
      runBuildStage: (logger) => {
        logger("custom-build");
        return ["custom-draft", "custom-verify"];
      },
      runCheckStage: (logger) => {
        logger("custom-check");
        return "custom-check";
      },
      buildBootstrapPrompt: () => "bootstrap prompt",
    };
    const layer = Layer.succeed(ProjectTag, customProject);

    const overriddenBuild = Effect.runSync(
      runBuildStageEffect((message) => messages.push(message)).pipe(Effect.provide(layer)),
    );
    const overriddenCheck = Effect.runSync(
      runCheckStageEffect((message) => messages.push(message)).pipe(Effect.provide(layer)),
    );

    expect(overriddenBuild).toEqual(["custom-draft", "custom-verify"]);
    expect(overriddenCheck).toBe("custom-check");
    expect(messages).toEqual(["custom-build", "custom-check"]);
  });
});
