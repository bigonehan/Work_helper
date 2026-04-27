import matter from "gray-matter";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ProjectSpec, ProjectType } from "../types";

export const PROJECT_METADATA_DIR = ".project";
export const PROJECT_CAPTURE_DIR = ".project/captures";
const TEMPLATE_DIR = join(process.cwd(), "assets", "templates");
const CONFIG_PATH = join(process.cwd(), "assets", "configs", "config.yaml");

export interface JobFilePaths {
  readonly jobFilePath: string;
  readonly draftsRootDir: string;
  readonly draftDir: string;
  readonly draftDocumentPath: string;
  readonly captureDir: string;
}

export interface DraftDocumentItem {
  readonly id: string;
  readonly file: string;
  readonly description: string;
}

export interface DraftDocumentChecks {
  readonly automated: readonly string[];
  readonly assertions: readonly string[];
}

export interface DraftDocumentMetadata {
  readonly request: string;
  readonly summary: string;
  readonly draftItems: readonly DraftDocumentItem[];
  readonly checks: DraftDocumentChecks;
}

export const formatJobTimestamp = (date: Date): string => {
  const year = String(date.getUTCFullYear()).slice(-2);
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hour = String(date.getUTCHours()).padStart(2, "0");
  const minute = String(date.getUTCMinutes()).padStart(2, "0");
  return `${year}${month}${day}_${hour}${minute}`;
};

