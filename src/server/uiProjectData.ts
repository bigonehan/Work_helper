import { lstat, mkdir, readdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { extname, isAbsolute, join, parse, relative, resolve } from "node:path";
import ts from "typescript";
import {
  createProjectMetadataDocument,
  getAppSettings,
  getProjectLinkRoots,
  parseDraftDocument,
  parseProjectMetadataDocument,
} from "./project";
import {
  PROJECT_REGISTRY_STATES,
  PROJECT_TYPES,
  type ProjectMutationInput,
  type ProjectRegistryDocument,
  type ProjectRegistryItem,
  type ProjectRegistryState,
  type ProjectType,
  type UiDomainFileSummary,
  type UiDraftSummary,
  type UiProjectDetail,
  type UiProjectSummary,
  type UiSourceFolderSummary,
  type UiSourceSymbolSummary,
} from "../types";

const projectMetadataPath = (workspaceDir: string) => join(workspaceDir, ".project", "project.md");
const projectJobPath = (workspaceDir: string) => join(workspaceDir, ".project", "job.md");
const projectDraftsPath = (workspaceDir: string) => join(workspaceDir, ".project", "drafts");
const registryPath = (rootDir: string) => join(rootDir, ".project", "project-list.json");
const configPath = (rootDir: string) => join(rootDir, "configs", "config.yaml");
const linkRootsConfigPath = (rootDir: string) => join(rootDir, "configs", "project-link-roots.yaml");
const sourceFileExtensions = new Set([".cts", ".js", ".jsx", ".mts", ".ts", ".tsx"]);

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

const pathExists = async (path: string): Promise<boolean> => {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false;
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

const buildDefaultProjectPath = async (name: string, rootDir: string): Promise<string> => {
  const settings = await getAppSettings(configPath(rootDir));
  const basePath = settings.defaultProjectPath.trim() || ".project/workspaces";
  return isAbsolute(basePath) ? join(basePath, toProjectId(name)) : join(rootDir, basePath, toProjectId(name));
};

const normalizeProjectInput = async (
  input: ProjectMutationInput,
  rootDir: string,
): Promise<Required<ProjectMutationInput>> => {
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
    path: input.path?.trim() || (await buildDefaultProjectPath(name, rootDir)),
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

const readActiveDraftSummaries = async (
  workspaceDir: string,
  projectState: ProjectRegistryState,
): Promise<UiDraftSummary[]> => (projectState === "complete" ? [] : readDraftSummaries(workspaceDir));

const readDomainFileSummaries = async (
  workspaceDir: string,
  projectType: ProjectType,
  rootDir: string,
): Promise<UiDomainFileSummary[]> => {
  const linkRoots = await getProjectLinkRoots(linkRootsConfigPath(rootDir));
  const domainsPath = linkRoots[projectType].domains ?? linkRoots[projectType].default ?? ".";
  const domainsRoot = join(workspaceDir, domainsPath);

  const walk = async (dir: string): Promise<UiDomainFileSummary[]> => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return [];
      }
      throw error;
    }

    const summaries = await Promise.all(
      entries.map(async (entry) => {
        const entryPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          return walk(entryPath);
        }
        if (!entry.isFile()) {
          return [];
        }

        return [
          {
            name: entry.name,
            path: relative(workspaceDir, entryPath),
          },
        ];
      }),
    );

    return summaries.flat();
  };

  return (await walk(domainsRoot)).sort((left, right) => left.path.localeCompare(right.path));
};

const hasExportModifier = (node: ts.Node): boolean =>
  ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);

const classifySymbolKind = (
  name: string,
  fallback: UiSourceSymbolSummary["kind"],
): UiSourceSymbolSummary["kind"] => (/schema/iu.test(name) ? "schema" : fallback);

const addSymbol = (
  symbols: UiSourceSymbolSummary[],
  seen: Set<string>,
  name: string,
  kind: UiSourceSymbolSummary["kind"],
): void => {
  const trimmed = name.trim();
  if (!trimmed || seen.has(`${kind}:${trimmed}`)) {
    return;
  }

  seen.add(`${kind}:${trimmed}`);
  symbols.push({ name: trimmed, kind });
};

const extractExportedSymbols = (sourceText: string, filePath: string): UiSourceSymbolSummary[] => {
  const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, false, ts.ScriptKind.TSX);
  const symbols: UiSourceSymbolSummary[] = [];
  const seen = new Set<string>();

  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && hasExportModifier(statement) && statement.name) {
      addSymbol(symbols, seen, statement.name.text, classifySymbolKind(statement.name.text, "function"));
      continue;
    }

    if (ts.isClassDeclaration(statement) && hasExportModifier(statement) && statement.name) {
      addSymbol(symbols, seen, statement.name.text, classifySymbolKind(statement.name.text, "class"));
      continue;
    }

    if (ts.isInterfaceDeclaration(statement) && hasExportModifier(statement)) {
      addSymbol(symbols, seen, statement.name.text, classifySymbolKind(statement.name.text, "interface"));
      continue;
    }

    if (ts.isTypeAliasDeclaration(statement) && hasExportModifier(statement)) {
      addSymbol(symbols, seen, statement.name.text, classifySymbolKind(statement.name.text, "type"));
      continue;
    }

    if (ts.isVariableStatement(statement) && hasExportModifier(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) {
          addSymbol(symbols, seen, declaration.name.text, classifySymbolKind(declaration.name.text, "const"));
        }
      }
      continue;
    }

    if (ts.isExportDeclaration(statement) && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      for (const element of statement.exportClause.elements) {
        addSymbol(symbols, seen, element.name.text, classifySymbolKind(element.name.text, "const"));
      }
    }
  }

  return symbols.sort((left, right) => left.name.localeCompare(right.name) || left.kind.localeCompare(right.kind));
};

