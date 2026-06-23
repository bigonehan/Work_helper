import matter from "gray-matter";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, parse, relative } from "node:path";
import { isNotFoundError } from "../fsUtils";
import { PROJECT_TYPES, type AppSettings, type ProjectSpec, type ProjectType } from "../types";

export const PROJECT_METADATA_DIR = ".project";
export const PROJECT_CAPTURE_DIR = ".project/captures";
const TEMPLATE_DIR = join(process.cwd(), "assets", "templates");
export const CONFIG_PATH = join(process.cwd(), "configs", "config.yaml");
export const PROJECT_LINK_ROOTS_CONFIG_PATH = join(process.cwd(), "configs", "project-link-roots.yaml");
export const DEFAULT_PROJECT_PATH = ".project/workspaces";

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

export type ProjectLinkRootMap = Record<string, string>;
export type ProjectLinkRootsConfig = Record<ProjectType, ProjectLinkRootMap>;

export interface ResolveProjectWikiLinkInput {
  readonly workspaceDir: string;
  readonly projectType: ProjectType;
  readonly section: string;
  readonly link: string;
  readonly configPath?: string;
}

const DEFAULT_PROJECT_LINK_ROOTS: ProjectLinkRootsConfig = {
  code: {
    default: ".",
    domains: "src/domains",
    features: "src/features",
    rules: ".project/rules",
  },
  mono: {
    default: ".",
    domains: "packages/domains",
    features: "packages/features",
    rules: ".project/rules",
  },
};

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

  if (!section.includes("`Skills/`") || !section.includes("specific Skill")) {
    throw new Error("AGENTS.md Workflow Rules must document the target workspace Skills/ lookup rule for specific Skill requests.");
  }

  if (!section.includes("`bun run lint:imports`") || !section.includes("`Skills/import-check/SKILL.md`")) {
    throw new Error("AGENTS.md Workflow Rules must document the import lint check and import-check Skill guidance.");
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

export const PROJECT_GUIDE_DOCUMENT = [
  "# 3. 해결책",
  "```",
  "인계 정보를 입력으로 받아",
  "서비스의 개념, 작동 방식, 필요 데이터를 구체화한다.",
  "```",
  "",
  "## 요구 ",
  "```",
  "문제를 해결하기위해서 요구되는 사용자의 정보를 작성한다. ",
  "",
  "출력예시) 헌혈 공유 앱 ",
  "- 사용자의 혈핵형 정보 ",
  "```",
  "## 결과 ",
  "```",
  "사용자의 문제가 해결된 상태가 무엇인지를 정의한다. ",
  "출력 예시) 헌혈 공유 앱 ",
  "- 사용자는 자신의 피를 타인에게 기증할 수 있다. ",
  "```",
  "## 구조 ",
  "```",
  "사용자가 서비스를 이용하는 흐름을 단계별로 작성한다. ",
  "각 단계에서 어떤 데이터가 입력·처리·출력되는지 명시한다. ",
  "```",
  "## 도메인 ",
  "```",
  "기능을 끝가지 구현하기 위해서 필요한 도메인을 단위별로 적는다.",
  "출력예시) 헌혈 공유 시스템 ",
  "- 헌혈의집",
  "- 사용자 ",
  "- 혈액 ",
  "```",
  "",
  "### 입력 ",
  "```",
  "사용자가 입력하는것을 말한다. 명사형태로 작성한다.  ",
  "출력 예시) 헌혈앱인 경우 ",
  "- 현재 위치",
  "- 헌혈을 할 수 있는 시간",
  "- 12시전 금식 유무 ",
  "```",
  "### 서버 ",
  "```",
  "서버에서 가지고 있어야 하는 필요로 하는 데이터를 선언한다 ",
  "구체적인 스키마가 아닌 커다란 도메인 단위로 작성한다. ",
  "```",
  "### 시스템 ",
  "```",
  "시스템에서 필요한 모듈을 단위별로 작성한다 ",
  "출력 형식)",
  "#### 모듈명 ",
  "- 하는 작업 ",
  "출력예시) 헌혈 공유 시스템",
  "#### 혈액형 정보 관리 시스템 ",
  "- 현재 모인 혈액형들을 타입별로 분류하여 CRUD가 가능하게 보존한다 ",
  "- 사용자에게 맞는 혈액형에 정보를 추천하고 분류한다 ",
  "#### 헌혈의 집 관리 시스템 ",
  "- 사용자의 정보에 맞춰 헌혈의 집 위치를 계산한다.  ",
  "```",
  "### 필터링 ",
  "```",
  "시스템은 데이터를 가져오고나 취합할때 거쳐야 하는 필터과정을 적는다 ",
  "필요한 기능 모듈과 필터링에 사용되는 데이터를 작성한다. ",
  " ",
  "출력예시) 헌혈 공유 시스템 ",
  "#### 혈액형 판단 ",
  "- 혈액형 타입 ",
  "#### 헌혈의 집 검색 ",
  "- 사는곳 ",
  "```",
  "### 요구 선언 ",
  "```",
  "사용자가 어떤것을 요구할수 있고 어떤 결과를 받아올 수 있는지를 선언한다 ",
  "```",
  "## 데이터",
  "```",
  "서버에서 서비스 작동에 필요한 데이터를 조사한다. 입력정보 혹은 참고 자료에 ",
  "실제 링크와 함께 작성한다. ",
  "",
  "출력 형식) ",
  "### 필요 데이터 이름 ",
  "[링크](데이터가 있는곳 실제 주소)",
  "- 스키마중 필요한 속성",
  "출력 예시) 헌혈앱  ",
  "### 국가지리원 헌혈의 집 API",
  "[링크](데이터가 있는곳 실제 주소)",
  "- location : 위치 정보 ",
  "- isOpen : 현재 운영 여부 ",
  "",
  "```",
].join("\n");

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
    "",
    PROJECT_GUIDE_DOCUMENT,
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

const defaultConfig = (): Record<string, string> => ({
  logicRuntime: "effect.ts",
  serverRuntime: "bun",
  frontendFramework: "next.js",
  uiLibrary: "shadcn",
  defaultProjectPath: DEFAULT_PROJECT_PATH,
  responsiveUi: "true",
  uiMobileCheck: "playwright로 브라우저를 열고 모바일 모드에서 화면 깨짐 여부를 검사한다",
  testFirstPolicy: "코드 개선, 수정, 신규 기능 추가 시 unit test를 먼저 작성한다",
});

export const getConfig = async (configPath: string = CONFIG_PATH): Promise<Record<string, string>> => {
  try {
    return { ...defaultConfig(), ...parseFlatConfig(await readFile(configPath, "utf8")) };
  } catch (error) {
    if (isNotFoundError(error)) {
      return defaultConfig();
    }
    throw error;
  }
};

export const getConfigValue = (config: Record<string, string>, key: string): string | undefined => config[key];

export const readConfigValue = async (key: string, configPath: string = CONFIG_PATH): Promise<string | undefined> => {
  const config = await getConfig(configPath);
  return getConfigValue(config, key);
};

export const setConfigValue = async (key: string, value: string, configPath: string = CONFIG_PATH): Promise<void> => {
  const config = await getConfig(configPath);
  config[key] = value;
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, serializeFlatConfig(config), "utf8");
};

