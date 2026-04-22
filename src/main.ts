import { Data, Effect, Layer, Schema } from "effect";
import { createProjectLayerForType, StageRuntimeTag } from "./server/artifacts";

export enum ProjectStage {
  Request = "request",
  Init = "init",
  Plan = "plan",
  Analyze = "analyze",
  Build = "build",
  Check = "check",
}

export enum ProjectTransition {
  RequestToInit = "request->init",
  RequestToImportProject = "request->import-project",
  RequestToPlan = "request->plan",
  RequestToCheck = "request->check",
  PlanToAnalyze = "plan->analyze",
  AnalyzeToBuild = "analyze->build",
  BuildToCheck = "build->check",
}

export enum BuildSubstage {
  Implement = "implement",
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

export const RequestStageInputSchema = Schema.Struct({
  request: Schema.String,
  hasProjectMetadata: Schema.Boolean,
  workspaceEmpty: Schema.Boolean,
  hasSourceFiles: Schema.Boolean,
});

export const RequestStageResultSchema = Schema.Struct({
  stage: Schema.Literal(ProjectStage.Request),
  transition: Schema.Literal(
    ProjectTransition.RequestToInit,
    ProjectTransition.RequestToImportProject,
    ProjectTransition.RequestToPlan,
    ProjectTransition.RequestToCheck,
  ),
});

export const InitStageContextSchema = Schema.Struct({
  transition: Schema.Literal(ProjectTransition.RequestToInit),
});

export const PlanStageContextSchema = Schema.Struct({
  transition: Schema.Literal(ProjectTransition.RequestToPlan),
});

export const AnalyzeStageContextSchema = Schema.Struct({
  transition: Schema.Literal(ProjectTransition.PlanToAnalyze),
});

export const BuildStageContextSchema = Schema.Struct({
  transition: Schema.Literal(ProjectTransition.AnalyzeToBuild),
});

export const CheckStageContextSchema = Schema.Struct({
  transition: Schema.Literal(ProjectTransition.BuildToCheck, ProjectTransition.RequestToCheck),
});

export const PipelineResultSchema = Schema.Struct({
  executedStages: Schema.Array(
    Schema.Literal(
      ProjectStage.Request,
      ProjectStage.Init,
      ProjectStage.Plan,
      ProjectStage.Analyze,
      ProjectStage.Build,
      ProjectStage.Check,
    ),
  ),
  transitions: Schema.Array(
    Schema.Literal(
      ProjectTransition.RequestToInit,
      ProjectTransition.RequestToImportProject,
      ProjectTransition.RequestToPlan,
      ProjectTransition.RequestToCheck,
      ProjectTransition.PlanToAnalyze,
      ProjectTransition.AnalyzeToBuild,
      ProjectTransition.BuildToCheck,
    ),
  ),
  buildSubstages: Schema.Array(Schema.Literal(BuildSubstage.Implement)),
});

export class RequestStageEntryError extends Data.TaggedError("RequestStageEntryError")<{
  readonly stage: ProjectStage.Request;
  readonly reason: string;
  readonly details: string;
}> {}

export class InitStageEntryError extends Data.TaggedError("InitStageEntryError")<{
  readonly stage: ProjectStage.Init;
  readonly reason: string;
  readonly details: string;
}> {}

export class PlanStageEntryError extends Data.TaggedError("PlanStageEntryError")<{
  readonly stage: ProjectStage.Plan;
  readonly reason: string;
  readonly details: string;
}> {}

export class AnalyzeStageEntryError extends Data.TaggedError("AnalyzeStageEntryError")<{
  readonly stage: ProjectStage.Analyze;
  readonly reason: string;
  readonly details: string;
}> {}

export class BuildStageEntryError extends Data.TaggedError("BuildStageEntryError")<{
  readonly stage: ProjectStage.Build;
  readonly reason: string;
  readonly details: string;
}> {}

export class CheckStageEntryError extends Data.TaggedError("CheckStageEntryError")<{
  readonly stage: ProjectStage.Check;
  readonly reason: string;
  readonly details: string;
}> {}

const decodeUnknown =
  <A, I>(schema: Schema.Schema<A, I>, onError: (error: unknown) => Error) =>
  (input: unknown) =>
    Effect.mapError(Schema.decodeUnknown(schema)(input), onError);

export const runInitStageEffect = (
  context: unknown = { transition: ProjectTransition.RequestToInit },
  logger: StageLogger = defaultLogger,
) =>
  Effect.gen(function* () {
    yield* decodeUnknown(
      InitStageContextSchema,
      (error) =>
        new InitStageEntryError({
          stage: ProjectStage.Init,
          reason: "Failed to enter init stage.",
          details: String(error),
        }),
    )(context);
    logger(ProjectStage.Init);
    return ProjectStage.Init;
  });

export const runPlanStageEffect = (
  context: unknown = { transition: ProjectTransition.RequestToPlan },
  logger: StageLogger = defaultLogger,
) =>
  Effect.gen(function* () {
    yield* decodeUnknown(
      PlanStageContextSchema,
      (error) =>
        new PlanStageEntryError({
          stage: ProjectStage.Plan,
          reason: "Failed to enter plan stage.",
          details: String(error),
        }),
    )(context);
    logger(ProjectStage.Plan);
    return ProjectStage.Plan;
  });

export const runAnalyzeStageEffect = (
  context: unknown = { transition: ProjectTransition.PlanToAnalyze },
  logger: StageLogger = defaultLogger,
) =>
  Effect.gen(function* () {
    yield* decodeUnknown(
      AnalyzeStageContextSchema,
      (error) =>
        new AnalyzeStageEntryError({
          stage: ProjectStage.Analyze,
          reason: "Failed to enter analyze stage.",
          details: String(error),
        }),
    )(context);
    logger(ProjectStage.Analyze);
    return ProjectStage.Analyze;
  });

export const runBuildStageEffect = (
  logger: StageLogger = defaultLogger,
  context: unknown = { transition: ProjectTransition.AnalyzeToBuild },
) =>
  Effect.gen(function* () {
    yield* decodeUnknown(
      BuildStageContextSchema,
      (error) =>
        new BuildStageEntryError({
          stage: ProjectStage.Build,
          reason: "Failed to enter build stage.",
          details: String(error),
        }),
    )(context);
    const runtime = yield* StageRuntimeTag;
    return runtime.runBuildStage(logger);
  });

export const runCheckStageEffect = (
  logger: StageLogger = defaultLogger,
  context: unknown = { transition: ProjectTransition.BuildToCheck },
) =>
  Effect.gen(function* () {
    yield* decodeUnknown(
      CheckStageContextSchema,
      (error) =>
        new CheckStageEntryError({
          stage: ProjectStage.Check,
          reason: "Failed to enter check stage.",
          details: String(error),
        }),
    )(context);
    const runtime = yield* StageRuntimeTag;
    return runtime.runCheckStage(logger);
  });

export const runRequestStageEffect = (
  input: unknown,
  logger: StageLogger = defaultLogger,
) =>
  Effect.gen(function* () {
    const decodedInput = yield* decodeUnknown(
      RequestStageInputSchema,
      (error) =>
        new RequestStageEntryError({
          stage: ProjectStage.Request,
          reason: "Failed to enter request stage.",
          details: String(error),
        }),
    )(input);

    logger(ProjectStage.Request);

    const transition = resolveRequestTransition(decodedInput);
    logger(transition);

    return yield* decodeUnknown(
      RequestStageResultSchema,
      (error) =>
        new RequestStageEntryError({
          stage: ProjectStage.Request,
          reason: "Failed to build request stage result.",
          details: String(error),
        }),
    )({
      stage: ProjectStage.Request,
      transition,
    });
  });

export const runProjectPipelineEffect = (
  input: unknown,
  logger: StageLogger = defaultLogger,
) =>
  Effect.gen(function* () {
    const requestResult = yield* runRequestStageEffect(input, logger);
    const executedStages: ProjectStage[] = [ProjectStage.Request];
    const transitions: ProjectTransition[] = [requestResult.transition];
    const buildSubstages: BuildSubstage[] = [];

    if (requestResult.transition === ProjectTransition.RequestToInit) {
      executedStages.push(yield* runInitStageEffect({ transition: ProjectTransition.RequestToInit }, logger));
      return yield* decodeUnknown(
        PipelineResultSchema,
        (error) =>
          new InitStageEntryError({
            stage: ProjectStage.Init,
            reason: "Failed to build init pipeline result.",
            details: String(error),
          }),
      )({
        executedStages,
        transitions,
        buildSubstages,
      });
    }

    if (requestResult.transition === ProjectTransition.RequestToCheck) {
      executedStages.push(
        (yield* runCheckStageEffect(logger, { transition: ProjectTransition.RequestToCheck })) as ProjectStage,
      );
      return yield* decodeUnknown(
        PipelineResultSchema,
        (error) =>
          new CheckStageEntryError({
            stage: ProjectStage.Check,
            reason: "Failed to build check pipeline result.",
            details: String(error),
          }),
      )({
        executedStages,
        transitions,
        buildSubstages,
      });
    }

    if (requestResult.transition === ProjectTransition.RequestToImportProject) {
      return yield* decodeUnknown(
        PipelineResultSchema,
        (error) =>
          new RequestStageEntryError({
            stage: ProjectStage.Request,
            reason: "Failed to build import-project pipeline result.",
            details: String(error),
          }),
      )({
        executedStages,
        transitions,
        buildSubstages,
      });
    }

    executedStages.push(yield* runPlanStageEffect({ transition: ProjectTransition.RequestToPlan }, logger));
    logger(ProjectTransition.PlanToAnalyze);
    transitions.push(ProjectTransition.PlanToAnalyze);

    executedStages.push(yield* runAnalyzeStageEffect({ transition: ProjectTransition.PlanToAnalyze }, logger));
    logger(ProjectTransition.AnalyzeToBuild);
    transitions.push(ProjectTransition.AnalyzeToBuild);

    executedStages.push(ProjectStage.Build);
    buildSubstages.push(
      ...((yield* runBuildStageEffect(logger, { transition: ProjectTransition.AnalyzeToBuild })) as BuildSubstage[]),
    );

    logger(ProjectTransition.BuildToCheck);
    transitions.push(ProjectTransition.BuildToCheck);
    executedStages.push(
      (yield* runCheckStageEffect(logger, { transition: ProjectTransition.BuildToCheck })) as ProjectStage,
    );

    return yield* decodeUnknown(
      PipelineResultSchema,
      (error) =>
        new CheckStageEntryError({
          stage: ProjectStage.Check,
          reason: "Failed to build pipeline result.",
          details: String(error),
        }),
    )({
      executedStages,
      transitions,
      buildSubstages,
    });
  });

export const runInitStage = (logger: StageLogger = defaultLogger): ProjectStage =>
  Effect.runSync(runInitStageEffect({ transition: ProjectTransition.RequestToInit }, logger));

export const runPlanStage = (logger: StageLogger = defaultLogger): ProjectStage =>
  Effect.runSync(runPlanStageEffect({ transition: ProjectTransition.RequestToPlan }, logger));

export const runAnalyzeStage = (logger: StageLogger = defaultLogger): ProjectStage =>
  Effect.runSync(runAnalyzeStageEffect({ transition: ProjectTransition.PlanToAnalyze }, logger));

export const runCheckStage = (logger: StageLogger = defaultLogger): ProjectStage =>
  Effect.runSync(
    runCheckStageEffect(logger, { transition: ProjectTransition.BuildToCheck }).pipe(
      Effect.provide(createProjectLayerForType("code")),
    ),
  ) as ProjectStage;

export const runRequestStage = (
  input: RequestStageInput,
  logger: StageLogger = defaultLogger,
): RequestStageResult => Effect.runSync(runRequestStageEffect(input, logger));

export const runBuildStage = (logger: StageLogger = defaultLogger): BuildSubstage[] =>
  Effect.runSync(
    runBuildStageEffect(logger, { transition: ProjectTransition.AnalyzeToBuild }).pipe(
      Effect.provide(createProjectLayerForType("code")),
    ),
  ).map((substage) => substage as BuildSubstage);

export const runProjectPipeline = (
  input: RequestStageInput,
  logger: StageLogger = defaultLogger,
): PipelineResult =>
  Effect.runSync(runProjectPipelineEffect(input, logger).pipe(Effect.provide(createProjectLayerForType("code"))));

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
