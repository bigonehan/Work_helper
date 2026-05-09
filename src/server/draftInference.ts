import { Effect } from "effect";
import { runPromptInTmux } from "../runPromptInTmux";
import type { Provider } from "../types";

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

  const arrayMatch = text.match(/(\[[\s\S]*\])/);
  if (arrayMatch) {
    text = arrayMatch[1]!;
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

const buildDecomposePrompt = (request: string): string =>
  [
    "Decompose the following software request into 1-5 draft tasks.",
    "Return ONLY a raw JSON array. No markdown, no explanation.",
    "",
    "Each item must have these exact fields:",
    '  title: string  (short English label, snake_case friendly)',
    '  input: string[]  (what this task receives)',
    '  output: string[]  (what this task produces)',
    '  test: string[]  (Korean unit test conditions for the build agent)',
    '  priority: number  (1 = runs first)',
    '  kind: "calc" | "ui" | "i/o" | "action"',
    '  target: string[]  (file paths to create or modify)',
    '  dependsOn: number[]  (0-based indices of prerequisite tasks; omit if none)',
    "",
    `Request: ${request}`,
  ].join("\n");

export const inferDraftSeedsFromProvider = async (
  request: string,
  provider: Provider,
  workspaceDir: string,
): Promise<DraftSeedInput[] | null> => {
  try {
    const result = await Effect.runPromise(
      runPromptInTmux({
        provider,
        msg: buildDecomposePrompt(request),
        workspaceDir,
        totalTimeoutMs: 90_000,
        firstOutputTimeoutMs: 20_000,
        responseTimeoutMs: 60_000,
        stableAnswerWindowMs: 4_000,
        answerValidator: (answer) => (parseSeeds(answer) ? null : "Response is not a valid JSON array of draft seeds"),
      }),
    );

    if (!result.ok || !result.answer) {
      return null;
    }

    return parseSeeds(result.answer);
  } catch {
    return null;
  }
};
