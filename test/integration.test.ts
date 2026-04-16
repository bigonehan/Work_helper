import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { runPromptInTmux } from "../src/runPromptInTmux";

const runWithRetries = async <T>(attempts: number, fn: () => Promise<T>): Promise<T> => {
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError;
};

describe("integration", () => {
  test("codex returns 2", async () => {
    const result = await Effect.runPromise(
      runPromptInTmux({
        provider: "codex",
        msg: "Reply with only the answer to: 1+1",
        workspaceDir: process.cwd(),
      }),
    );

    expect(result.ok).toBe(true);
    expect(result.answer).toBe("2");
  }, 130_000);

  test("gemini returns 2", async () => {
    const result = await runWithRetries(3, async () => {
      const attempt = await Effect.runPromise(
        runPromptInTmux({
          provider: "gemini",
          msg: "Reply with only the answer to: 1+1",
          workspaceDir: process.cwd(),
          totalTimeoutMs: 120_000,
          firstOutputTimeoutMs: 20_000,
          responseTimeoutMs: 100_000,
        }),
      );

      if (!attempt.ok || attempt.answer !== "2") {
        throw new Error(JSON.stringify(attempt));
      }

      return attempt;
    });

    expect(result.ok).toBe(true);
    expect(result.answer).toBe("2");
  }, 130_000);
});
