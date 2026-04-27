import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  PROJECT_CAPTURE_DIR,
  PROJECT_METADATA_DIR,
  buildJobFilePaths,
  buildUniqueTaskName,
  buildLegacyRemovalChecklist,
  buildProjectMetadataPath,
  createDraftDocument,
  createProjectMetadataDocument,
  detectLegacyRemovalRequest,
  formatJobTimestamp,
  getAgentWorkflowRules,
  getConfig,
  getConfigValue,
  inferProjectSpec,
  loadTemplateAsset,
  parseDraftDocument,
  parseProjectMetadataDocument,
  readConfigValue,
  setConfigValue,
  toLimitedSnakeCase,
  toSnakeCaseSummary,
} from "../src/server/project";

describe("server project helpers", () => {
  test("formats job timestamps as YYMMDD_HHMM", () => {
    const formatted = formatJobTimestamp(new Date("2026-04-16T13:45:00Z"));
    expect(formatted).toBe("260416_1345");
  });

  test("builds snake case summaries", () => {
    expect(toSnakeCaseSummary("게시물 삭제 기능 추가")).toBe("게시물_삭제_기능_추가");
    expect(toSnakeCaseSummary("legacy remove ALL")).toBe("legacy_remove_all");
    expect(toLimitedSnakeCase("게시물 삭제 기능 추가", 10, "job")).toBe("게시물_삭제_기능");
    expect(toLimitedSnakeCase("Create React Todo App", 10, "job")).toBe("create_rea");
  });

  test("builds unique short task names", () => {
    const usedNames = new Set<string>();
    expect(buildUniqueTaskName("gift mapping", usedNames, 10)).toBe("gift_mappi");
    expect(buildUniqueTaskName("gift mapping", usedNames, 10)).toBe("gift_ma_01");
  });

  test("detects legacy removal requests and builds checklist", () => {
    expect(detectLegacyRemovalRequest("레거시 제거 전부 해줘")).toBe(true);
    expect(detectLegacyRemovalRequest("기능 추가만 해줘")).toBe(false);
    expect(buildLegacyRemovalChecklist("레거시 제거 전부 해줘")).toEqual([
      "rg를 통해 관련 키워드가 남아있는지 검사후 남아있으면 모두 제거한다.",
    ]);
  });

  test("builds project and job file paths under .project", () => {
    const rootDir = "/tmp/work-helper";
    expect(buildProjectMetadataPath(rootDir)).toBe(join(rootDir, PROJECT_METADATA_DIR, "project.md"));

    expect(buildJobFilePaths(rootDir, "260416_1345", "게시물_삭제")).toEqual({
      jobFilePath: join(rootDir, ".project", "job.md"),
      draftsRootDir: join(rootDir, ".project", "drafts"),
      draftDir: join(rootDir, ".project", "drafts", "게시물_삭제"),
      draftDocumentPath: join(rootDir, ".project", "drafts", "게시물_삭제", "게시물_삭제.md"),
      captureDir: join(rootDir, PROJECT_CAPTURE_DIR),
    });
  });

  test("loads template and config assets through helper functions", async () => {
    const projectTemplate = await loadTemplateAsset("project.md");
    const draftTemplate = await loadTemplateAsset("draft.md");
    const config = await getConfig();

    expect(projectTemplate).toContain("# info");
    expect(draftTemplate).toContain("{{front_matter}}");
    expect(draftTemplate).toContain("## Draft Items");
    expect(getConfigValue(config, "frontendFramework")).toBe("next.js");
    expect(getConfigValue(config, "uiLibrary")).toBe("shadcn");
    expect(getConfigValue(config, "uiMobileCheck")).toBe(
      "playwright로 브라우저를 열고 모바일 모드에서 화면 깨짐 여부를 검사한다",
    );
    expect(getConfigValue(config, "testFirstPolicy")).toBe(
      "코드 개선, 수정, 신규 기능 추가 시 unit test를 먼저 작성한다",
    );
  });

  test("reads a config value directly from config.yaml", async () => {
    await expect(readConfigValue("frontendFramework")).resolves.toBe("next.js");
  });

  test("reads workflow rules from AGENTS.md without fallback", async () => {
    const workflowRules = await getAgentWorkflowRules();

    expect(workflowRules).toContain("`request -> init -> plan -> analyze -> build -> check`");
    expect(workflowRules).toContain("`job.md`");
    expect(workflowRules).toContain("`./.project/drafts/{summary}/{summary}.md`");
  });

  test("creates and parses draft bundle markdown metadata", async () => {
    const document = await createDraftDocument({
      request: "게시물 삭제 기능 추가",
      summary: "게시물_삭제",
      draftItems: [
        {
          id: "delete_post",
          file: "delete_post.yaml",
          description: "게시물 삭제 서비스를 구현한다",
        },
      ],
      checks: {
        automated: ["bun test", "bunx tsc --noEmit"],
        assertions: ["delete_post: 게시물 삭제 서비스를 구현한다"],
      },
    });
    const parsed = parseDraftDocument(document);

    expect(document).toContain("---");
    expect(document).toContain("delete_post.yaml");
    expect(parsed.summary).toBe("게시물_삭제");
    expect(parsed.draftItems[0]).toEqual({
      id: "delete_post",
      file: "delete_post.yaml",
      description: "게시물 삭제 서비스를 구현한다",
    });
    expect(parsed.checks.automated).toContain("bun test");
  });

  test("sets a config value in a target config file", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "work-helper-config-"));
    const configPath = join(tempDir, "config.yaml");
    await writeFile(configPath, "frontendFramework: next.js\nuiLibrary: shadcn\n", "utf8");

    await setConfigValue("uiLibrary", "playwright-mobile-check", configPath);

    const updatedContents = await readFile(configPath, "utf8");
    expect(updatedContents).toContain("uiLibrary: playwright-mobile-check");
    await expect(readConfigValue("uiLibrary", configPath)).resolves.toBe("playwright-mobile-check");
  });

  test("creates and parses project metadata documents with single-value spec", () => {
    const document = createProjectMetadataDocument({
      name: "demo-project",
      type: "code",
      description: "hello world bootstrap project",
      spec: "typescript",
      path: "/tmp/demo-project",
      state: "init",
    });
    const parsed = parseProjectMetadataDocument(document);

    expect(document).toContain("## type\ncode");
    expect(document).toContain("## spec\ntypescript");
    expect(parsed).toEqual({
      name: "demo-project",
      type: "code",
      description: "hello world bootstrap project",
      spec: "typescript",
      path: "/tmp/demo-project",
      state: "init",
    });
  });

  test("infers project spec from the request and defaults to typescript", () => {
    expect(inferProjectSpec("Create a rust CLI hello world")).toBe("rust");
    expect(inferProjectSpec("make a python project")).toBe("python");
    expect(inferProjectSpec("create a react todo app")).toBe("typescript");
  });
});
