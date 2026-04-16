export type Provider = "codex" | "gemini";

export type RunPromptStage =
  | "starting"
  | "waiting_for_first_output"
  | "waiting_for_final_answer"
  | "completed"
  | "answer_validation_failed"
  | "tmux_start_failed"
  | "provider_process_not_started"
  | "provider_started_no_output"
  | "provider_output_started_no_final_answer"
  | "provider_exited_without_answer"
  | "provider_auth_or_init_blocked"
  | "timeout";

export interface RunPromptOptions {
  readonly provider: Provider;
  readonly msg: string;
  readonly workspaceDir: string;
  readonly totalTimeoutMs?: number;
  readonly startupTimeoutMs?: number;
  readonly firstOutputTimeoutMs?: number;
  readonly responseTimeoutMs?: number;
  readonly pollIntervalMs?: number;
  readonly stableAnswerWindowMs?: number;
  readonly sessionNamePrefix?: string;
  readonly preserveSessionOnFailure?: boolean;
  readonly answerValidator?: ((answer: string) => string | null) | undefined;
}

export interface RunPromptTimings {
  readonly startedAt: number;
  readonly firstOutputAt: number | null;
  readonly finalAnswerAt: number | null;
  readonly exitedAt: number | null;
}

export interface RunPromptDiagnostics {
  readonly classification: RunPromptStage;
  readonly reason: string;
  readonly paneSnapshot: string;
  readonly markerSeen: boolean;
  readonly authHints: readonly string[];
  readonly commandPreview: string;
}

export interface RunPromptResult {
  readonly ok: boolean;
  readonly provider: Provider;
  readonly sessionName: string;
  readonly answer: string | null;
  readonly exitCode: number | null;
  readonly stage: RunPromptStage;
  readonly timings: RunPromptTimings;
  readonly diagnostics: RunPromptDiagnostics;
}

export type ProjectTaskStatus = "queued" | "waiting" | "running" | "completed" | "failed";

export interface ProjectTmuxTaskOptions {
  readonly projectId: string;
  readonly taskId: string;
  readonly provider: Provider;
  readonly prompt: string;
  readonly workspaceDir: string;
  readonly totalTimeoutMs?: number;
  readonly firstOutputTimeoutMs?: number;
  readonly responseTimeoutMs?: number;
  readonly pollIntervalMs?: number;
  readonly stableAnswerWindowMs?: number;
  readonly preserveWindowOnFailure?: boolean;
  readonly answerValidator?: ((answer: string) => string | null) | undefined;
}

export interface ProjectTaskHandle {
  readonly projectId: string;
  readonly taskId: string;
  readonly sessionName: string;
  readonly windowName: string;
  readonly windowTarget: string;
  readonly startedAt: number;
}

export interface ProjectTaskSnapshot {
  readonly projectId: string;
  readonly taskId: string;
  readonly provider: Provider;
  readonly workspaceDir: string;
  readonly sessionName: string;
  readonly windowName: string;
  readonly windowTarget: string;
  readonly status: ProjectTaskStatus;
  readonly stage: RunPromptStage;
  readonly currentAction: string;
  readonly lastObservation: string;
  readonly answerPreview: string | null;
  readonly panePreview: string;
  readonly markerSeen: boolean;
  readonly exitCode: number | null;
  readonly startedAt: number;
  readonly updatedAt: number;
  readonly firstOutputAt: number | null;
  readonly finalAnswerAt: number | null;
  readonly completedAt: number | null;
  readonly stalledForMs: number;
  readonly errorReason: string | null;
  readonly validationError: string | null;
}

export type ProjectTaskListItem = ProjectTaskSnapshot;