const readSourceSymbols = async (dir: string): Promise<UiSourceSymbolSummary[]> => {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const summaries = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        return readSourceSymbols(entryPath);
      }
      if (!entry.isFile() || !sourceFileExtensions.has(extname(entry.name))) {
        return [];
      }

      return extractExportedSymbols(await readFile(entryPath, "utf8"), entryPath);
    }),
  );

  const symbols = summaries.flat();
  const seen = new Set<string>();
  return symbols.filter((symbol) => {
    const key = `${symbol.kind}:${symbol.name}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  }).sort((left, right) => left.name.localeCompare(right.name) || left.kind.localeCompare(right.kind));
};

const readSourceFolderSummaries = async (
  workspaceDir: string,
  projectType: ProjectType,
  rootDir: string,
): Promise<UiSourceFolderSummary[]> => {
  const linkRoots = await getProjectLinkRoots(linkRootsConfigPath(rootDir));
  const roots = linkRoots[projectType];
  const domainsPath = roots.domains ?? roots.default ?? ".";
  if (projectType !== "mono") {
    return [
      {
        label: "Domains",
        path: domainsPath,
        symbols: await readSourceSymbols(join(workspaceDir, domainsPath)),
      },
    ];
  }

  const featuresPath = roots.features ?? roots.default ?? ".";
  return Promise.all(
    [
      { label: "Feature", path: featuresPath },
      { label: "Domains", path: domainsPath },
    ].map(async (folder) => ({
      label: folder.label,
      path: folder.path,
      symbols: await readSourceSymbols(join(workspaceDir, folder.path)),
    })),
  );
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
      availability: "missing",
    };
  }

  const metadata = parseProjectMetadataDocument(projectDocument);
  const drafts = await readActiveDraftSummaries(item.path, item.state);
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
    updatedLabel: drafts.length > 0 ? `${drafts.length} draft bundle` : "No active drafts",
    availability: "ready",
  };
};

export const listProjectRegistry = async (rootDir: string = process.cwd()): Promise<ProjectRegistryItem[]> =>
  [...(await readRegistry(rootDir)).projects];

export const createProject = async (
  input: ProjectMutationInput,
  rootDir: string = process.cwd(),
): Promise<ProjectRegistryItem> => {
  const normalized = await normalizeProjectInput(input, rootDir);
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

const assertSafeProjectDeleteTarget = async (item: ProjectRegistryItem, rootDir: string): Promise<string> => {
  const targetPath = resolve(rootDir, item.path);
  let targetStat;
  try {
    targetStat = await stat(targetPath);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      throw new Error("Project folder was not found.");
    }
    throw error;
  }
  if (!targetStat.isDirectory()) {
    throw new Error("Project path is not a directory.");
  }
  if ((await lstat(targetPath)).isSymbolicLink()) {
    throw new Error("Refusing to delete a symbolic link project path.");
  }

  const metadataPath = projectMetadataPath(targetPath);
  if (!(await pathExists(metadataPath))) {
    throw new Error("Project metadata was not found; refusing to delete files.");
  }

  const [realTarget, realRoot] = await Promise.all([realpath(targetPath), realpath(rootDir)]);
  const targetRoot = parse(realTarget).root;
  if (realTarget === targetRoot || realTarget === realRoot) {
    throw new Error("Refusing to delete an unsafe project path.");
  }

  return realTarget;
};

export const deleteProjectFiles = async (projectId: string, rootDir: string = process.cwd()): Promise<boolean> => {
  const registry = await readRegistry(rootDir);
  const item = registry.projects.find((project) => project.id === projectId);
  if (!item) {
    return false;
  }

  const realTarget = await assertSafeProjectDeleteTarget(item, rootDir);
  await rm(realTarget, { recursive: true });
  await writeRegistry(rootDir, { projects: registry.projects.filter((project) => project.id !== projectId) });
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
  const state = isProjectState(metadata.state) ? metadata.state : "init";
  const drafts = await readActiveDraftSummaries(rootDir, state);
  const jobDocument = await readOptionalFile(projectJobPath(rootDir));

  return [
    {
      id: toProjectId(metadata.name),
      name: metadata.name,
      type: metadata.type,
      description: metadata.description,
      spec: metadata.spec,
      path: metadata.path || rootDir,
      state,
      draftCount: drafts.length,
      hasJob: jobDocument !== null,
      updatedLabel: drafts.length > 0 ? `${drafts.length} draft bundle` : "No active drafts",
      availability: "ready",
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
    domainFiles: await readDomainFileSummaries(detailRoot, project.type, rootDir),
    sourceFolders: await readSourceFolderSummaries(detailRoot, project.type, rootDir),
    drafts: await readActiveDraftSummaries(detailRoot, project.state),
  };
};
