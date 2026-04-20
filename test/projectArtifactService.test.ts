import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { readProjectJobDocumentEffect, ProjectTag, createProjectLayerForType } from "../src/server/artifacts";
import { runBuildStageEffect, runCheckStageEffect } from "../src/main";

describe("project artifact services", () => {
  test("provides a service for each supported project type through a layer", async () => {
    const codeService = await Effect.runPromise(
      Effect.gen(function* () {
        return yield* ProjectTag;
      }).pipe(Effect.provide(createProjectLayerForType("code"))),
    );
    const monoService = await Effect.runPromise(
      Effect.gen(function* () {
        return yield* ProjectTag;
      }).pipe(Effect.provide(createProjectLayerForType("mono"))),
    );

    expect(codeService.projectType).toBe("code");
    expect(monoService.projectType).toBe("mono");
  });

  test("default code service renders typed project artifacts", async () => {
    const context = {
      projectId: "demo-project",
      projectType: "code" as const,
      projectSpec: "typescript" as const,
      request: "게시물 삭제 기능 추가",
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
    expect(jobDocument).toContain("#requirements");
    expect(drafts.length).toBeGreaterThan(0);
    expect(drafts[0]?.content).toContain("tasks:");
  });

  test("project layer is also used for job reader, build, and check", async () => {
    const jobContents = await Effect.runPromise(
      readProjectJobDocumentEffect("/tmp/sample-job.md").pipe(Effect.provide(createProjectLayerForType("code"))),
    );
    const buildSubstages = Effect.runSync(
      runBuildStageEffect((message) => message).pipe(Effect.provide(createProjectLayerForType("code"))),
    );
    const checkStage = Effect.runSync(
      runCheckStageEffect((message) => message).pipe(Effect.provide(createProjectLayerForType("code"))),
    );

    expect(jobContents).toContain("/tmp/sample-job.md");
    expect(buildSubstages).toEqual(["implement"]);
    expect(checkStage).toBe("check");
  });
});