const normalizeSectionName = (value: string): string => value.trim().replace(/^#+\s*/u, "").toLowerCase();

const normalizeRelativeConfigPath = (value: string): string => value.trim().replace(/^["']|["']$/gu, "").replace(/\\/gu, "/");

const cloneProjectLinkRoots = (): ProjectLinkRootsConfig => ({
  code: { ...DEFAULT_PROJECT_LINK_ROOTS.code },
  mono: { ...DEFAULT_PROJECT_LINK_ROOTS.mono },
});

const parseProjectLinkRootsConfig = (input: string): Partial<ProjectLinkRootsConfig> => {
  const parsed: Partial<ProjectLinkRootsConfig> = {};
  let currentType: ProjectType | null = null;

  for (const rawLine of input.split("\n")) {
    const uncommented = rawLine.replace(/\s+#.*$/u, "");
    if (!uncommented.trim()) {
      continue;
    }

    const topLevelMatch = uncommented.match(/^([A-Za-z0-9_-]+):\s*$/u);
    if (topLevelMatch) {
      const candidate = topLevelMatch[1];
      currentType = PROJECT_TYPES.includes(candidate as ProjectType) ? (candidate as ProjectType) : null;
      if (currentType && !parsed[currentType]) {
        parsed[currentType] = {};
      }
      continue;
    }

    const entryMatch = uncommented.match(/^\s+([A-Za-z0-9_-]+):\s*(.*?)\s*$/u);
    if (!entryMatch || !currentType) {
      continue;
    }

    const key = normalizeSectionName(entryMatch[1]);
    const value = normalizeRelativeConfigPath(entryMatch[2]);
    if (key && value) {
      parsed[currentType] = { ...(parsed[currentType] ?? {}), [key]: value };
    }
  }

  return parsed;
};

export const getProjectLinkRoots = async (
  configPath: string = PROJECT_LINK_ROOTS_CONFIG_PATH,
): Promise<ProjectLinkRootsConfig> => {
  const roots = cloneProjectLinkRoots();
  let document: string;
  try {
    document = await readFile(configPath, "utf8");
  } catch (error) {
    if (isNotFoundError(error)) {
      return roots;
    }
    throw error;
  }

  const parsed = parseProjectLinkRootsConfig(document);
  for (const projectType of PROJECT_TYPES) {
    roots[projectType] = {
      ...roots[projectType],
      ...(parsed[projectType] ?? {}),
    };
  }

  return roots;
};

export const resolveProjectLinkRoot = async (
  projectType: ProjectType,
  section: string,
  configPath: string = PROJECT_LINK_ROOTS_CONFIG_PATH,
): Promise<string> => {
  const roots = await getProjectLinkRoots(configPath);
  const rootMap = roots[projectType];
  const sectionRoot = rootMap[normalizeSectionName(section)];
  return sectionRoot ?? rootMap.default ?? ".";
};

const isExplicitProjectPath = (link: string): boolean => /[\\/]/u.test(link);

const fileExists = async (path: string): Promise<boolean> => {
  try {
    const result = await stat(path);
    return result.isFile();
  } catch (error) {
    if (isNotFoundError(error)) {
      return false;
    }
    throw error;
  }
};

const findWikiLinkCandidates = async (rootDir: string, link: string): Promise<string[]> => {
  let entries;
  try {
    entries = await readdir(rootDir, { withFileTypes: true });
  } catch (error) {
    if (isNotFoundError(error)) {
      return [];
    }
    throw error;
  }

  const candidates = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = join(rootDir, entry.name);
      if (entry.isDirectory()) {
        return findWikiLinkCandidates(entryPath, link);
      }
      if (!entry.isFile()) {
        return [];
      }
      return entry.name === link || parse(entry.name).name === link ? [entryPath] : [];
    }),
  );

  return candidates.flat();
};

export const resolveProjectWikiLink = async (input: ResolveProjectWikiLinkInput): Promise<string> => {
  const link = input.link.trim().replace(/^\[\[/u, "").replace(/\]\]$/u, "");
  if (!link) {
    throw new Error("Project wiki link is required.");
  }

  if (isExplicitProjectPath(link)) {
    const explicitPath = join(input.workspaceDir, link);
    if (!(await fileExists(explicitPath))) {
      throw new Error(`Project wiki link target was not found: ${link}`);
    }
    return relative(input.workspaceDir, explicitPath);
  }

  const root = await resolveProjectLinkRoot(input.projectType, input.section, input.configPath);
  const rootDir = join(input.workspaceDir, root);
  const candidates = await findWikiLinkCandidates(rootDir, link);
  if (candidates.length === 0) {
    throw new Error(`Project wiki link target was not found in ${root}: ${link}`);
  }
  if (candidates.length > 1) {
    throw new Error(`Project wiki link target is ambiguous in ${root}: ${link}`);
  }

  return relative(input.workspaceDir, candidates[0]);
};

export const getAppSettings = async (configPath: string = CONFIG_PATH): Promise<AppSettings> => {
  const config = await getConfig(configPath);
  return {
    defaultProjectPath: getConfigValue(config, "defaultProjectPath") || DEFAULT_PROJECT_PATH,
  };
};

export const updateAppSettings = async (
  input: Partial<AppSettings>,
  configPath: string = CONFIG_PATH,
): Promise<AppSettings> => {
  const defaultProjectPath = input.defaultProjectPath?.trim();
  if (defaultProjectPath !== undefined && !defaultProjectPath) {
    throw new Error("Default project path is required.");
  }
  if (defaultProjectPath !== undefined) {
    await setConfigValue("defaultProjectPath", defaultProjectPath, configPath);
  }
  return getAppSettings(configPath);
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
