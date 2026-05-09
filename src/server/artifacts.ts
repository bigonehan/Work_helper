import { Context, Effect, Layer } from "effect";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { classifyRequirementItemKind, renderJobDocument } from "./job";
import { buildLegacyRemovalChecklist, buildUniqueTaskName, createProjectMetadataDocument } from "./project";
import { loadPromptTemplate } from "../prompts";
import { inferDraftSeedsFromProvider } from "./draftInference";
import type { DraftSeedInput } from "./draftInference";
import type {
  BootstrapProjectService,
  MakeDraftService,
  MakeJobService,
  MakeProjectService,
  ManagerDraftArtifact,
  ProjectArtifactService,
  ProjectType,
  Provider,
  StageRuntimeService,
} from "../types";

const bootstrapPromptPath = join(process.cwd(), "assets", "basic", "prompts", "bootstrap.md");

export const MakeProjectTag = Context.GenericTag<MakeProjectService>("@work_helper/MakeProject");
export const MakeJobTag = Context.GenericTag<MakeJobService>("@work_helper/MakeJob");
export const MakeDraftTag = Context.GenericTag<MakeDraftService>("@work_helper/MakeDraft");
export const BootstrapProjectTag = Context.GenericTag<BootstrapProjectService>("@work_helper/BootstrapProject");
export const StageRuntimeTag = Context.GenericTag<StageRuntimeService>("@work_helper/StageRuntime");
export const ProjectTag = Context.GenericTag<ProjectArtifactService>("@work_helper/Project");

interface DraftSeed {
  readonly id: string;
  readonly title: string;
  readonly input: readonly string[];
  readonly output: readonly string[];
  readonly test: readonly string[];
  readonly priority: number;
  readonly kind: "calc" | "ui" | "i/o" | "action";
  readonly target: readonly string[];
  readonly dependsOn: readonly string[];
}

const createDraftYaml = (seed: DraftSeed): string =>
  [
    "# id: draft 고유값",
    `id: ${seed.id}`,
    "",
    "# summary: 파일명과 묶음 관리에 사용하는 짧은 요약명",
    `summary: ${seed.id}`,
    "",
    "# description: build 세션이 구현해야 하는 작업 설명",
    `description: ${seed.title}`,
    "",
    "# input: 입력되는 값들, 요구되는 값들",
    "input:",
    ...seed.input.map((item) => `  - ${item}`),
    "",
    "# output: 현재 기능이 내놓는 결과, 혹은 출력하는 값",
    "output:",
    ...seed.output.map((item) => `  - ${item}`),
    "",
    "# test: 구현 성공 여부를 체크하는 조건 체크리스트",
    "test:",
    ...seed.test.map((item) => `  - ${item}`),
    "",
    "# priority: manager가 우선순위를 판별하는 int 값, 작을수록 먼저 실행",
    `priority: ${seed.priority}`,
    "",
    "# kind: calc, ui, i/o, action 중 하나",
    `kind: ${seed.kind}`,
    "",
    "# target: 사용되는 파일, 생성되는 파일, 이용하는 도메인",
    "target:",
    ...seed.target.map((item) => `  - ${item}`),
    "",
    "# dependsOn: 다른 작업 의존성이 있을 때 참조하는 draft id 목록",
    ...(seed.dependsOn.length > 0 ? ["dependsOn:", ...seed.dependsOn.map((item) => `  - ${item}`)] : ["dependsOn: []"]),
  ].join("\n");

const fallbackDraftSeedInputs = (request: string): DraftSeedInput[] => {
  const trimmed = request.trim();
  if (!trimmed) {
    return [
      {
        title: "request handling",
        input: ["user request"],
        output: ["요청을 build 가능한 draft로 분해한다"],
        test: ["요청 분해 로직 unit test를 먼저 작성한다.", "draft가 최소 1개 생성되는지 검증한다."],
        priority: 1,
        kind: "action",
        target: ["job.md", "drafts"],
      },
    ];
  }

  const parts = trimmed
    .split(/\s*(?:\+|그리고|및|and)\s*/iu)
    .map((value) => value.trim())
    .filter(Boolean);

  if (parts.length > 1) {
    return parts.map((part, index) => ({
      title: part,
      input: index === 0 ? ["request"] : ["request", `${parts[index - 1]} 결과`],
      output: [`${part} 기능을 구현한다`],
      test: ["관련 unit test를 먼저 작성한다.", "요청 조건을 만족하는지 검증한다."],
      priority: index + 1,
      kind: "action" as const,
      target: ["src", "test"],
      dependsOn: index === 0 ? [] : [index - 1],
    }));
  }

  return [
    {
      title: trimmed,
      input: ["request"],
      output: [`${trimmed} 기능을 구현한다`],
      test: ["관련 unit test를 먼저 작성한다.", "요청 조건을 만족하는지 검증한다."],
      priority: 1,
      kind: "action" as const,
      target: ["src", "test"],
    },
  ];
};

