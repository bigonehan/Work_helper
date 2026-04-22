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

export type ProjectJobStatus = "queued" | "waiting" | "running" | "completed" | "failed";

export interface ProjectTmuxJobOptions {
  readonly projectId: string;
  readonly jobId: string;
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

export interface ProjectJobHandle {
  readonly projectId: string;
  readonly jobId: string;
  readonly sessionName: string;
  readonly windowName: string;
  readonly windowTarget: string;
  readonly startedAt: number;
}

export interface ProjectJobSnapshot {
  readonly projectId: string;
  readonly jobId: string;
  readonly provider: Provider;
  readonly workspaceDir: string;
  readonly sessionName: string;
  readonly windowName: string;
  readonly windowTarget: string;
  readonly status: ProjectJobStatus;
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

export type ProjectJobListItem = ProjectJobSnapshot;

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
  readonly jobDocument: string;
  readonly workspaceDir: string;
  readonly timestamp: string;
  readonly summary: string;
}

export interface ManagerDraftArtifact {
  readonly draftId: string;
  readonly title: string;
  readonly summary: string;
  readonly path: string;
  readonly input: readonly string[];
  readonly output: readonly string[];
  readonly test: readonly string[];
  readonly priority: number;
  readonly kind: "calc" | "ui" | "i/o" | "action";
  readonly target: readonly string[];
  readonly dependsOn: readonly string[];
  readonly content: string;
}

export interface MakeProjectService {
  readonly projectType: ProjectType;
  readonly makeProject: (context: ProjectArtifactContext) => Promise<string> | string;
  readonly readProject: (projectFilePath: string) => Promise<string> | string;
}

export interface MakeJobService {
  readonly projectType: ProjectType;
  readonly makeJob: (context: ProjectArtifactContext) => Promise<string> | string;
  readonly readJob: (jobFilePath: string) => Promise<string> | string;
}

export interface MakeDraftService {
  readonly projectType: ProjectType;
  readonly makeDraft: (context: ProjectArtifactContext) => Promise<readonly ManagerDraftArtifact[]> | readonly ManagerDraftArtifact[];
}

export interface BootstrapProjectService {
  readonly projectType: ProjectType;
  readonly bootstrapProject: (context: {
    readonly projectType: ProjectType;
    readonly projectSpec: ProjectSpec;
    readonly workspaceDir: string;
  }) => Promise<string> | string;
}

export interface StageRuntimeService {
  readonly projectType: ProjectType;
  readonly runBuildStage: (logger: (message: string) => void) => readonly string[];
  readonly runCheckStage: (logger: (message: string) => void) => string;
}

export interface ProjectArtifactService {
  readonly projectType: ProjectType;
  readonly renderProjectDocument: (context: ProjectArtifactContext) => Promise<string> | string;
  readonly readProjectDocument: (projectFilePath: string) => Promise<string> | string;
  readonly renderJobDocument: (context: ProjectArtifactContext) => Promise<string> | string;
  readonly renderDraftDocuments: (context: ProjectArtifactContext) => Promise<readonly ManagerDraftArtifact[]> | readonly ManagerDraftArtifact[];
  readonly readJobDocument: (jobFilePath: string) => Promise<string> | string;
  readonly runBuildStage: (logger: (message: string) => void) => readonly string[];
  readonly runCheckStage: (logger: (message: string) => void) => string;
  readonly buildBootstrapPrompt: (context: {
    readonly projectType: ProjectType;
    readonly projectSpec: ProjectSpec;
    readonly workspaceDir: string;
  }) => Promise<string> | string;
}

export type ManagerJobAssessmentKind = "working" | "stalled" | "error" | "failed";

export interface ManagerJobAssessment {
  readonly kind: ManagerJobAssessmentKind;
  readonly reason: string;
}

export interface ManagerDraftExecution {
  readonly draftId: string;
  readonly jobId: string;
  readonly priority: number;
  readonly kind: "calc" | "ui" | "i/o" | "action";
  readonly target: readonly string[];
  readonly dependsOn: readonly string[];
  readonly snapshot: ProjectJobSnapshot;
  readonly providerClaimedCompletion: boolean;
  readonly jobAssessment: ManagerJobAssessment | null;
}

export interface ManagerAttemptRecord {
  readonly attempt: number;
  readonly jobId: string;
  readonly prompt: string;
  readonly snapshot: ProjectJobSnapshot;
  readonly providerClaimedCompletion: boolean;
  readonly verification: ManagerVerificationResult | null;
  readonly jobAssessment: ManagerJobAssessment | null;
  readonly decision: ManagerDecision;
  readonly reason: string;
  readonly draftExecutions: readonly ManagerDraftExecution[];
  readonly checkJobId: string | null;
}

export interface ManagerRequest {
  readonly projectId: string;
  readonly projectType: ProjectType;
  readonly request: string;
  readonly workspaceDir: string;
  readonly provider: Provider;
  readonly projectLayer?: Layer.Layer<
    | ProjectArtifactService
    | MakeProjectService
    | MakeJobService
    | MakeDraftService
    | BootstrapProjectService
    | StageRuntimeService
  >;
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
          readonly snapshot: ProjectJobSnapshot;
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
  readonly finalSnapshot: ProjectJobSnapshot | null;
}
