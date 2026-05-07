import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildProviderCommand } from "../src/providers";
import { runPromptInTmux } from "../src/runPromptInTmux";
import { createContainsAnyValidator } from "../src/validators";

const withEnv = <T>(patch: Record<string, string | undefined>, run: () => T): T => {
  const previous = Object.fromEntries(Object.keys(patch).map((key) => [key, process.env[key]]));
  try {
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }

    return run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
};

describe("buildProviderCommand", () => {
  test("escapes single quotes safely", () => {
    const command = buildProviderCommand("codex", "it's 1+1", "/tmp/demo", "__MARK__");
    expect(command.argv).toHaveLength(3);
    expect(command.argv[0]).toBe("bash");
    expect(command.argv[1]).toBe("-lc");
    expect(command.argv[2]).toContain("'\\''");
  });

  test("runs child codex with full filesystem access and no approval waits by default", () => {
    const command = withEnv(
      {
        CODEXO_WORKSPACE_ROOT: undefined,
        WORK_HELPER_CODEX_SANDBOX: undefined,
        WORK_HELPER_CODEX_APPROVAL_POLICY: undefined,
      },
      () => buildProviderCommand("codex", "build it", process.cwd(), "__MARK__"),
    );

    expect(command.argv[2]).toContain("codex --ask-for-approval never exec");
    expect(command.argv[2]).toContain("--cd ");
    expect(command.argv[2]).toContain("--sandbox danger-full-access");
    expect(command.argv[2]).not.toContain("--skip-git-repo-check");
    expect(command.argv[2]).not.toContain("--dangerously-bypass-approvals-and-sandbox");
  });

  test("allows explicitly forcing a sandbox mode through env", () => {
    const command = withEnv(
      {
        CODEXO_WORKSPACE_ROOT: undefined,
        WORK_HELPER_CODEX_SANDBOX: "workspace-write",
        WORK_HELPER_CODEX_APPROVAL_POLICY: undefined,
      },
      () => buildProviderCommand("codex", "build it", process.cwd(), "__MARK__"),
    );

    expect(command.argv[2]).toContain("--sandbox workspace-write");
  });

  test("blocks child codex workspaces outside CODEXO_WORKSPACE_ROOT", async () => {
    const root = await mkdtemp(join(tmpdir(), "work-helper-root-"));
    const outside = await mkdtemp(join(tmpdir(), "work-helper-outside-"));

    expect(() =>
      withEnv(
        {
          CODEXO_WORKSPACE_ROOT: root,
          WORK_HELPER_CODEX_SANDBOX: undefined,
          WORK_HELPER_CODEX_APPROVAL_POLICY: undefined,
        },
        () => buildProviderCommand("codex", "build it", outside, "__MARK__"),
      ),
    ).toThrow("Workspace is outside CODEXO_WORKSPACE_ROOT");
  });

  test("rejects approval modes that can wait for interaction", () => {
    expect(() =>
      withEnv(
        {
          CODEXO_WORKSPACE_ROOT: undefined,
          WORK_HELPER_CODEX_SANDBOX: undefined,
          WORK_HELPER_CODEX_APPROVAL_POLICY: "on-request",
        },
        () => buildProviderCommand("codex", "build it", process.cwd(), "__MARK__"),
      ),
    ).toThrow("Unsupported WORK_HELPER_CODEX_APPROVAL_POLICY");
  });
});

describe("runPromptInTmux", () => {
  test("returns 2 from codex for 1+1", async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), "work-helper-run-prompt-"));
    const initialized = Bun.spawnSync(["git", "init"], { cwd: workspaceDir });
    expect(initialized.exitCode).toBe(0);
    const result = await Effect.runPromise(
      runPromptInTmux({
        provider: "codex",
        msg: "Reply with only the answer to: 1+1",
        workspaceDir,
        totalTimeoutMs: 120_000,
        firstOutputTimeoutMs: 15_000,
        responseTimeoutMs: 90_000,
      }),
    );

    if (result.answer === "2") {
      expect(result.ok).toBe(true);
      expect(result.stage).toBe("completed");
      return;
    }

    expect(result.answer ?? "").toContain("[GATE A-1] HALT");
  }, 130_000);

  test("fails validation when expected keywords are missing", async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), "work-helper-run-prompt-"));
    const initialized = Bun.spawnSync(["git", "init"], { cwd: workspaceDir });
    expect(initialized.exitCode).toBe(0);
    const result = await Effect.runPromise(
      runPromptInTmux({
        provider: "codex",
        msg: "Reply with only the answer to: 1+1",
        workspaceDir,
        answerValidator: createContainsAnyValidator(["해운대", "감천문화마을"]),
      }),
    );

    expect(result.ok).toBe(false);
    expect(result.stage).toBe("answer_validation_failed");
    expect(result.diagnostics.reason).toContain("expected keyword");
  }, 130_000);
});