const seedsToNamedSeeds = (seeds: DraftSeedInput[]): DraftSeed[] => {
  const usedNames = new Set<string>();
  const named = seeds.map((seed) => ({
    ...seed,
    id: buildUniqueTaskName(seed.title, usedNames),
  }));

  return named.map((seed) => ({
    ...seed,
    dependsOn: (seed.dependsOn ?? []).map((dependencyIndex) => named[dependencyIndex]?.id ?? "").filter(Boolean),
  }));
};

const inferDraftSeeds = async (
  request: string,
  provider: Provider,
  workspaceDir: string,
): Promise<DraftSeed[]> => {
  const providerSeeds = await inferDraftSeedsFromProvider(request, provider, workspaceDir);
  if (providerSeeds && providerSeeds.length > 0) {
    return seedsToNamedSeeds(providerSeeds);
  }

  return seedsToNamedSeeds(fallbackDraftSeedInputs(request));
};

const extractRequestNameFromJobDocument = (jobDocument: string): string => {
  const lines = jobDocument.split("\n");
  const requestHeadingIndex = lines.findIndex((line) => line.trim() === "# requirement");
  if (requestHeadingIndex === -1) {
    return jobDocument;
  }

  for (let index = requestHeadingIndex + 1; index < lines.length; index += 1) {
    const line = lines[index]?.trim() ?? "";
    if (line.startsWith("## ")) {
      return line.slice(3).trim();
    }
  }

  return jobDocument;
};

const createDefaultMakeProjectService = (projectType: ProjectType): MakeProjectService => ({
  projectType,
  makeProject: (context) =>
    createProjectMetadataDocument({
      name: context.projectId,
      type: context.projectType,
      description: context.request,
      spec: context.projectSpec,
      path: context.workspaceDir,
      state: "check",
    }),
  readProject: async (projectFilePath) => readFile(projectFilePath, "utf8"),
});

const createDefaultMakeJobService = (projectType: ProjectType): MakeJobService => ({
  projectType,
  makeJob: (context) => {
    const kind = classifyRequirementItemKind(context.request);
    const logicChecklist = [
      "테스트가 먼저 작성되었는지 확인한다.",
      "analyze 단계에서 job 문서를 읽고 기능 단위 draft를 생성했는지 확인한다.",
      "draft의 priority와 dependsOn이 build 순서에 반영되는지 확인한다.",
      ...buildLegacyRemovalChecklist(context.request),
    ];

    return renderJobDocument({
      requestName: context.request,
      requirements: [
        {
          kind,
          name: context.request,
          steps: [
            "job 문서를 읽고 .project/drafts/{summary}/ 아래의 draft bundle과 draft_item YAML 여러 개로 분해한다.",
            "build는 draft_item YAML의 priority와 dependsOn을 기준으로 실행 순서를 정한다.",
            "check 세션이 draft bundle markdown의 체크리스트를 보고 최종 동작을 검증한다.",
          ],
        },
      ],
      logicChecklist,
      uiChecklist: ["모바일 모드 화면 깨짐 여부를 검사한다.", "UI 요청이면 Playwright로 실제 동작을 확인한다."],
      problems: [],
    });
  },
  readJob: async (jobFilePath) => readFile(jobFilePath, "utf8"),
});

