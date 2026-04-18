import type { Layer } from "effect";

export type Provider = "codex" | "gemini";
export type ProjectType = "code" | "mono";
export type ProjectSpec = "typescript" | "python" | "rust";

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
  readonly promptFilePath?: string;
  readonly debugLogging?: boolean;
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
  readonly promptFilePath?: string;
  readonly debugLogging?: boolean;
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

export type ManagerDecision = "complete" | "retry" | "halt";

export interface ManagerVerificationResult {
  readonly ok: boolean;
  readonly summary: string;
}

export interface ProjectArtifactContext {
  readonly projectId: string;
  readonly projectType: ProjectType;
  readonly projectSpec: ProjectSpec;
  readonly request: string;
  readonly workspaceDir: string;
  readonly timestamp: string;
  readonly summary: string;
}

export interface ProjectArtifactService {
  readonly projectType: ProjectType;
  readonly renderProjectDocument: (context: ProjectArtifactContext) => Promise<string> | string;
  readonly readProjectDocument: (projectFilePath: string) => Promise<string> | string;
  readonly renderJobDocument: (context: ProjectArtifactContext) => Promise<string> | string;
  readonly renderDraftDocument: (context: ProjectArtifactContext) => Promise<string> | string;
  readonly readJobDocument: (jobFilePath: string) => Promise<string> | string;
  readonly runBuildStage: (logger: (message: string) => void) => readonly string[];
  readonly runCheckStage: (logger: (message: string) => void) => string;
  readonly buildBootstrapPrompt: (context: {
    readonly projectType: ProjectType;
    readonly projectSpec: ProjectSpec;
    readonly workspaceDir: string;
  }) => Promise<string> | string;
}

export type ManagerTaskAssessmentKind = "working" | "stalled" | "error" | "failed";

export interface ManagerTaskAssessment {
  readonly kind: ManagerTaskAssessmentKind;
  readonly reason: string;
}

export interface ManagerAttemptRecord {
  readonly attempt: number;
  readonly taskId: string;
  readonly prompt: string;
  readonly snapshot: ProjectTaskSnapshot;
  readonly providerClaimedCompletion: boolean;
  readonly verification: ManagerVerificationResult | null;
  readonly taskAssessment: ManagerTaskAssessment | null;
  readonly decision: ManagerDecision;
  readonly reason: string;
}

export interface ManagerRequest {
  readonly projectId: string;
  readonly projectType: ProjectType;
  readonly request: string;
  readonly workspaceDir: string;
  readonly provider: Provider;
  readonly projectLayer?: Layer.Layer<ProjectArtifactService>;
  readonly debugLogging?: boolean;
  readonly maxAttempts?: number;
  readonly totalTimeoutMs?: number;
  readonly firstOutputTimeoutMs?: number;
  readonly responseTimeoutMs?: number;
  readonly pollIntervalMs?: number;
  readonly stableAnswerWindowMs?: number;
  readonly preserveWindowOnFailure?: boolean;
  readonly prepareWorkspace?: (() => Promise<void>) | undefined;
  readonly verifyCompletion?:
    | ((
        context: Pick<ManagerRequest, "projectId" | "request" | "workspaceDir" | "provider"> & {
          readonly attempt: number;
          readonly answer: string | null;
          readonly snapshot: ProjectTaskSnapshot;
        },
      ) => Promise<ManagerVerificationResult> | ManagerVerificationResult)
    | undefined;
}

export interface ManagerResult {
  readonly ok: boolean;
  readonly projectId: string;
  readonly request: string;
  readonly workspaceDir: string;
  readonly provider: Provider;
  readonly attempts: readonly ManagerAttemptRecord[];
  readonly decision: ManagerDecision;
  readonly reason: string;
  readonly finalAnswer: string | null;
  readonly finalSnapshot: ProjectTaskSnapshot | null;
}
