import Anthropic from "@anthropic-ai/sdk";

export interface DraftSeedInput {
  readonly title: string;
  readonly input: readonly string[];
  readonly output: readonly string[];
  readonly test: readonly string[];
  readonly priority: number;
  readonly kind: "calc" | "ui" | "i/o" | "action";
  readonly target: readonly string[];
  readonly dependsOn?: readonly number[];
}

const SYSTEM_PROMPT = `You are a software engineering task decomposer.
Given a user request, break it down into 1-5 independent or sequential draft tasks.

Rules:
- title: Short English label (snake_case friendly)
- input: What this task receives
- output: What this task produces
- test: Unit test conditions in Korean (for the build agent)
- priority: Integer from 1 (lower = runs first)
- kind: "calc" (pure logic) | "ui" (UI component) | "i/o" (file/API/network) | "action" (side effects: send/delete/create)
- target: File paths to create or modify (e.g. "src/foo.ts", "test/foo.test.ts")
- dependsOn: 0-based indices of other drafts this depends on (omit if none)

Return a JSON array only. No markdown fences, no explanation.`;

const kindValues = new Set(["calc", "ui", "i/o", "action"]);

function isValidKind(value: unknown): value is DraftSeedInput["kind"] {
  return typeof value === "string" && kindValues.has(value);
}

function parseSeeds(raw: string): DraftSeedInput[] | null {
  let text = raw.trim();

  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    text = fenceMatch[1]!.trim();
  }

  try {
    const parsed: unknown = JSON.parse(text);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return null;
    }

    const seeds: DraftSeedInput[] = [];
    for (const item of parsed) {
      if (typeof item !== "object" || item === null) {
        return null;
      }

      const obj = item as Record<string, unknown>;
      if (
        typeof obj["title"] !== "string" ||
        !Array.isArray(obj["input"]) ||
        !Array.isArray(obj["output"]) ||
        !Array.isArray(obj["test"]) ||
        typeof obj["priority"] !== "number" ||
        !isValidKind(obj["kind"]) ||
        !Array.isArray(obj["target"])
      ) {
        return null;
      }

      seeds.push({
        title: obj["title"],
        input: (obj["input"] as unknown[]).filter((v): v is string => typeof v === "string"),
        output: (obj["output"] as unknown[]).filter((v): v is string => typeof v === "string"),
        test: (obj["test"] as unknown[]).filter((v): v is string => typeof v === "string"),
        priority: obj["priority"],
        kind: obj["kind"],
        target: (obj["target"] as unknown[]).filter((v): v is string => typeof v === "string"),
        dependsOn: Array.isArray(obj["dependsOn"])
          ? (obj["dependsOn"] as unknown[]).filter((v): v is number => typeof v === "number")
          : undefined,
      });
    }

    return seeds;
  } catch {
    return null;
  }
}

export const inferDraftSeedsFromLLM = async (request: string): Promise<DraftSeedInput[] | null> => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return null;
  }

  try {
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: request }],
    });

    const text = response.content[0]?.type === "text" ? response.content[0].text : "";
    return parseSeeds(text);
  } catch {
    return null;
  }
};
