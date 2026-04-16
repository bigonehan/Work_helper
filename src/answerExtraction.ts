import { classifyAuthHints } from "./providers";
import type { Provider, RunPromptStage } from "./types";

export const parseMarker = (pane: string, marker: string): { exitCode: number | null; markerSeen: boolean } => {
  const match = pane.match(new RegExp(`${marker}:(\\d+)`));
  if (!match) {
    return { exitCode: null, markerSeen: false };
  }

  return { exitCode: Number(match[1]), markerSeen: true };
};

export const normalizePane = (pane: string, marker: string): string =>
  pane
    .replace(new RegExp(`\\n?${marker}:\\d+\\n?`, "g"), "\n")
    .replace(/\r/g, "")
    .trim();

const stripInitNoise = (text: string): string =>
  text
    .split("\n")
    .filter((line) => !/^YOLO mode is enabled/i.test(line.trim()))
    .filter((line) => !/^Keychain initialization encountered/i.test(line.trim()))
    .filter((line) => !/^Using FileKeychain fallback/i.test(line.trim()))
    .filter((line) => !/^Loaded cached credentials/i.test(line.trim()))
    .join("\n")
    .trim();

const stripGeminiToolNoise = (text: string): string =>
  text
    .split("\n")
    .filter((line) => !/^Error executing tool\b/i.test(line.trim()))
    .filter((line) => !/Path not in workspace/i.test(line.trim()))
    .filter((line) => !/allowed workspace directories/i.test(line.trim()))
    .filter((line) => !/\.gemini\/AGENTS\.md/i.test(line.trim()))
    .join("\n")
    .trim();

const looksLikePromptEcho = (line: string, prompt: string): boolean => line.trim() === prompt.trim();

const isSimpleStandaloneAnswer = (line: string): boolean => /^[+-]?\d+(?:\.\d+)?$/.test(line.trim());

const isToolNoiseLine = (line: string): boolean =>
  /^Error executing tool\b/i.test(line.trim()) ||
  /Path not in workspace/i.test(line.trim()) ||
  /allowed workspace directories/i.test(line.trim()) ||
  /\.gemini\/AGENTS\.md/i.test(line.trim()) ||
  /@google\/gemini-cli-core/i.test(line.trim()) ||
  /resolves outside the allowed workspace/i.test(line.trim());

const extractCodexAnswer = (text: string, prompt: string): string | null => {
  const withoutFooter = text.replace(/\ntokens used[\s\S]*$/i, "").trim();
  if (!withoutFooter) {
    return null;
  }

  const directMatch = withoutFooter.match(/\n(?:assistant|codex)\n([\s\S]+)$/i);
  if (directMatch?.[1]?.trim()) {
    return directMatch[1].trim();
  }

  const cleaned = withoutFooter
    .split("\n")
    .filter((line) => !/^OpenAI Codex\b/i.test(line.trim()))
    .filter((line) => !/^[-]{4,}$/.test(line.trim()))
    .filter(
      (line) =>
        !/^(workdir|model|provider|approval|sandbox|reasoning effort|reasoning summaries|session id):/i.test(
          line.trim(),
        ),
    )
    .filter((line) => line.trim() !== "user")
    .join("\n")
    .trim();

  if (!cleaned) {
    return null;
  }

  const cleanedLines = cleaned
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => !looksLikePromptEcho(line, prompt));

  const withoutPromptEcho = cleanedLines.join("\n").trim();
  if (withoutPromptEcho) {
    return withoutPromptEcho;
  }

  return cleaned;
};

const extractGeminiAnswer = (text: string): string | null => {
  const cleaned = stripInitNoise(text);
  const lines = cleaned
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const simpleAnswer = [...lines].reverse().find(isSimpleStandaloneAnswer);
  if (simpleAnswer) {
    return simpleAnswer;
  }

  const filteredLines: string[] = [];
  let skippingToolNoise = false;

  for (const line of lines) {
    if (isToolNoiseLine(line)) {
      skippingToolNoise = true;
      continue;
    }

    if (skippingToolNoise) {
      if (isSimpleStandaloneAnswer(line) || (!isToolNoiseLine(line) && !line.includes("/") && !line.includes(".md"))) {
        skippingToolNoise = false;
      } else {
        continue;
      }
    }

    filteredLines.push(line);
  }

  const filtered = stripGeminiToolNoise(filteredLines.join("\n").trim());
  return filtered || null;
};

export const extractAnswer = (
  provider: Provider,
  prompt: string,
  pane: string,
  marker: string,
): string | null => {
  const normalized = normalizePane(pane, marker);
  if (!normalized) {
    return null;
  }

  return provider === "codex" ? extractCodexAnswer(normalized, prompt) : extractGeminiAnswer(normalized);
};

export const classifyFailure = (
  paneSnapshot: string,
  stage: RunPromptStage,
  markerSeen: boolean,
  sessionAlive: boolean,
): { stage: RunPromptStage; reason: string } => {
  const authHints = classifyAuthHints(paneSnapshot);

  if (!sessionAlive && !paneSnapshot.trim()) {
    return {
      stage: "provider_process_not_started",
      reason: "The tmux target exited before any provider output was captured.",
    };
  }

  if (stage === "waiting_for_first_output" && authHints.length > 0) {
    return {
      stage: "provider_auth_or_init_blocked",
      reason: "The provider emitted initialization/authentication logs but no answer.",
    };
  }

  if (stage === "waiting_for_final_answer" && authHints.length > 0 && !markerSeen) {
    return {
      stage: "provider_auth_or_init_blocked",
      reason: "The provider appears stuck during authentication or initialization after emitting setup logs.",
    };
  }

  if (stage === "waiting_for_first_output") {
    return {
      stage: markerSeen ? "provider_exited_without_answer" : "provider_started_no_output",
      reason: markerSeen
        ? "The provider process exited before producing a usable answer."
        : "The provider process started but did not produce visible output in time.",
    };
  }

  if (stage === "waiting_for_final_answer") {
    return {
      stage: markerSeen ? "provider_exited_without_answer" : "provider_output_started_no_final_answer",
      reason: markerSeen
        ? "The provider process exited after output began but before a final answer was extracted."
        : "The provider produced output, but no final answer was detected before the deadline.",
    };
  }

  return {
    stage: "timeout",
    reason: "The call exceeded the configured timeout.",
  };
};
