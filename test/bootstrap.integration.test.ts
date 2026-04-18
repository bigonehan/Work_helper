import { describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { bootstrapProject, createBootstrapVerifier } from "../src/bootstrap";
import { buildProjectMetadataPath, createProjectMetadataDocument } from "../src/server/project";

const tempDir = join(homedir(), "temp");
const specs = ["rust", "typescript", "python"] as const;

describe("bootstrap integration", () => {
  test(
    "creates hello world projects in ~/temp based on project.md spec",
    async () => {
      await rm(tempDir, { recursive: true, force: true });
      await mkdir(tempDir, { recursive: true });

      for (const spec of specs) {
        const workspaceDir = join(tempDir, spec);
        await mkdir(join(workspaceDir, ".project"), { recursive: true });

        await writeFile(
          buildProjectMetadataPath(workspaceDir),
          createProjectMetadataDocument({
            name: `${spec}-bootstrap`,
            type: "code",
            description: `${spec} hello world bootstrap`,
            spec,
            path: workspaceDir,
            state: "init",
          }),
          "utf8",
        );

        const snapshot = await bootstrapProject({
          projectId: `bootstrap-${spec}-${Date.now().toString(36)}`,
          workspaceDir,
          provider: "codex",
          totalTimeoutMs: 240_000,
          firstOutputTimeoutMs: 20_000,
          responseTimeoutMs: 180_000,
        });

        expect(snapshot.status).toBe("completed");
        expect(snapshot.answerPreview ?? "").toContain("COMPLETED");
        await expect(createBootstrapVerifier(spec)(workspaceDir)).resolves.toEqual({
          ok: true,
          summary: expect.stringContaining(spec),
        });
      }
    },
    900_000,
  );
});
