import { Effect, LogLevel, Logger } from "effect";

interface TmuxDebugPayload {
  readonly scope: string;
  readonly target: string;
  readonly provider: string;
  readonly workspaceDir: string;
  readonly prompt: string;
  readonly answer?: string | null;
  readonly status?: string;
  readonly stage?: string;
  readonly reason?: string | null;
}

export const formatTmuxDebugPayload = (payload: TmuxDebugPayload): string =>
  [
    `[tmux-debug] ${payload.scope}`,
    `target=${payload.target}`,
    `provider=${payload.provider}`,
    `workspaceDir=${payload.workspaceDir}`,
    payload.status ? `status=${payload.status}` : null,
    payload.stage ? `stage=${payload.stage}` : null,
    payload.reason ? `reason=${payload.reason}` : null,
    `prompt=${JSON.stringify(payload.prompt)}`,
    payload.answer !== undefined ? `answer=${JSON.stringify(payload.answer)}` : null,
  ]
    .filter(Boolean)
    .join(" ");

const debugEffect = (payload: TmuxDebugPayload) =>
  Effect.logDebug(formatTmuxDebugPayload(payload)).pipe(
    Logger.withMinimumLogLevel(LogLevel.Debug),
  );

export const logTmuxPromptDispatch = async (
  enabled: boolean | undefined,
  payload: TmuxDebugPayload,
): Promise<void> => {
  if (!enabled) {
    return;
  }

  await Effect.runPromise(debugEffect(payload));
};

export const logTmuxPromptCompletion = async (
  enabled: boolean | undefined,
  payload: TmuxDebugPayload,
): Promise<void> => {
  if (!enabled) {
    return;
  }

  await Effect.runPromise(debugEffect(payload));
};
