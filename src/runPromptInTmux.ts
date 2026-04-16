import { Effect } from "effect";
import { classifyFailure, extractAnswer, parseMarker } from "./answerExtraction";
import { capturePane, createDetachedSession, killSession, sessionExists } from "./tmux";
import { buildProviderCommand, classifyAuthHints } from "./providers";
import type { RunPromptOptions, RunPromptResult, RunPromptStage } from "./types";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const makeSessionName = (prefix: string, provider: string) =>
  `${prefix}-${provider}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const defaultOptions = {
  totalTimeoutMs: 120_000,
  startupTimeoutMs: 4_000,
  firstOutputTimeoutMs: 12_000,
  responseTimeoutMs: 90_000,
  pollIntervalMs: 1_000,
  stableAnswerWindowMs: 3_000,
  sessionNamePrefix: "work-helper",
  preserveSessionOnFailure: false,
} as const;

interface MutableTimings {
  startedAt: number;
  firstOutputAt: number | null;
  finalAnswerAt: number | null;
  exitedAt: number | null;
}

interface ResolvedRunPromptOptions {
  provider: RunPromptOptions["provider"];
  msg: string;
  workspaceDir: string;
  totalTimeoutMs: number;
  startupTimeoutMs: number;
  firstOutputTimeoutMs: number;
  responseTimeoutMs: number;
  pollIntervalMs: number;
  stableAnswerWindowMs: number;
  sessionNamePrefix: string;
  preserveSessionOnFailure: boolean;
  answerValidator?: RunPromptOptions["answerValidator"];
}

const buildResult = (
  options: ResolvedRunPromptOptions,
  sessionName: string,
  stage: RunPromptStage,
  paneSnapshot: string,
  timings: MutableTimings,
  exitCode: number | null,
  markerSeen: boolean,
  answer: string | null,
  commandPreview: string,
  reason: string,
): RunPromptResult => ({
  ok: stage === "completed",
  provider: options.provider,
  sessionName,
  answer,
  exitCode,
  stage,
  timings,
  diagnostics: {
    classification: stage,
    reason,
    paneSnapshot,
    markerSeen,
    authHints: classifyAuthHints(paneSnapshot),
    commandPreview,
  },
});

export const runPromptInTmux = (input: RunPromptOptions) =>
  Effect.promise(async () => {
    const options: ResolvedRunPromptOptions = { ...defaultOptions, ...input };
    const sessionName = makeSessionName(options.sessionNamePrefix, options.provider);
    const marker = `__WORK_HELPER_EXIT__${sessionName}`;
    const providerCommand = buildProviderCommand(
      options.provider,
      options.msg,
      options.workspaceDir,
      marker,
    );
    const startedAt = Date.now();
    const timings: MutableTimings = {
      startedAt,
      firstOutputAt: null,
      finalAnswerAt: null,
      exitedAt: null,
    };

    let paneSnapshot = "";
    let answer: string | null = null;
    let exitCode: number | null = null;
    let markerSeen = false;
    let stage: RunPromptStage = "starting";
    let lastPaneSnapshot = "";
    let lastPaneChangeAt = startedAt;

    const created = await createDetachedSession(sessionName, providerCommand.command);
    if (created.exitCode !== 0) {
      return buildResult(
        options,
        sessionName,
        "tmux_start_failed",
        created.stderr || created.stdout,
        timings,
        null,
        false,
        null,
        providerCommand.commandPreview,
        created.stderr.trim() || "tmux new-session failed.",
      );
    }

    const startedDeadline = startedAt + options.totalTimeoutMs;
    const firstOutputDeadline = startedAt + options.firstOutputTimeoutMs;
    const responseDeadline = startedAt + options.responseTimeoutMs;

    try {
      while (Date.now() < startedDeadline) {
        const alive = await sessionExists(sessionName);
        paneSnapshot = alive ? await capturePane(sessionName) : paneSnapshot;
        if (paneSnapshot !== lastPaneSnapshot) {
          lastPaneSnapshot = paneSnapshot;
          lastPaneChangeAt = Date.now();
        }
        const trimmed = paneSnapshot.trim();
        const parsed = parseMarker(paneSnapshot, marker);
        markerSeen = parsed.markerSeen;
        exitCode = parsed.exitCode;

        if (trimmed && timings.firstOutputAt === null) {
          timings.firstOutputAt = Date.now();
          stage = "waiting_for_final_answer";
        } else if (!trimmed) {
          stage = "waiting_for_first_output";
        }

        answer = extractAnswer(options.provider, options.msg, paneSnapshot, marker);
        if (answer) {
          const validationError = options.answerValidator?.(answer) ?? null;
          if (validationError) {
            if (markerSeen) {
              timings.finalAnswerAt = Date.now();
              timings.exitedAt = timings.finalAnswerAt;
              return buildResult(
                options,
                sessionName,
                "answer_validation_failed",
                paneSnapshot,
                timings,
                exitCode,
                markerSeen,
                answer,
                providerCommand.commandPreview,
                validationError,
              );
            }
          } else if (
            markerSeen ||
            (options.answerValidator && Date.now() - lastPaneChangeAt >= options.stableAnswerWindowMs)
          ) {
            timings.finalAnswerAt = Date.now();
            timings.exitedAt = markerSeen ? timings.finalAnswerAt : null;
            return buildResult(
              options,
              sessionName,
              "completed",
              paneSnapshot,
              timings,
              exitCode,
              markerSeen,
              answer,
              providerCommand.commandPreview,
              markerSeen
                ? "The provider returned a final answer."
                : "A valid answer was captured and remained stable before provider exit.",
            );
          }
        }

        if (!alive) {
          timings.exitedAt = Date.now();
          const failure = classifyFailure(paneSnapshot, stage, markerSeen, alive);
          return buildResult(
            options,
            sessionName,
            failure.stage,
            paneSnapshot,
            timings,
            exitCode,
            markerSeen,
            answer,
            providerCommand.commandPreview,
            failure.reason,
          );
        }

        if (timings.firstOutputAt === null && Date.now() > firstOutputDeadline) {
          const failure = classifyFailure(paneSnapshot, "waiting_for_first_output", markerSeen, alive);
          return buildResult(
            options,
            sessionName,
            failure.stage,
            paneSnapshot,
            timings,
            exitCode,
            markerSeen,
            answer,
            providerCommand.commandPreview,
            failure.reason,
          );
        }

        if (timings.firstOutputAt !== null && Date.now() > responseDeadline) {
          const failure = classifyFailure(paneSnapshot, "waiting_for_final_answer", markerSeen, alive);
          return buildResult(
            options,
            sessionName,
            failure.stage,
            paneSnapshot,
            timings,
            exitCode,
            markerSeen,
            answer,
            providerCommand.commandPreview,
            failure.reason,
          );
        }

        await sleep(options.pollIntervalMs);
      }

      return buildResult(
        options,
        sessionName,
        "timeout",
        paneSnapshot,
        timings,
        exitCode,
        markerSeen,
        answer,
        providerCommand.commandPreview,
        "The call exceeded the total timeout.",
      );
    } finally {
      if (!options.preserveSessionOnFailure) {
        await killSession(sessionName);
      }
    }
  });
