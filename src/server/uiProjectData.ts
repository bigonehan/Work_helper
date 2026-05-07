import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createProjectMetadataDocument, parseDraftDocument, parseProjectMetadataDocument } from "./project";
import type { ProjectType } from "../types";

export type ProjectRegistryState = "init" | "wait" | "work" | "check" | "complete";

export const PROJECT_TYPES = ["code", "mono"] as const satisfies readonly ProjectType[];
export const PROJECT_REGISTRY_STATES = ["init", "wait", "work", "check", "complete"] as const satisfies readonly ProjectRegistryState[];

export interface ProjectRegistryItem {
  readonly id: string;
  readonly type: ProjectType;
  readonly state: ProjectRegistryState;
  readonly name: string;
  readonly path: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ProjectRegistryDocument {
  readonly projects: readonly ProjectRegistryItem[];
}

export interface ProjectMutationInput {
  readonly name: string;
  readonly type?: ProjectType;
  readonly state?: ProjectRegistryState;
  readonly path?: string;
}

export interface UiProjectSummary {
  readonly id: string;
  readonly name: string;
  readonly type: ProjectType;
  readonly description: string;
  readonly spec: string;
  readonly path: string;
  readonly state: ProjectRegistryState;
  readonly draftCount: number;
  readonly hasJob: boolean;
  readonly updatedLabel: string;
}

export interface UiDraftSummary {
  readonly summary: string;
  readonly path: string;
  readonly itemCount: number;
  readonly automatedChecks: readonly string[];
  readonly assertions: readonly string[];
}

export interface UiProjectDetail {
  readonly project: UiProjectSummary;
  readonly projectDocument: string;
  readonly jobDocument: string | null;
  readonly drafts: readonly UiDraftSummary[];
}

const projectMetadataPath = (workspaceDir: string) => join(workspaceDir, ".project", "project.md");
const projectJobPath = (workspaceDir: string) => join(workspaceDir, ".project", "job.md");
const projectDraftsPath = (workspaceDir: string) => join(workspaceDir, ".project", "drafts");
const registryPath = (rootDir: string) => join(rootDir, ".project", "project-list.json");

const readOptionalFile = async (path: string): Promise<string | null> => {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
};

const toProjectId = (name: string): string =>
  name.toLowerCase().replace(/[^a-z0-9가-힣]+/giu, "-").replace(/^-+|-+$/g, "") || "project";

const nowIso = () => new Date().toISOString();

const isProjectType = (value: string): value is ProjectType => PROJECT_TYPES.includes(value as ProjectType);

const isProjectState = (value: string): value is ProjectRegistryState =>
  PROJECT_REGISTRY_STATES.includes(value as ProjectRegistryState);

const normalizeProjectInput = (input: ProjectMutationInput): Required<ProjectMutationInput> => {
  const name = input.name.trim();
  if (!name) {
    throw new Error("Project name is required.");
  }

  const type = input.type ?? "code";
  const state = input.state ?? "init";
  if (!isProjectType(type)) {
    throw new Error(`Invalid project type: ${type}`);
  }
  if (!isProjectState(state)) {
    throw new Error(`Invalid project state: ${state}`);
  }

  return {
    name,
    type,
    state,
    path: input.path?.trim() || join(process.cwd(), ".project", "workspaces", toProjectId(name)),
  };
};

const readRegistry = async (rootDir: string): Promise<ProjectRegistryDocument> => {
  const document = await readOptionalFile(registryPath(rootDir));
  if (!document) {
    return { projects: [] };
  }

  const parsed = JSON.parse(document) as Partial<ProjectRegistryDocument>;
  return {
    projects: Array.isArray(parsed.projects) ? parsed.projects.filter(isRegistryItem) : [],
  };
};

const writeRegistry = async (rootDir: string, registry: ProjectRegistryDocument): Promise<void> => {
  await mkdir(join(rootDir, ".project"), { recursive: true });
  await writeFile(registryPath(rootDir), `${JSON.stringify(registry, null, 2)}\n`, "utf8");
};

const isRegistryItem = (value: unknown): value is ProjectRegistryItem => {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const item = value as Record<string, unknown>;
  return (
    typeof item.id === "string" &&
    typeof item.name === "string" &&
    typeof item.path === "string" &&
    typeof item.createdAt === "string" &&
    typeof item.updatedAt === "string" &&
    typeof item.type === "string" &&
    isProjectType(item.type) &&
    typeof item.state === "string" &&
    isProjectState(item.state)
  );
};

const buildUniqueProjectId = (name: string, usedIds: Set<string>): string => {
  const base = toProjectId(name);
  if (!usedIds.has(base)) {
    return base;
  }

  for (let index = 1; index < 100; index += 1) {
    const candidate = `${base}-${String(index).padStart(2, "0")}`;
    if (!usedIds.has(candidate)) {
      return candidate;
    }
  }

  throw new Error(`Could not create unique project id for ${name}.`);
};

const ensureProjectMetadata = async (item: ProjectRegistryItem): Promise<void> => {
  await mkdir(join(item.path, ".project"), { recursive: true });
  const projectPath = projectMetadataPath(item.path);
  const existing = await readOptionalFile(projectPath);
  if (existing) {
    return;
  }

  await writeFile(
    projectPath,
    createProjectMetadataDocument({
      name: item.name,
      type: item.type,
      description: `${item.name} project`,
      spec: "typescript",
      path: item.path,
      state: item.state,
    }),
    "utf8",
  );
};

const syncProjectMetadata = async (item: ProjectRegistryItem): Promise<void> => {
  await mkdir(join(item.path, ".project"), { recursive: true });
  const existing = await readOptionalFile(projectMetadataPath(item.path));
  const description = existing ? parseProjectMetadataDocument(existing).description : `${item.name} project`;
  await writeFile(
    projectMetadataPath(item.path),
    createProjectMetadataDocument({
      name: item.name,
      type: item.type,
      description,
      spec: "typescript",
      path: item.path,
      state: item.state,
    }),
    "utf8",
  );
};

const readDraftSummaries = async (workspaceDir: string): Promise<UiDraftSummary[]> => {
  let entries: string[] = [];
  try {
    entries = await readdir(projectDraftsPath(workspaceDir));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const drafts = await Promise.all(
    entries.map(async (entry) => {
      const draftPath = join(projectDraftsPath(workspaceDir), entry, `${entry}.md`);
      const document = await readOptionalFile(draftPath);
      if (!document) {
        return null;
      }

      const parsed = parseDraftDocument(document);
      return {
        summary: parsed.summary || entry,
        path: draftPath,
        itemCount: parsed.draftItems.length,
        automatedChecks: parsed.checks.automated,
        assertions: parsed.checks.assertions,
      } satisfies UiDraftSummary;
    }),
  );

  return drafts.filter((draft): draft is UiDraftSummary => draft !== null);
};

const loadProjectSummaryFromRegistryItem = async (item: ProjectRegistryItem): Promise<UiProjectSummary> => {
  const projectDocument = await readOptionalFile(projectMetadataPath(item.path));
  if (!projectDocument) {
    return {
      id: item.id,
      name: item.name,
      type: item.type,
      description: `${item.name} project`,
      spec: "typescript",
      path: item.path,
      state: item.state,
      draftCount: 0,
      hasJob: false,
      updatedLabel: "No project.md yet",
    };
  }

  const metadata = parseProjectMetadataDocument(projectDocument);
  const drafts = await readDraftSummaries(item.path);
  const jobDocument = await readOptionalFile(projectJobPath(item.path));

  return {
    id: item.id,
    name: metadata.name || item.name,
    type: item.type,
    description: metadata.description,
    spec: metadata.spec,
    path: item.path,
    state: item.state,
    draftCount: drafts.length,
    hasJob: jobDocument !== null,
    updatedLabel: drafts.length > 0 ? `${drafts.length} draft bundle` : "No drafts yet",
  };
};

export const listProjectRegistry = async (rootDir: string = process.cwd()): Promise<ProjectRegistryItem[]> =>
  [...(await readRegistry(rootDir)).projects];

export const createProject = async (
  input: ProjectMutationInput,
  rootDir: string = process.cwd(),
): Promise<ProjectRegistryItem> => {
  const normalized = normalizeProjectInput(input);
  const registry = await readRegistry(rootDir);
  const id = buildUniqueProjectId(normalized.name, new Set(registry.projects.map((project) => project.id)));
  const timestamp = nowIso();
  const item: ProjectRegistryItem = {
    id,
    ...normalized,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  await ensureProjectMetadata(item);
  await writeRegistry(rootDir, { projects: [...registry.projects, item] });
  return item;
};

export const updateProject = async (
  projectId: string,
  input: Partial<ProjectMutationInput>,
  rootDir: string = process.cwd(),
): Promise<ProjectRegistryItem | null> => {
  const registry = await readRegistry(rootDir);
  const current = registry.projects.find((project) => project.id === projectId);
  if (!current) {
    return null;
  }

  const next: ProjectRegistryItem = {
    ...current,
    name: input.name?.trim() || current.name,
    type: input.type && isProjectType(input.type) ? input.type : current.type,
    state: input.state && isProjectState(input.state) ? input.state : current.state,
    path: input.path?.trim() || current.path,
    updatedAt: nowIso(),
  };

  await syncProjectMetadata(next);
  await writeRegistry(rootDir, {
    projects: registry.projects.map((project) => (project.id === projectId ? next : project)),
  });
  return next;
};

export const deleteProject = async (projectId: string, rootDir: string = process.cwd()): Promise<boolean> => {
  const registry = await readRegistry(rootDir);
  const nextProjects = registry.projects.filter((project) => project.id !== projectId);
  if (nextProjects.length === registry.projects.length) {
    return false;
  }

  await writeRegistry(rootDir, { projects: nextProjects });
  return true;
};

export const listProjects = async (rootDir: string = process.cwd()): Promise<UiProjectSummary[]> => {
  const registry = await readRegistry(rootDir);
  if (registry.projects.length > 0) {
    return Promise.all(registry.projects.map(loadProjectSummaryFromRegistryItem));
  }

  const projectDocument = await readOptionalFile(projectMetadataPath(rootDir));
  if (!projectDocument) {
    return [];
  }

  const metadata = parseProjectMetadataDocument(projectDocument);
  const drafts = await readDraftSummaries(rootDir);
  const jobDocument = await readOptionalFile(projectJobPath(rootDir));

  return [
    {
      id: toProjectId(metadata.name),
      name: metadata.name,
      type: metadata.type,
      description: metadata.description,
      spec: metadata.spec,
      path: metadata.path || rootDir,
      state: isProjectState(metadata.state) ? metadata.state : "init",
      draftCount: drafts.length,
      hasJob: jobDocument !== null,
      updatedLabel: drafts.length > 0 ? `${drafts.length} draft bundle` : "No drafts yet",
    },
  ];
};

export const getProjectDetail = async (
  projectId: string,
  rootDir: string = process.cwd(),
): Promise<UiProjectDetail | null> => {
  const registry = await readRegistry(rootDir);
  const registryItem = registry.projects.find((item) => item.id === projectId);
  const detailRoot = registryItem?.path ?? rootDir;
  const projects = await listProjects(rootDir);
  const project = projects.find((item) => item.id === projectId);
  if (!project) {
    return null;
  }

  const projectDocument = await readOptionalFile(projectMetadataPath(detailRoot));
  if (!projectDocument) {
    return null;
  }

  return {
    project,
    projectDocument,
    jobDocument: await readOptionalFile(projectJobPath(detailRoot)),
    drafts: await readDraftSummaries(detailRoot),
  };
};
