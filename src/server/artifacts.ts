import { Context, Effect, Layer } from "effect";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { classifyRequirementItemKind, renderJobDocument, renderTasksDocument, TaskKind } from "./job";
import { buildLegacyRemovalChecklist, createProjectMetadataDocument } from "./project";
import { loadPromptTemplate } from "../prompts";
import type { ProjectArtifactService, ProjectType } from "../types";

const defaultStatusText = "wait";
const bootstrapPromptPath = join(process.cwd(), "assets", "basic", "prompts", "bootstrap.md");

export const ProjectTag = Context.GenericTag<ProjectArtifactService>("@work_helper/Project");

const createDefaultArtifactService = (projectType: ProjectType): ProjectArtifactService => ({
  projectType,
  renderProjectDocument: (context) =>
    createProjectMetadataDocument({
      name: context.projectId,
      type: context.projectType,
      description: context.request,
      spec: context.projectSpec,
      path: context.workspaceDir,
      state: "check",
    }),
  readProjectDocument: async (projectFilePath) => readFile(projectFilePath, "utf8"),
  renderJobDocument: (context) => {
    const kind = classifyRequirementItemKind(context.request);
    const logicChecklist = [
      "테스트가 먼저 작성되었는지 확인한다.",
      ...buildLegacyRemovalChecklist(context.request),
    ];

    return renderJobDocument({
      requestName: context.request,
      requirements: [
        {
          kind,
          name: context.request,
        },
      ],
      logicChecklist,
      uiChecklist: ["모바일 모드 화면 깨짐 여부를 검사한다."],
      problems: [],
    });
  },
  renderDraftDocument: (context) => {
    const taskName = context.request.trim();
    const taskKind = /(create|생성|추가|implement|todo|react|project)/iu.test(taskName) ? TaskKind.Action : TaskKind.Calc;
    const draftTask = taskName ? `request > ${taskName}` : "input > output";

    return renderTasksDocument({
      name: taskName,
      calc: taskKind === TaskKind.Calc ? [{ name: draftTask, status: defaultStatusText }] : [],
      action: taskKind === TaskKind.Action ? [{ name: draftTask, status: defaultStatusText }] : [],
      check: ["unit test를 먼저 작성한다.", "구현 후 검증 세션에서 결과를 점검한다."],
    });
  },
  readJobDocument: (jobFilePath) => `job.md reader: ${jobFilePath}`,
  runBuildStage: (logger) => {
    logger("build");
    const orderedSubstages = ["draft", "classify", "test", "implement", "verify"] as const;

    for (const substage of orderedSubstages) {
      logger(`build:${substage}`);
    }

    return [...orderedSubstages];
  },
  runCheckStage: (logger) => {
    logger("check");
    return "check";
  },
  buildBootstrapPrompt: async (context) => {
    const template = await loadPromptTemplate(bootstrapPromptPath);
    return template
      .replaceAll("{{project_type}}", context.projectType)
      .replaceAll("{{project_spec}}", context.projectSpec)
      .replaceAll("{{workspace_dir}}", context.workspaceDir);
  },
});

export const createProjectServiceForType = (projectType: ProjectType): ProjectArtifactService =>
  createDefaultArtifactService(projectType);

export const createProjectLayer = (service: ProjectArtifactService) => Layer.succeed(ProjectTag, service);

export const createProjectLayerForType = (projectType: ProjectType) =>
  createProjectLayer(createProjectServiceForType(projectType));

export const readProjectJobDocumentEffect = (jobFilePath: string) =>
  Effect.gen(function* () {
    const project = yield* ProjectTag;
    return yield* Effect.promise(() => Promise.resolve(project.readJobDocument(jobFilePath)));
  });
