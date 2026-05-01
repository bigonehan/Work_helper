import { describe, expect, test } from "bun:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp } from "node:fs/promises";
import {
  createProject,
  deleteProject,
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

  test("loads detail content for the selected project id", async () => {
    const workspace = await createWorkspace();
    await mkdir(join(workspace, ".project"), { recursive: true });
    await writeFile(
      join(workspace, ".project", "project.md"),
      "# info\n## name\ndemo\n## type\ncode\n## description\nDemo\n## spec\ntypescript\n## path\n/tmp/demo\n## state\ncheck\n",
      "utf8",
    );
    await writeFile(join(workspace, ".project", "job.md"), "# requirement\n## Demo Job\n", "utf8");

    const detail = await getProjectDetail("demo", workspace);
    expect(detail?.project.name).toBe("demo");
    expect(detail?.jobDocument).toContain("Demo Job");
    await expect(getProjectDetail("missing", workspace)).resolves.toBeNull();
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
});
