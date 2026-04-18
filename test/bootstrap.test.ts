import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildBootstrapPrompt,
  createBootstrapVerifier,
  readProjectBootstrapMetadata,
} from "../src/bootstrap";
import { createProjectMetadataDocument } from "../src/server/project";

describe("bootstrap", () => {
  test("reads bootstrap metadata from .project/project.md", async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), "work-helper-bootstrap-"));
    const projectDir = join(workspaceDir, ".project");
    const projectFilePath = join(projectDir, "project.md");
    await mkdir(projectDir, { recursive: true });
    await writeFile(
      projectFilePath,
      createProjectMetadataDocument({
        name: "demo-project",
        type: "code",
        description: "bootstrap demo",
        spec: "rust",
        path: workspaceDir,
        state: "init",
      }),
      "utf8",
    );

    const metadata = await readProjectBootstrapMetadata(workspaceDir);

    expect(metadata.type).toBe("code");
    expect(metadata.spec).toBe("rust");
    expect(metadata.path).toBe(workspaceDir);
  });

  test("builds bootstrap prompt using the prompt file and project spec", async () => {
    const prompt = await buildBootstrapPrompt({
      workspaceDir: "/tmp/demo",
      projectType: "code",
      projectSpec: "python",
    });

    expect(prompt).toContain("python");
    expect(prompt).toContain("/tmp/demo");
    expect(prompt).toContain("hello world");
  });

  test("creates language-specific verifiers for bootstrap output", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "work-helper-bootstrap-verify-"));

    const pythonDir = join(baseDir, "python");
    await mkdir(pythonDir, { recursive: true });
    await writeFile(join(pythonDir, "main.py"), 'print("Hello, world!")\n', "utf8");
    await expect(createBootstrapVerifier("python")(pythonDir)).resolves.toEqual({
      ok: true,
      summary: expect.stringContaining("python"),
    });

    const rustDir = join(baseDir, "rust");
    await mkdir(join(rustDir, "src"), { recursive: true });
    await writeFile(join(rustDir, "Cargo.toml"), "[package]\nname = \"demo\"\nversion = \"0.1.0\"\n", "utf8");
    await writeFile(join(rustDir, "src", "main.rs"), 'fn main() { println!("Hello, world!"); }\n', "utf8");
    await expect(createBootstrapVerifier("rust")(rustDir)).resolves.toEqual({
      ok: true,
      summary: expect.stringContaining("rust"),
    });

    const typescriptDir = join(baseDir, "typescript");
    await mkdir(typescriptDir, { recursive: true });
    await writeFile(join(typescriptDir, "package.json"), '{ "name": "demo" }\n', "utf8");
    await writeFile(join(typescriptDir, "main.ts"), 'console.log("Hello, world!");\n', "utf8");
    await expect(createBootstrapVerifier("typescript")(typescriptDir)).resolves.toEqual({
      ok: true,
      summary: expect.stringContaining("typescript"),
    });
  });
});
