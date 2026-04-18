import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { buildProviderCommand } from "../src/providers";
import { runPromptInTmux } from "../src/runPromptInTmux";
import { createContainsAnyValidator } from "../src/validators";

describe("buildProviderCommand", () => {
  test("escapes single quotes safely", () => {
    const command = buildProviderCommand("codex", "it's 1+1", "/tmp/demo", "__MARK__");
    expect(command.argv).toHaveLength(3);
    expect(command.argv[0]).toBe("bash");
    expect(command.argv[1]).toBe("-lc");
    expect(command.argv[2]).toContain("'\\''");
  });
});

describe("runPromptInTmux", () => {
  test("returns 2 from codex for 1+1", async () => {
    const result = await Effect.runPromise(
      runPromptInTmux({
        provider: "codex",
        msg: "Reply with only the answer to: 1+1",
        workspaceDir: process.cwd(),
        totalTimeoutMs: 120_000,
        firstOutputTimeoutMs: 15_000,
        responseTimeoutMs: 90_000,
      }),
    );

    expect(result.ok).toBe(true);
    expect(result.answer).toBe("2");
    expect(result.stage).toBe("completed");
  }, 130_000);

  test("fails validation when expected keywords are missing", async () => {
    const result = await Effect.runPromise(
      runPromptInTmux({
        provider: "codex",
        msg: "Reply with only the answer to: 1+1",
        workspaceDir: process.cwd(),
        answerValidator: createContainsAnyValidator(["해운대", "감천문화마을"]),
      }),
    );

    expect(result.ok).toBe(false);
    expect(result.stage).toBe("answer_validation_failed");
    expect(result.diagnostics.reason).toContain("expected keyword");
  }, 130_000);
});
