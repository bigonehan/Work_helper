import { Effect } from "effect";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { waitForProjectJob, submitProjectJobToTmux, destroyProjectTmuxSession } from "./projectManager";
import { ProjectTag, createProjectLayerForType } from "./server/artifacts";
import { buildProjectMetadataPath, parseProjectMetadataDocument } from "./server/project";
import type { ManagerVerificationResult, ProjectJobSnapshot, ProjectSpec, ProjectType, Provider } from "./types";

export interface BootstrapMetadata {
  readonly type: ProjectType;
  readonly spec: ProjectSpec;
  readonly path: string;
}

export const readProjectBootstrapMetadata = async (workspaceDir: string): Promise<BootstrapMetadata> => {
  const projectFilePath = buildProjectMetadataPath(workspaceDir);
  const document = await Effect.runPromise(
    Effect.gen(function* () {
      const project = yield* ProjectTag;
      return yield* Effect.promise(() => Promise.resolve(project.readProjectDocument(projectFilePath)));
    }).pipe(Effect.provide(createProjectLayerForType("code"))),
  );
  const metadata = parseProjectMetadataDocument(document);

  return {
    type: metadata.type,
    spec: metadata.spec,
    path: metadata.path,
  };
};

export const buildBootstrapPrompt = async (input: {
  readonly workspaceDir: string;
  readonly projectType: ProjectType;
  readonly projectSpec: ProjectSpec;
}): Promise<string> => {
  return Effect.runPromise(
    Effect.gen(function* () {
      const project = yield* ProjectTag;
      return yield* Effect.promise(() => Promise.resolve(project.buildBootstrapPrompt(input)));
    }).pipe(Effect.provide(createProjectLayerForType(input.projectType))),
  );
};

export const createBootstrapVerifier =
  (projectSpec: ProjectSpec) =>
  async (workspaceDir: string): Promise<ManagerVerificationResult> => {
    const requiredPaths =
      projectSpec === "rust"
        ? [join(workspaceDir, "Cargo.toml"), join(workspaceDir, "src", "main.rs")]
        : projectSpec === "python"
          ? [join(workspaceDir, "main.py")]
          : [join(workspaceDir, "package.json"), join(workspaceDir, "main.ts")];

    const missing: string[] = [];
    for (const requiredPath of requiredPaths) {
      try {
        await stat(requiredPath);
      } catch {
        missing.push(requiredPath);
      }
    }

    if (missing.length > 0) {
      return {
        ok: false,
        summary: `${projectSpec} bootstrap verification failed. Missing: ${missing.join(", ")}`,
      };
    }

    return {
      ok: true,
      summary: `${projectSpec} bootstrap verification passed in ${workspaceDir}.`,
    };
  };

export const bootstrapProject = async (input: {
  readonly projectId: string;
  readonly workspaceDir: string;
  readonly provider: Provider;
  readonly debugLogging?: boolean;
  readonly totalTimeoutMs?: number;
  readonly firstOutputTimeoutMs?: number;
  readonly responseTimeoutMs?: number;
}): Promise<ProjectJobSnapshot> => {
  const metadata = await readProjectBootstrapMetadata(input.workspaceDir);
  const prompt = await buildBootstrapPrompt({
    workspaceDir: input.workspaceDir,
    projectType: metadata.type,
    projectSpec: metadata.spec,
  });
  const jobId = `bootstrap-${metadata.spec}`;

  await Effect.runPromise(
    submitProjectJobToTmux({
      projectId: input.projectId,
      jobId,
      provider: input.provider,
      prompt,
      workspaceDir: input.workspaceDir,
      debugLogging: input.debugLogging,
      totalTimeoutMs: input.totalTimeoutMs,
      firstOutputTimeoutMs: input.firstOutputTimeoutMs,
      responseTimeoutMs: input.responseTimeoutMs,
      answerValidator: (answer) => (answer.trim() === "COMPLETED" ? null : "Bootstrap must reply with exactly COMPLETED."),
    }),
  );

  try {
    return await Effect.runPromise(waitForProjectJob(input.projectId, jobId));
  } finally {
    await Effect.runPromise(destroyProjectTmuxSession(input.projectId));
  }
};
