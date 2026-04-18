import { Effect } from "effect";
import { ProjectTag, createProjectLayerForType } from "./server/artifacts";

export enum ProjectStage {
  Request = "request",
  Init = "init",
  Decompile = "decompile",
  Build = "build",
  Check = "check",
}

export enum ProjectTransition {
  RequestToInit = "request->init",
  RequestToImportProject = "request->import-project",
  RequestToPlan = "request->plan",
  RequestToCheck = "request->check",
  PlanToDecompile = "plan->disassemble",
  DecompileToBuildDraft = "disassemble->build:draft",
  BuildDraftToClassify = "build:draft->build:classify",
  BuildClassifyToTest = "build:classify->build:test",
  BuildTestToImplement = "build:test->build:implement",
  BuildImplementToVerify = "build:implement->build:verify",
  BuildVerifyToCheck = "build:verify->check",
}

export enum BuildSubstage {
  Draft = "draft",
  Classify = "classify",
  Test = "test",
  Implement = "implement",
  Verify = "verify",
}

export interface RequestStageInput {
  readonly request: string;
  readonly hasProjectMetadata: boolean;
  readonly workspaceEmpty: boolean;
  readonly hasSourceFiles: boolean;
}

export interface RequestStageResult {
  readonly stage: ProjectStage.Request;
  readonly transition:
    | ProjectTransition.RequestToInit
    | ProjectTransition.RequestToImportProject
    | ProjectTransition.RequestToPlan
    | ProjectTransition.RequestToCheck;
}

export interface PipelineResult {
  readonly executedStages: readonly ProjectStage[];
  readonly transitions: readonly ProjectTransition[];
  readonly buildSubstages: readonly BuildSubstage[];
}

type StageLogger = (message: string) => void;

const defaultLogger: StageLogger = (message) => {
  console.log(message);
};

const explicitFixPattern = /(개선|수정|버그\s*수정|버그)/u;

export const runInitStage = (logger: StageLogger = defaultLogger): ProjectStage => {
  logger(ProjectStage.Init);
  return ProjectStage.Init;
};

export const runDecompileStage = (logger: StageLogger = defaultLogger): ProjectStage => {
  logger(ProjectStage.Decompile);
  return ProjectStage.Decompile;
};

export const runCheckStage = (logger: StageLogger = defaultLogger): ProjectStage => {
  return Effect.runSync(runCheckStageEffect(logger).pipe(Effect.provide(createProjectLayerForType("code")))) as ProjectStage;
};

export const runRequestStage = (
  input: RequestStageInput,
  logger: StageLogger = defaultLogger,
): RequestStageResult => {
  logger(ProjectStage.Request);

  const transition = resolveRequestTransition(input);
  logger(transition);

  return {
    stage: ProjectStage.Request,
    transition,
  };
};

export const runBuildStage = (logger: StageLogger = defaultLogger): BuildSubstage[] => {
  return Effect.runSync(runBuildStageEffect(logger).pipe(Effect.provide(createProjectLayerForType("code")))).map(
    (substage) => substage as BuildSubstage,
  );
};

export const runBuildStageEffect = (logger: StageLogger = defaultLogger) =>
  Effect.gen(function* () {
    const project = yield* ProjectTag;
    return project.runBuildStage(logger);
  });

export const runCheckStageEffect = (logger: StageLogger = defaultLogger) =>
  Effect.gen(function* () {
    const project = yield* ProjectTag;
    return project.runCheckStage(logger);
  });

export const runProjectPipeline = (
  input: RequestStageInput,
  logger: StageLogger = defaultLogger,
): PipelineResult => {
  const requestResult = runRequestStage(input, logger);
  const executedStages: ProjectStage[] = [ProjectStage.Request];
  const transitions: ProjectTransition[] = [requestResult.transition];
  const buildSubstages: BuildSubstage[] = [];

  if (requestResult.transition === ProjectTransition.RequestToInit) {
    executedStages.push(runInitStage(logger));
    return {
      executedStages,
      transitions,
      buildSubstages,
    };
  }

  if (requestResult.transition === ProjectTransition.RequestToCheck) {
    executedStages.push(runCheckStage(logger));
    return {
      executedStages,
      transitions,
      buildSubstages,
    };
  }

  if (requestResult.transition === ProjectTransition.RequestToImportProject) {
    return {
      executedStages,
      transitions,
      buildSubstages,
    };
  }

  logger(ProjectTransition.PlanToDecompile);
  transitions.push(ProjectTransition.PlanToDecompile);

  executedStages.push(runDecompileStage(logger));
  logger(ProjectTransition.DecompileToBuildDraft);
  transitions.push(ProjectTransition.DecompileToBuildDraft);

  executedStages.push(ProjectStage.Build);
  buildSubstages.push(...runBuildStage(logger));
  transitions.push(
    ProjectTransition.BuildDraftToClassify,
    ProjectTransition.BuildClassifyToTest,
    ProjectTransition.BuildTestToImplement,
    ProjectTransition.BuildImplementToVerify,
  );

  logger(ProjectTransition.BuildVerifyToCheck);
  transitions.push(ProjectTransition.BuildVerifyToCheck);
  executedStages.push(runCheckStage(logger));

  return {
    executedStages,
    transitions,
    buildSubstages,
  };
};

function resolveRequestTransition(input: RequestStageInput): RequestStageResult["transition"] {
  if (explicitFixPattern.test(input.request) && (input.hasProjectMetadata || input.hasSourceFiles)) {
    return ProjectTransition.RequestToCheck;
  }

  if (!input.hasProjectMetadata && input.workspaceEmpty) {
    return ProjectTransition.RequestToInit;
  }

  if (!input.hasProjectMetadata && input.hasSourceFiles) {
    return ProjectTransition.RequestToImportProject;
  }

  return ProjectTransition.RequestToPlan;
}
