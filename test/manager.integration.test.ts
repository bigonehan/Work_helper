import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, stat, symlink } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { createReactTodoAppVerifier, handleManagerRequest } from "../src/manager";

const tempDir = join(homedir(), "temp");

const withCwd = async <T>(dir: string, run: () => Promise<T>): Promise<T> => {
  const previous = process.cwd();
  process.chdir(dir);
  try {
    return await run();
  } finally {
    process.chdir(previous);
  }
};

const prepareArtifactRoot = async (dir: string): Promise<void> => {
  const repoRoot = process.cwd();
  await symlink(join(repoRoot, "assets"), join(dir, "assets"), "dir");
  await symlink(join(repoRoot, "AGENTS.md"), join(dir, "AGENTS.md"));
};

describe("manager integration", () => {
  test("creates a React todo app in ~/temp through tmux-managed codex execution", async () => {
    await rm(tempDir, { recursive: true, force: true });
    const artifactRoot = await mkdtemp(join(homedir(), "work-helper-manager-integration-"));
    await prepareArtifactRoot(artifactRoot);

    const result = await withCwd(artifactRoot, () =>
      handleManagerRequest({
        projectId: `react-todo-${Date.now().toString(36)}`,
        projectType: "code",
        request:
          "Create a minimal React todo app directly in ~/temp. Put the app root at ~/temp and create package.json, index.html, vite.config.js, src/main.jsx, src/App.jsx, and src/styles.css. Add a simple todo UI. Do not install dependencies or run the dev server. Reply with only COMPLETED.",
        targetDir: tempDir,
        provider: "codex",
        maxAttempts: 3,
        totalTimeoutMs: 300_000,
        firstOutputTimeoutMs: 20_000,
        responseTimeoutMs: 240_000,
        verifyCompletion: createReactTodoAppVerifier(tempDir),
      }),
    );

    expect(result.ok).toBe(true);
    expect(result.decision).toBe("complete");
    expect(result.finalAnswer).toContain("COMPLETED");
    await expect(stat(join(tempDir, "package.json"))).resolves.toBeDefined();
    await expect(stat(join(tempDir, "src"))).resolves.toBeDefined();
  }, 620_000);
});
