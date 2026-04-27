import { mkdir, readdir, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { buildProjectMetadataPath } from "./server/project";

export interface ExecutionPathInput {
  readonly projectId: string;
  readonly workspaceDir?: string;
  readonly targetDir?: string;
}

export interface ExecutionPaths {
  readonly targetDir: string;
  readonly artifactRoot: string;
  readonly workspaceDir: string;
}

export interface WorkspaceState {
  readonly hasProjectMetadata: boolean;
  readonly workspaceEmpty: boolean;
  readonly hasSourceFiles: boolean;
}

export class PermissionPreflightError extends Error {
  readonly code: "artifact_root_not_writable" | "target_dir_not_writable";
  readonly path: string;
  readonly stage: "init" | "plan" | "analyze" | "build" | "check" | "bootstrap";

  constructor(
    code: PermissionPreflightError["code"],
    stage: PermissionPreflightError["stage"],
    path: string,
    reason: string,
  ) {
    super(`${code}: ${reason} (${path})`);
    this.name = "PermissionPreflightError";
    this.code = code;
    this.path = path;
    this.stage = stage;
  }
}

export const resolveExecutionPaths = (input: ExecutionPathInput): ExecutionPaths => {
  const targetDir = input.targetDir ?? input.workspaceDir;
  if (!targetDir) {
    throw new Error("A targetDir or legacy workspaceDir is required.");
  }

  return {
    targetDir,
    artifactRoot: process.cwd(),
    workspaceDir: targetDir,
  };
};

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function ensureDirectoryExists(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

async function ensureDirectoryWritable(path: string): Promise<void> {
  await ensureDirectoryExists(path);
  const probePath = join(path, `.work-helper-write-test-${process.pid}-${Date.now().toString(36)}`);
  await writeFile(probePath, "ok\n", "utf8");
  await unlink(probePath);
}

async function ensureParentWritable(path: string): Promise<void> {
  const existingPath = (await pathExists(path)) ? path : dirname(path);
  await ensureDirectoryWritable(existingPath);
}

export const ensureArtifactRootWritable = async (
  artifactRoot: string,
  stage: PermissionPreflightError["stage"],
): Promise<void> => {
  try {
    await ensureDirectoryWritable(join(artifactRoot, ".project"));
  } catch (error) {
    throw new PermissionPreflightError(
      "artifact_root_not_writable",
      stage,
      join(artifactRoot, ".project"),
      error instanceof Error ? error.message : String(error),
    );
  }
};

export const ensureTargetDirWritable = async (
  targetDir: string,
  stage: PermissionPreflightError["stage"] = "build",
): Promise<void> => {
  try {
    if (await pathExists(targetDir)) {
      await ensureDirectoryWritable(targetDir);
      return;
    }

    await ensureParentWritable(targetDir);
    await ensureDirectoryExists(targetDir);
  } catch (error) {
    throw new PermissionPreflightError(
      "target_dir_not_writable",
      stage,
      targetDir,
      error instanceof Error ? error.message : String(error),
    );
  }
};

export const detectWorkspaceState = async (targetDir: string, artifactRoot: string): Promise<WorkspaceState> => {
  const projectMetadataPath = buildProjectMetadataPath(artifactRoot);
  const hasProjectMetadata = await pathExists(projectMetadataPath);
  const entries = (await readdir(targetDir, { withFileTypes: true }).catch(() => []))
    .filter((entry) => ![".git", "node_modules"].includes(entry.name));
  const workspaceEmpty = entries.length === 0;
  const hasSourceFiles = entries.some((entry) => {
    if (entry.isDirectory()) {
      return ["src", "test", "app", ".project"].includes(entry.name);
    }

    return /\.(ts|tsx|js|jsx|py|rs|md|json|yaml|yml)$/iu.test(entry.name);
  });

  return {
    hasProjectMetadata,
    workspaceEmpty,
    hasSourceFiles,
  };
};