export const toSnakeCaseSummary = (value: string): string =>
  value
    .trim()
    .replace(/[^0-9A-Za-z가-힣]+/gu, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase() || "job";

export const toLimitedSnakeCase = (value: string, maxLength: number = 10, fallback: string = "draft"): string => {
  const normalized = toSnakeCaseSummary(value);
  const sliced = normalized.slice(0, maxLength).replace(/^_+|_+$/g, "").replace(/_+$/g, "");
  return sliced || fallback.slice(0, maxLength);
};

export const buildUniqueTaskName = (value: string, usedNames: Set<string>, maxLength: number = 10): string => {
  const base = toLimitedSnakeCase(value, maxLength, "draft");
  if (!usedNames.has(base)) {
    usedNames.add(base);
    return base;
  }

  for (let index = 1; index < 100; index += 1) {
    const suffix = `_${String(index).padStart(2, "0")}`;
    const trimmedBase = base.slice(0, Math.max(1, maxLength - suffix.length)).replace(/_+$/g, "") || "d";
    const candidate = `${trimmedBase}${suffix}`;
    if (!usedNames.has(candidate)) {
      usedNames.add(candidate);
      return candidate;
    }
  }

  throw new Error(`Could not build a unique task name for '${value}'.`);
};

export const detectLegacyRemovalRequest = (request: string): boolean => /(전부|레거시\s*제거|모두)/u.test(request);

export const buildLegacyRemovalChecklist = (request: string): string[] =>
  detectLegacyRemovalRequest(request)
    ? ["rg를 통해 관련 키워드가 남아있는지 검사후 남아있으면 모두 제거한다."]
    : [];

export const buildProjectMetadataPath = (rootDir: string): string =>
  join(rootDir, PROJECT_METADATA_DIR, "project.md");

export const buildJobFilePaths = (rootDir: string, timestamp: string, summary: string): JobFilePaths => ({
  jobFilePath: join(rootDir, ".project", "job.md"),
  draftsRootDir: join(rootDir, ".project", "drafts"),
  draftDir: join(rootDir, ".project", "drafts", summary),
  draftDocumentPath: join(rootDir, ".project", "drafts", summary, `${summary}.md`),
  captureDir: join(rootDir, PROJECT_CAPTURE_DIR),
});

export const loadTemplateAsset = async (templateName: "project.md" | "job.md" | "draft.yaml" | "draft.md"): Promise<string> =>
  readFile(join(TEMPLATE_DIR, templateName), "utf8");

export const getAgentWorkflowRules = async (agentsPath: string = join(process.cwd(), "AGENTS.md")): Promise<string> => {
  const document = await readFile(agentsPath, "utf8");
  const heading = "## Workflow Rules";
  const start = document.indexOf(heading);
  if (start === -1) {
    throw new Error("AGENTS.md is missing the '## Workflow Rules' section.");
  }

  const sectionStart = start + heading.length;
  const nextHeadingMatch = document.slice(sectionStart).match(/\n##\s+/);
  const sectionEnd = nextHeadingMatch ? sectionStart + (nextHeadingMatch.index ?? 0) : document.length;
  const section = document.slice(sectionStart, sectionEnd).trim();

  if (!section.includes("`request -> init -> plan -> analyze -> build -> check`")) {
    throw new Error("AGENTS.md Workflow Rules must define the stage order 'request -> init -> plan -> analyze -> build -> check'.");
  }

  if (!section.includes("`project.md`") || !section.includes("`job.md`")) {
    throw new Error("AGENTS.md Workflow Rules must document the project.md and job.md artifacts.");
  }

  if (!section.includes("`draft")) {
    throw new Error("AGENTS.md Workflow Rules must document the draft artifact structure.");
  }

  return section;
};

interface CreateProjectMetadataInput {
  readonly name: string;
  readonly type: ProjectType;
  readonly description: string;
  readonly spec: ProjectSpec;
  readonly path: string;
  readonly state: "init" | "wait" | "work" | "check" | "complete";
}

interface ProjectMetadata {
  readonly name: string;
  readonly type: ProjectType;
  readonly description: string;
  readonly spec: ProjectSpec;
  readonly path: string;
  readonly state: "init" | "wait" | "work" | "check" | "complete";
}

export const inferProjectSpec = (request: string): ProjectSpec => {
  const normalized = request.toLowerCase();
  if (/(^|[^a-z])rust([^a-z]|$)/iu.test(normalized)) {
    return "rust";
  }

  if (/(^|[^a-z])python([^a-z]|$)/iu.test(normalized)) {
    return "python";
  }

  return "typescript";
};

export const createProjectMetadataDocument = (input: CreateProjectMetadataInput): string =>
  [
    "# info",
    "## name",
    input.name,
    "## type",
    input.type,
    "## description",
    input.description,
    "## spec",
    input.spec,
    "## path",
    input.path,
    "## state",
    input.state,
    "# architecture",
    "name:",
    "# features",
    "# rules",
    "# constraints",
    "# domains",
    "## name",
    "### states",
    "### action",
    "### rules",
    "### constraints",
  ].join("\n");

const formatYamlScalar = (value: string): string => JSON.stringify(value);

const formatYamlList = (values: readonly string[], indent: string = "  "): string =>
  values.map((value) => `${indent}- ${formatYamlScalar(value)}`).join("\n");

const formatDraftItemsFrontMatter = (items: readonly DraftDocumentItem[]): string =>
  items.length === 0
    ? "  []"
    : items
        .map((item) =>
          [
            "  - id: " + formatYamlScalar(item.id),
            "    file: " + formatYamlScalar(item.file),
            "    description: " + formatYamlScalar(item.description),
          ].join("\n"),
        )
        .join("\n");

const formatMarkdownList = (items: readonly string[]): string =>
  items.length === 0 ? "- none" : items.map((item) => `- ${item}`).join("\n");

const formatDraftItemList = (items: readonly DraftDocumentItem[]): string =>
  items.length === 0 ? "- none" : items.map((item) => `- \`${item.id}\` (${item.file}): ${item.description}`).join("\n");

export const createDraftDocument = async (input: DraftDocumentMetadata): Promise<string> => {
  const template = await loadTemplateAsset("draft.md");
  const frontMatter = [
    "---",
    `request: ${formatYamlScalar(input.request)}`,
    `summary: ${formatYamlScalar(input.summary)}`,
    input.draftItems.length > 0 ? ["draft_items:", formatDraftItemsFrontMatter(input.draftItems)].join("\n") : "draft_items: []",
    input.checks.automated.length > 0
      ? ["checks:", "  automated:", formatYamlList(input.checks.automated, "    ")].join("\n")
      : ["checks:", "  automated: []"].join("\n"),
    input.checks.assertions.length > 0
      ? ["  assertions:", formatYamlList(input.checks.assertions, "    ")].join("\n")
      : "  assertions: []",
    "---",
  ].join("\n");

  return template
    .replace("{{front_matter}}", frontMatter)
    .replace("{{request}}", input.request)
    .replace("{{summary}}", input.summary)
    .replace("{{draft_items}}", formatDraftItemList(input.draftItems))
    .replace("{{automated_checks}}", formatMarkdownList(input.checks.automated))
    .replace("{{assertions}}", formatMarkdownList(input.checks.assertions));
};

export const parseDraftDocument = (document: string): DraftDocumentMetadata => {
  const parsed = matter(document);
  const data = (parsed.data ?? {}) as Record<string, unknown>;
  const draftItemsRaw = Array.isArray(data.draft_items) ? data.draft_items : [];
  const checksRaw = typeof data.checks === "object" && data.checks !== null ? (data.checks as Record<string, unknown>) : {};
  const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

  return {
    request: typeof data.request === "string" ? data.request : "",
    summary: typeof data.summary === "string" ? data.summary : "",
    draftItems: draftItemsRaw
      .filter(isRecord)
      .map((item) => ({
        id: typeof item.id === "string" ? item.id : "",
        file: typeof item.file === "string" ? item.file : "",
        description: typeof item.description === "string" ? item.description : "",
      }))
      .filter((item) => item.id && item.file),
    checks: {
      automated: Array.isArray(checksRaw.automated) ? checksRaw.automated.filter((value): value is string => typeof value === "string") : [],
      assertions: Array.isArray(checksRaw.assertions) ? checksRaw.assertions.filter((value): value is string => typeof value === "string") : [],
    },
  };
};

export const readDraftDocument = async (draftDocumentPath: string): Promise<DraftDocumentMetadata> =>
  parseDraftDocument(await readFile(draftDocumentPath, "utf8"));

export const parseProjectMetadataDocument = (document: string): ProjectMetadata => {
  const sections = extractMarkdownValueMap(document);

  return {
    name: sections.name ?? "",
    type: (sections.type ?? "code") as ProjectType,
    description: sections.description ?? "",
    spec: (sections.spec ?? "typescript") as ProjectSpec,
    path: sections.path ?? "",
    state: (sections.state ?? "init") as ProjectMetadata["state"],
  };
};

export const getConfig = async (configPath: string = CONFIG_PATH): Promise<Record<string, string>> =>
  parseFlatConfig(await readFile(configPath, "utf8"));

export const getConfigValue = (config: Record<string, string>, key: string): string | undefined => config[key];

export const readConfigValue = async (key: string, configPath: string = CONFIG_PATH): Promise<string | undefined> => {
  const config = await getConfig(configPath);
  return getConfigValue(config, key);
};

export const setConfigValue = async (key: string, value: string, configPath: string = CONFIG_PATH): Promise<void> => {
  const config = await getConfig(configPath);
  config[key] = value;
  await writeFile(configPath, serializeFlatConfig(config), "utf8");
};

function parseFlatConfig(input: string): Record<string, string> {
  const config: Record<string, string> = {};

  for (const rawLine of input.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf(":");
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    config[key] = value;
  }

  return config;
}

function serializeFlatConfig(config: Record<string, string>): string {
  return `${Object.entries(config)
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n")}\n`;
}

function extractMarkdownValueMap(document: string): Record<string, string> {
  const lines = document.split("\n");
  const values: Record<string, string> = {};

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]?.trim() ?? "";
    if (!line.startsWith("## ")) {
      continue;
    }

    const key = line.slice(3).trim().toLowerCase();
    const nextLine = lines[index + 1]?.trim() ?? "";
    if (!nextLine || nextLine.startsWith("<!--") || nextLine.startsWith("#")) {
      continue;
    }

    values[key] = nextLine;
  }

  return values;
}
