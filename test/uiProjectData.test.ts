import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createProject,
  deleteProject,
  deleteProjectFiles,
  getProjectDetail,
  listProjectRegistry,
  listProjects,
  updateProject,
} from "../src/server/uiProjectData";

const createWorkspace = async () => mkdtemp(join(tmpdir(), "work-helper-ui-"));

describe("ui project data", () => {
  test("returns an empty list when project metadata is missing", async () => {
    const workspace = await createWorkspace();
    await expect(listProjects(workspace)).resolves.toEqual([]);
  });

  test("loads local project artifact summaries", async () => {
    const workspace = await createWorkspace();
    await mkdir(join(workspace, ".project", "drafts", "basic"), { recursive: true });
    await writeFile(
      join(workspace, ".project", "project.md"),
      [
        "# info",
        "## name",
        "demo",
        "## type",
        "code",
        "## description",
        "Demo project",
        "## spec",
        "typescript",
        "## path",
        workspace,
        "## state",
        "work",
      ].join("\n"),
      "utf8",
    );
    await writeFile(join(workspace, ".project", "job.md"), "# requirement\n## Demo Job\n# check\n", "utf8");
    await writeFile(
      join(workspace, ".project", "drafts", "basic", "basic.md"),
      "---\nsummary: basic\ndraft_items: []\nchecks:\n  automated: []\n  assertions: []\n---\n# Draft Summary\n",
      "utf8",
    );

    const projects = await listProjects(workspace);
    expect(projects).toHaveLength(1);
    expect(projects[0]).toMatchObject({
      id: "demo",
      name: "demo",
      description: "Demo project",
      state: "work",
      draftCount: 1,
      hasJob: true,
    });
  });

  test("keeps completed local project draft history on detail data", async () => {
    const workspace = await createWorkspace();
    await mkdir(join(workspace, ".project", "drafts", "basic"), { recursive: true });
    await writeFile(
      join(workspace, ".project", "project.md"),
      [
        "# info",
        "## name",
        "demo",
        "## type",
        "code",
        "## description",
        "Demo project",
        "## spec",
        "typescript",
        "## path",
        workspace,
        "## state",
        "complete",
      ].join("\n"),
      "utf8",
    );
    await writeFile(
      join(workspace, ".project", "drafts", "basic", "basic.md"),
      "---\nsummary: basic\ndraft_items: []\nchecks:\n  automated: []\n  assertions: []\n---\n# Draft Summary\n",
      "utf8",
    );

    const projects = await listProjects(workspace);
    expect(projects[0]).toMatchObject({
      state: "complete",
      draftCount: 0,
      updatedLabel: "No active drafts",
    });

    const detail = await getProjectDetail("demo", workspace);
    expect(detail?.drafts).toHaveLength(1);
    expect(detail?.drafts[0]).toMatchObject({
      summary: "basic",
      request: "",
      document: "---\nsummary: basic\ndraft_items: []\nchecks:\n  automated: []\n  assertions: []\n---\n# Draft Summary\n",
      draftItems: [],
      itemCount: 0,
    });
  });

  test("loads detail content for the selected project id", async () => {
    const workspace = await createWorkspace();
    await mkdir(join(workspace, ".project"), { recursive: true });
    await writeFile(
      join(workspace, ".project", "project.md"),
      [
        "# info",
        "## name",
        "demo",
        "## type",
        "code",
        "## description",
        "Demo",
        "## spec",
        "typescript",
        "## path",
        "/tmp/demo",
        "## state",
        "check",
        "# 3. 해결책",
        "## 요구",
        "- 사용자 요구",
        "## 데이터",
        "- 참고 데이터",
      ].join("\n"),
      "utf8",
    );
    await writeFile(join(workspace, ".project", "job.md"), "# requirement\n## Demo Job\n", "utf8");

    const detail = await getProjectDetail("demo", workspace);
    expect(detail?.project.name).toBe("demo");
    expect(detail?.jobDocument).toContain("Demo Job");
    expect(detail?.planningDocument).toBe("# 3. 해결책\n## 요구\n- 사용자 요구\n## 데이터\n- 참고 데이터");
    expect(detail?.domainFiles).toEqual([]);
    expect(detail?.sourceFolders).toEqual([
      {
        label: "Domains",
        path: "src/domains",
        symbols: [],
      },
    ]);
    await expect(getProjectDetail("missing", workspace)).resolves.toBeNull();
  });

  test("loads mono project feature and domain symbols from source folders", async () => {
    const root = await createWorkspace();
    const projectPath = join(root, "projects", "mono-demo");
    const created = await createProject(
      {
        name: "Mono Demo",
        type: "mono",
        state: "work",
        path: projectPath,
      },
      root,
    );
    await mkdir(join(projectPath, "packages", "features", "checkout"), { recursive: true });
    await mkdir(join(projectPath, "packages", "domains", "billing"), { recursive: true });
    await writeFile(
      join(projectPath, "packages", "features", "checkout", "checkout.ts"),
      [
        "export const CheckoutSchema = {};",
        "export function startCheckout() { return null; }",
        "const hiddenHelper = () => null;",
      ].join("\n"),
      "utf8",
    );
    await writeFile(
      join(projectPath, "packages", "domains", "billing", "invoice.ts"),
      [
        "export interface InvoiceState { id: string }",
        "export type InvoiceEvent = { type: 'paid' };",
        "export class InvoiceAggregate {}",
      ].join("\n"),
      "utf8",
    );
    await writeFile(join(projectPath, "packages", "domains", "orders.md"), "# Orders\n", "utf8");
    await writeFile(join(projectPath, "packages", "domains", "billing", "invoice.yaml"), "name: invoice\n", "utf8");

    const detail = await getProjectDetail(created.id, root);

    expect(detail?.sourceFolders).toEqual([
      {
        label: "Feature",
        path: "packages/features",
        symbols: [
          {
            name: "CheckoutSchema",
            kind: "schema",
          },
          {
            name: "startCheckout",
            kind: "function",
          },
        ],
      },
      {
        label: "Domains",
        path: "packages/domains",
        symbols: [
          {
            name: "InvoiceAggregate",
            kind: "class",
          },
          {
            name: "InvoiceEvent",
            kind: "type",
          },
          {
            name: "InvoiceState",
            kind: "interface",
          },
        ],
      },
    ]);
    expect(detail?.domainFiles).toEqual([
      {
        name: "invoice.ts",
        path: join("packages", "domains", "billing", "invoice.ts"),
      },
      {
        name: "invoice.yaml",
        path: join("packages", "domains", "billing", "invoice.yaml"),
      },
      {
        name: "orders.md",
        path: join("packages", "domains", "orders.md"),
      },
    ]);
  });

  test("loads code project domain file summaries from src domains", async () => {
    const root = await createWorkspace();
    const projectPath = join(root, "projects", "code-demo");
    const created = await createProject(
      {
        name: "Code Demo",
        type: "code",
        state: "work",
        path: projectPath,
      },
      root,
    );
    await mkdir(join(projectPath, "src", "domains", "billing"), { recursive: true });
    await writeFile(join(projectPath, "src", "domains", "orders.ts"), "export const domain = 'orders';\n", "utf8");
    await writeFile(join(projectPath, "src", "domains", "billing", "invoice.ts"), "export const domain = 'invoice';\n", "utf8");

    const detail = await getProjectDetail(created.id, root);

    expect(detail?.sourceFolders).toEqual([
      {
        label: "Domains",
        path: "src/domains",
        symbols: [
          {
            name: "domain",
            kind: "const",
          },
        ],
      },
    ]);
    expect(detail?.domainFiles).toEqual([
      {
        name: "invoice.ts",
        path: join("src", "domains", "billing", "invoice.ts"),
      },
      {
        name: "orders.ts",
        path: join("src", "domains", "orders.ts"),
      },
    ]);
  });

  test("loads code project domain file summaries from configured type roots", async () => {
    const root = await createWorkspace();
    const projectPath = join(root, "projects", "configured-code-demo");
    await mkdir(join(root, "configs"), { recursive: true });
    await writeFile(
      join(root, "configs", "project-link-roots.yaml"),
      ["code:", "  domains: app/domain-files", "  features: app/feature-files"].join("\n"),
      "utf8",
    );
    const created = await createProject(
      {
        name: "Configured Code Demo",
        type: "code",
        state: "work",
        path: projectPath,
      },
      root,
    );
    await mkdir(join(projectPath, "app", "domain-files", "billing"), { recursive: true });
    await writeFile(join(projectPath, "app", "domain-files", "billing", "invoice.ts"), "export const invoice = true;\n", "utf8");

    const detail = await getProjectDetail(created.id, root);

    expect(detail?.sourceFolders).toEqual([
      {
        label: "Domains",
        path: "app/domain-files",
        symbols: [
          {
            name: "invoice",
            kind: "const",
          },
        ],
      },
    ]);
    expect(detail?.domainFiles).toEqual([
      {
        name: "invoice.ts",
        path: join("app", "domain-files", "billing", "invoice.ts"),
      },
    ]);
  });

  test("keeps mono project detail loading when domain files are missing", async () => {
    const root = await createWorkspace();
    const created = await createProject(
      {
        name: "No Domains Demo",
        type: "mono",
        state: "work",
        path: join(root, "projects", "no-domains-demo"),
      },
      root,
    );

    const detail = await getProjectDetail(created.id, root);

    expect(detail?.domainFiles).toEqual([]);
    expect(detail?.sourceFolders).toEqual([
      {
        label: "Feature",
        path: "packages/features",
        symbols: [],
      },
      {
        label: "Domains",
        path: "packages/domains",
        symbols: [],
      },
    ]);
  });

  test("persists project registry crud separately from project detail artifacts", async () => {
    const root = await createWorkspace();
    const projectPath = join(root, "projects", "todo-demo");

    const created = await createProject(
      {
        name: "Todo Demo",
        type: "code",
        state: "init",
        path: projectPath,
      },
      root,
    );

    expect(created).toMatchObject({
      id: "todo-demo",
      name: "Todo Demo",
      type: "code",
      state: "init",
      path: projectPath,
    });
    await expect(readFile(join(root, ".project", "project-list.json"), "utf8")).resolves.toContain("Todo Demo");
    await expect(readFile(join(projectPath, ".project", "project.md"), "utf8")).resolves.toContain("Todo Demo");

    const registry = await listProjectRegistry(root);
    expect(registry).toHaveLength(1);

    const listed = await listProjects(root);
    expect(listed[0]).toMatchObject({
      id: "todo-demo",
      name: "Todo Demo",
      path: projectPath,
      state: "init",
    });

    const updated = await updateProject(
      created.id,
      {
        name: "Todo Demo Updated",
        state: "work",
      },
      root,
    );
    expect(updated?.name).toBe("Todo Demo Updated");
    expect(updated?.state).toBe("work");
    await expect(readFile(join(projectPath, ".project", "project.md"), "utf8")).resolves.toContain("Todo Demo Updated");

    await expect(deleteProject(created.id, root)).resolves.toBe(true);
    await expect(listProjectRegistry(root)).resolves.toEqual([]);
    await expect(readFile(join(projectPath, ".project", "project.md"), "utf8")).resolves.toContain("Todo Demo Updated");
  });

  test("keeps registry project draft history on detail data after completion", async () => {
    const root = await createWorkspace();
    const projectPath = join(root, "projects", "draft-demo");
    const created = await createProject(
      {
        name: "Draft Demo",
        type: "code",
        state: "work",
        path: projectPath,
      },
      root,
    );
    await mkdir(join(projectPath, ".project", "drafts", "basic"), { recursive: true });
    await writeFile(
      join(projectPath, ".project", "drafts", "basic", "basic.md"),
      "---\nsummary: basic\ndraft_items: []\nchecks:\n  automated: []\n  assertions: []\n---\n# Draft Summary\n",
      "utf8",
    );

    await expect(listProjects(root)).resolves.toMatchObject([
      {
        id: created.id,
        draftCount: 1,
      },
    ]);

    await updateProject(created.id, { state: "complete" }, root);

    await expect(listProjects(root)).resolves.toMatchObject([
      {
        id: created.id,
        draftCount: 0,
        updatedLabel: "No active drafts",
      },
    ]);
    const detail = await getProjectDetail(created.id, root);
    expect(detail?.drafts).toHaveLength(1);
    expect(detail?.drafts[0]?.summary).toBe("basic");
  });

  test("loads draft history with request, raw document, and draft item metadata", async () => {
    const workspace = await createWorkspace();
    await mkdir(join(workspace, ".project", "drafts", "history"), { recursive: true });
    await writeFile(
      join(workspace, ".project", "project.md"),
      [
        "# info",
        "## name",
        "demo",
        "## type",
        "code",
        "## description",
        "Demo project",
        "## spec",
        "typescript",
        "## path",
        workspace,
        "## state",
        "work",
      ].join("\n"),
      "utf8",
    );
    const draftDocument = [
      "---",
      "request: Show draft history",
      "summary: history",
      "draft_items:",
      "  - id: draft_data",
      "    file: draft_data.yaml",
      "    description: Load draft metadata",
      "checks:",
      "  automated:",
      "    - bun test test/uiProjectData.test.ts",
      "  assertions:",
      "    - \"draft_data: Load draft metadata\"",
      "---",
      "# Draft Summary",
      "",
    ].join("\n");
    await writeFile(join(workspace, ".project", "drafts", "history", "history.md"), draftDocument, "utf8");

    const detail = await getProjectDetail("demo", workspace);
    expect(detail?.drafts[0]).toMatchObject({
      summary: "history",
      request: "Show draft history",
      document: draftDocument,
      itemCount: 1,
      draftItems: [
        {
          id: "draft_data",
          file: "draft_data.yaml",
          description: "Load draft metadata",
        },
      ],
      automatedChecks: ["bun test test/uiProjectData.test.ts"],
      assertions: ["draft_data: Load draft metadata"],
    });
  });

  test("deletes project files and registry entry when requested", async () => {
    const root = await createWorkspace();
    const projectPath = join(root, "projects", "delete-demo");
    const created = await createProject(
      {
        name: "Delete Demo",
        type: "code",
        state: "init",
        path: projectPath,
      },
      root,
    );

    await expect(deleteProjectFiles(created.id, root)).resolves.toBe(true);
    await expect(listProjectRegistry(root)).resolves.toEqual([]);
    await expect(stat(projectPath)).rejects.toThrow();
  });

  test("marks registry projects with missing files and refuses file deletion", async () => {
    const root = await createWorkspace();
    const projectPath = join(root, "projects", "missing-demo");
    const created = await createProject(
      {
        name: "Missing Demo",
        type: "code",
        state: "init",
        path: projectPath,
      },
      root,
    );
    await rm(projectPath, { recursive: true });

    const listed = await listProjects(root);
    expect(listed[0]).toMatchObject({
      id: created.id,
      availability: "missing",
      draftCount: 0,
      hasJob: false,
    });
    await expect(deleteProjectFiles(created.id, root)).rejects.toThrow("Project folder was not found.");
    await expect(listProjectRegistry(root)).resolves.toHaveLength(1);
  });

  test("uses configured default project path when create input path is empty", async () => {
    const root = await createWorkspace();
    await mkdir(join(root, "configs"), { recursive: true });
    await writeFile(join(root, "configs", "config.yaml"), "defaultProjectPath: configured-projects\n", "utf8");

    const created = await createProject(
      {
        name: "Path Demo",
        type: "code",
        state: "init",
        path: "",
      },
      root,
    );

    expect(created.path).toBe(join(root, "configured-projects", "path-demo"));
    await expect(readFile(join(created.path, ".project", "project.md"), "utf8")).resolves.toContain("Path Demo");
  });
});
