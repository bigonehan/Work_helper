import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { composePrompt, loadPromptTemplate, resolvePrompt } from "../src/prompts";

describe("prompts", () => {
  test("loads a prompt template from file", async () => {
    const template = await loadPromptTemplate(
      join(process.cwd(), "assets", "basic", "prompts", "basic.md"),
    );

    expect(template.trim()).toBe("작업이 끝나면 nf를 쓰지말것");
  });

  test("composes a prompt template and message", () => {
    expect(composePrompt("Template instruction", "Actual msg")).toBe("Template instruction\n\nActual msg");
  });

  test("resolves the original message when prompt file path is omitted", async () => {
    await expect(resolvePrompt("hello")).resolves.toBe("hello");
  });

  test("resolves a composed prompt when prompt file path is provided", async () => {
    const prompt = await resolvePrompt(
      "새 작업 메시지",
      join(process.cwd(), "assets", "basic", "prompts", "basic.md"),
    );

    expect(prompt).toBe("작업이 끝나면 nf를 쓰지말것\n\n새 작업 메시지");
  });
});
