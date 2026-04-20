import { Context, Effect, Layer } from "effect";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { buildTaskDraft, classifyRequirementItemKind, renderJobDocument, renderTasksDocument, TaskKind } from "./job";
import { buildLegacyRemovalChecklist, createProjectMetadataDocument, toSnakeCaseSummary } from "./project";
import { loadPromptTemplate } from "../prompts";
import type { ManagerDraftArtifact, ProjectArtifactService, ProjectType } from "../types";

const defaultStatusText = "wait";
const bootstrapPromptPath = join(process.cwd(), "assets", "basic", "prompts", "bootstrap.md");

export const ProjectTag = Context.GenericTag<ProjectArtifactService>("@work_helper/Project");

interface DraftSeed {
  readonly title: string;
  readonly kind: "calc" | "action";
  readonly dependsOn: readonly string[];
  readonly checks: readonly string[];
}

const inferDraftSeeds = (request: string): DraftSeed[] => {
  const trimmed = request.trim();
  if (!trimmed) {
    return [
      {
        title: "request handling",
        kind: "action",
        dependsOn: [],
        checks: ["unit test를 먼저 작성한다."],
      },
    ];
  }

  if (/(생일).*(메시지|알림)|(메시지|알림).*(생일)/u.test(trimmed)) {
    return [
      {
        title: "birthday eligible members",
        kind: "calc",
        dependsOn: [],
        checks: ["회원 생일 판단 로직에 대한 unit test를 먼저 작성한다."],
      },
      {
        title: "birthday message delivery",
        kind: "action",
        dependsOn: ["birthday_eligible_members"],
        checks: ["메시지 발송 동작에 대한 unit test를 먼저 작성한다."],
      },
    ];
  }

  const splitParts = trimmed
    .split(/\s*(?:\+|그리고|및|and)\s*/iu)
    .map((value) => value.trim())
    .filter(Boolean);

  if (splitParts.length > 1) {
    return splitParts.map((part, index) => ({
      title: part,
      kind: /(send|save|delete|create|update|전송|저장|삭제|생성|추가|수정)/iu.test(part) ? "action" : "calc",
      dependsOn: index === 0 ? [] : [toSnakeCaseSummary(splitParts[index - 1] ?? "draft")],
      checks: ["관련 unit test를 먼저 작성한다."],
    }));
  }

  return [
    {
      title: trimmed,
      kind: /(send|save|delete|create|update|전송|저장|삭제|생성|추가|수정|react|project)/iu.test(trimmed)
        ? "action"
        : "calc",
      dependsOn: [],
      checks: ["관련 unit test를 먼저 작성한다."],
    },
  ];
};

const renderDraftContent = (seed: DraftSeed): string =>
  renderTasksDocument({
    name: seed.title,
    calc: seed.kind === "calc" ? [{ name: buildTaskDraft(seed.title), status: defaultStatusText }] : [],
    action: seed.kind === "action" ? [{ name: buildTaskDraft(seed.title), status: defaultStatusText }] : [],
    check: [...seed.checks, "세션 내부에서 unit test를 실행해 통과시킨다."],
  });

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
      "analyze 단계에서 요청을 구현 단위 draft로 분해했는지 확인한다.",
      ...buildLegacyRemovalChecklist(context.request),
    ];

    return renderJobDocument({
      requestName: context.request,
      requirements: [
        {
          kind,
          name: context.request,
          steps: [
            "요청을 구현 가능한 draft 단위로 분해한다.",
            "의존성에 따라 순차 또는 병렬 build 세션을 실행한다.",
            "check 세션이 job.md만 보고 최종 동작을 검증한다.",
          ],
        },
      ],
      logicChecklist,
      uiChecklist: ["모바일 모드 화면 깨짐 여부를 검사한다.", "UI 요청이면 Playwright로 실제 동작을 확인한다."],
      problems: [],
    });
  },
  renderDraftDocuments: (context): readonly ManagerDraftArtifact[] =>
    inferDraftSeeds(context.request).map((seed) => {
      const draftId = toSnakeCaseSummary(seed.title);
      return {
        draftId,
        title: seed.title,
        summary: draftId,
        path: "",
        kind: seed.kind,
        dependsOn: seed.dependsOn,
        content: renderDraftContent(seed),
      };
    }),
  readJobDocument: (jobFilePath) => `job.md reader: ${jobFilePath}`,
  runBuildStage: (logger) => {
    logger("build");
    logger("build:implement");
    return ["implement"];
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
