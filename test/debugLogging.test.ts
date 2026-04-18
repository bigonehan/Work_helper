import { describe, expect, test } from "bun:test";
import { formatTmuxDebugPayload, logTmuxPromptDispatch } from "../src/debugLogging";

describe("debugLogging", () => {
  test("formats dispatch payload with prompt details", () => {
    const formatted = formatTmuxDebugPayload({
      scope: "runPromptInTmux.dispatch",
      target: "demo-session",
      provider: "codex",
      workspaceDir: "/tmp/demo",
      prompt: "hello",
    });

    expect(formatted).toContain("[tmux-debug] runPromptInTmux.dispatch");
    expect(formatted).toContain('prompt="hello"');
    expect(formatted).toContain("target=demo-session");
  });

  test("disabled logging returns without error", async () => {
    await expect(
      logTmuxPromptDispatch(false, {
        scope: "runPromptInTmux.dispatch",
        target: "demo-session",
        provider: "codex",
        workspaceDir: "/tmp/demo",
        prompt: "hello",
      }),
    ).resolves.toBeUndefined();
  });
});