const createDefaultMakeDraftService = (projectType: ProjectType, provider: Provider): MakeDraftService => ({
  projectType,
  makeDraft: async (context): Promise<readonly ManagerDraftArtifact[]> => {
    const seeds = await inferDraftSeeds(
      extractRequestNameFromJobDocument(context.jobDocument || context.request),
      provider,
      context.workspaceDir,
    );
    return seeds.map((seed) => ({
      draftId: seed.id,
      title: seed.title,
      description: seed.title,
      summary: seed.id,
      path: "",
      input: seed.input,
      output: seed.output,
      test: [...seed.test, "세션 내부에서 unit test를 실행해 통과시킨다."],
      priority: seed.priority,
      kind: seed.kind,
      target: seed.target,
      dependsOn: seed.dependsOn,
      content: createDraftYaml({
        ...seed,
        test: [...seed.test, "세션 내부에서 unit test를 실행해 통과시킨다."],
      }),
    }));
  },
});

const createDefaultBootstrapProjectService = (projectType: ProjectType): BootstrapProjectService => ({
  projectType,
  bootstrapProject: async (context) => {
    const template = await loadPromptTemplate(bootstrapPromptPath);
    return template
      .replaceAll("{{project_type}}", context.projectType)
      .replaceAll("{{project_spec}}", context.projectSpec)
      .replaceAll("{{workspace_dir}}", context.workspaceDir);
  },
});

const createDefaultStageRuntimeService = (projectType: ProjectType): StageRuntimeService => ({
  projectType,
  runBuildStage: (logger) => {
    logger("build");
    logger("build:implement");
    return ["implement"];
  },
  runCheckStage: (logger) => {
    logger("check");
    return "check";
  },
});

const createProjectArtifactFacade = (
  projectType: ProjectType,
  makeProject: MakeProjectService,
  makeJob: MakeJobService,
  makeDraft: MakeDraftService,
  bootstrapProject: BootstrapProjectService,
  stageRuntime: StageRuntimeService,
): ProjectArtifactService => ({
  projectType,
  renderProjectDocument: (context) => makeProject.makeProject(context),
  readProjectDocument: (projectFilePath) => makeProject.readProject(projectFilePath),
  renderJobDocument: (context) => makeJob.makeJob(context),
  renderDraftDocuments: (context) => makeDraft.makeDraft(context),
  readJobDocument: (jobFilePath) => makeJob.readJob(jobFilePath),
  runBuildStage: (logger) => stageRuntime.runBuildStage(logger),
  runCheckStage: (logger) => stageRuntime.runCheckStage(logger),
  buildBootstrapPrompt: (context) => bootstrapProject.bootstrapProject(context),
});

export const createProjectServiceForType = (projectType: ProjectType, provider: Provider = "codex"): ProjectArtifactService => {
  const makeProject = createDefaultMakeProjectService(projectType);
  const makeJob = createDefaultMakeJobService(projectType);
  const makeDraft = createDefaultMakeDraftService(projectType, provider);
  const bootstrapProject = createDefaultBootstrapProjectService(projectType);
  const stageRuntime = createDefaultStageRuntimeService(projectType);
  return createProjectArtifactFacade(projectType, makeProject, makeJob, makeDraft, bootstrapProject, stageRuntime);
};

export const createProjectLayer = (service: ProjectArtifactService) =>
  Layer.mergeAll(
    Layer.succeed(MakeProjectTag, {
      projectType: service.projectType,
      makeProject: service.renderProjectDocument,
      readProject: service.readProjectDocument,
    } satisfies MakeProjectService),
    Layer.succeed(MakeJobTag, {
      projectType: service.projectType,
      makeJob: service.renderJobDocument,
      readJob: service.readJobDocument,
    } satisfies MakeJobService),
    Layer.succeed(MakeDraftTag, {
      projectType: service.projectType,
      makeDraft: service.renderDraftDocuments,
    } satisfies MakeDraftService),
    Layer.succeed(BootstrapProjectTag, {
      projectType: service.projectType,
      bootstrapProject: service.buildBootstrapPrompt,
    } satisfies BootstrapProjectService),
    Layer.succeed(StageRuntimeTag, {
      projectType: service.projectType,
      runBuildStage: service.runBuildStage,
      runCheckStage: service.runCheckStage,
    } satisfies StageRuntimeService),
    Layer.succeed(ProjectTag, service),
  );

export const createProjectLayerForType = (projectType: ProjectType, provider: Provider = "codex") =>
  createProjectLayer(createProjectServiceForType(projectType, provider));

export const readProjectJobDocumentEffect = (jobFilePath: string) =>
  Effect.gen(function* () {
    const makeJob = yield* MakeJobTag;
    return yield* Effect.promise(() => Promise.resolve(makeJob.readJob(jobFilePath)));
  });
