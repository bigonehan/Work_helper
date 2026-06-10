import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import {
  MakeDraftTag,
  MakeJobTag,
  MakeProjectTag,
  ProjectTag,
  StageRuntimeTag,
  readProjectJobDocumentEffect,
  createProjectLayerForType,
} from "../src/server/artifacts";
import { runBuildStageEffect, runCheckStageEffect } from "../src/main";

describe("project artifact services", () => {
  test("provides a service for each supported project type through a layer", async () => {
    const codeServices = await Effect.runPromise(
      Effect.gen(function* () {
        return {
          project: yield* ProjectTag,
          makeProject: yield* MakeProjectTag,
          makeJob: yield* MakeJobTag,
          makeDraft: yield* MakeDraftTag,
          stageRuntime: yield* StageRuntimeTag,
        };
      }).pipe(Effect.provide(createProjectLayerForType("code"))),
    );
    const monoService = await Effect.runPromise(
      Effect.gen(function* () {
        return yield* ProjectTag;
      }).pipe(Effect.provide(createProjectLayerForType("mono"))),
    );

    expect(codeServices.project.projectType).toBe("code");
    expect(codeServices.makeProject.projectType).toBe("code");
    expect(codeServices.makeJob.projectType).toBe("code");
    expect(codeServices.makeDraft.projectType).toBe("code");
    expect(codeServices.stageRuntime.projectType).toBe("code");
    expect(monoService.projectType).toBe("mono");
  });

  test("default code service renders typed project artifacts", async () => {
    const context = {
      projectId: "demo-project",
      projectType: "code" as const,
      projectSpec: "typescript" as const,
      request: "게시물 삭제 기능 추가",
      jobDocument: "",
      workspaceDir: "/tmp/demo",
      timestamp: "260418_1500",
      summary: "게시물_삭제_기능_추가",
    };

    const { projectDocument, jobDocument, drafts } = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* ProjectTag;
        return {
          projectDocument: yield* Effect.sync(() => service.renderProjectDocument(context)),
          jobDocument: yield* Effect.sync(() => service.renderJobDocument(context)),
          drafts: yield* Effect.promise(() => Promise.resolve(service.renderDraftDocuments(context))),
        };
      }).pipe(Effect.provide(createProjectLayerForType("code"))),
    );

    expect(projectDocument).toContain("## type");
    expect(projectDocument).toContain("code");
    expect(projectDocument).toContain("# 3. 해결책");
    expect(projectDocument).toContain("## 요구");
    expect(projectDocument).toContain("## 데이터");
    expect(jobDocument).toContain("#requirements");
    expect(drafts.length).toBeGreaterThan(0);
    expect(drafts[0]?.content).toContain("id:");
    expect(drafts[0]?.content).toContain("description:");
    expect(drafts[0]?.content).toContain("priority:");
    expect(drafts[0]?.content).toContain("dependsOn:");
    expect(drafts[0]?.priority).toBeGreaterThan(0);
  });

  test("default mono service renders the shared Project.md content in project metadata", async () => {
    const context = {
      projectId: "mono-demo",
      projectType: "mono" as const,
      projectSpec: "typescript" as const,
      request: "모노레포 프로젝트",
      jobDocument: "",
      workspaceDir: "/tmp/mono-demo",
      timestamp: "260418_1500",
      summary: "모노레포",
    };

    const projectDocument = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* ProjectTag;
        return yield* Effect.sync(() => service.renderProjectDocument(context));
      }).pipe(Effect.provide(createProjectLayerForType("mono"))),
    );

    expect(projectDocument).toContain("## type\nmono");
    expect(projectDocument).toContain("# 3. 해결책");
    expect(projectDocument).toContain("## 요구");
    expect(projectDocument).toContain("## 데이터");
  });

  test("project layer is also used for job reader, build, and check", async () => {
    await Bun.write("/tmp/sample-job.md", "job contents");
    const jobContents = await Effect.runPromise(
      readProjectJobDocumentEffect("/tmp/sample-job.md").pipe(Effect.provide(createProjectLayerForType("code"))),
    );
    const buildSubstages = Effect.runSync(
      runBuildStageEffect((message) => message).pipe(Effect.provide(createProjectLayerForType("code"))),
    );
    const checkStage = Effect.runSync(
      runCheckStageEffect((message) => message).pipe(Effect.provide(createProjectLayerForType("code"))),
    );

    expect(jobContents).toBe("job contents");
    expect(buildSubstages).toEqual(["implement"]);
    expect(checkStage).toBe("check");
  });
});
