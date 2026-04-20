import { Effect } from "effect";
import { extractAnswer, parseMarker, classifyFailure } from "./answerExtraction";
import { logTmuxPromptCompletion, logTmuxPromptDispatch } from "./debugLogging";
import { resolvePrompt } from "./prompts";
import { buildProviderCommand } from "./providers";
import {
  captureTargetPane,
  createDetachedSession,
  createWindow,
  killSession,
  killWindow,
  sessionExists,
  targetExists,
} from "./tmux";
import type {
  ProjectJobHandle,
  ProjectJobListItem,
  ProjectJobSnapshot,
  ProjectJobStatus,
  ProjectTmuxJobOptions,
  Provider,
  RunPromptStage,
} from "./types";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const defaultOptions = {
  totalTimeoutMs: 120_000,
  firstOutputTimeoutMs: 15_000,
  responseTimeoutMs: 90_000,
  pollIntervalMs: 1_000,
  stableAnswerWindowMs: 3_000,
  preserveWindowOnFailure: false,
} as const;

interface ResolvedJobOptions {
  projectId: string;
  jobId: string;
  provider: Provider;
  prompt: string;
  workspaceDir: string;
  promptFilePath?: string;
  debugLogging?: boolean;
  totalTimeoutMs: number;
  firstOutputTimeoutMs: number;
  responseTimeoutMs: number;
  pollIntervalMs: number;
  stableAnswerWindowMs: number;
  preserveWindowOnFailure: boolean;
  answerValidator?: ProjectTmuxJobOptions["answerValidator"];
}

interface ProjectSessionRecord {
  projectId: string;
  workspaceDir: string;
  sessionName: string;
}

interface JobRecord {
  projectId: string;
  jobId: string;
  provider: Provider;
  prompt: string;
  workspaceDir: string;
  sessionName: string;
  windowName: string;
  windowTarget: string;
  marker: string;
  status: ProjectJobStatus;
  stage: RunPromptStage;
  currentAction: string;
  lastObservation: string;
  panePreview: string;
  answerPreview: string | null;
  markerSeen: boolean;
  exitCode: number | null;
  validationError: string | null;
  errorReason: string | null;
  startedAt: number;
  updatedAt: number;
  firstOutputAt: number | null;
  finalAnswerAt: number | null;
  completedAt: number | null;
  timeoutMs: number;
  lastPaneChangeAt: number;
  resultPromise: Promise<ProjectJobSnapshot>;
}

const sessions = new Map<string, ProjectSessionRecord>();
const jobs = new Map<string, JobRecord>();

const makeSessionName = (projectId: string) => `project-${sanitize(projectId)}`;
const makeWindowName = (jobId: string) => `job-${sanitize(jobId)}-${Date.now().toString(36)}`;
const makeJobKey = (projectId: string, jobId: string) => `${projectId}::${jobId}`;

function sanitize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "default";
}

function jobStatusFromStage(stage: RunPromptStage): ProjectJobStatus {
  switch (stage) {
    case "completed":
      return "completed";
    case "answer_validation_failed":
    case "tmux_start_failed":
    case "provider_process_not_started":
    case "provider_started_no_output":
    case "provider_output_started_no_final_answer":
    case "provider_exited_without_answer":
    case "provider_auth_or_init_blocked":
    case "timeout":
      return "failed";
    case "waiting_for_final_answer":
      return "running";
    default:
      return "waiting";
  }
}

function currentActionForStage(stage: RunPromptStage, markerSeen: boolean): string {
  if (stage === "starting") return "starting tmux job";
  if (stage === "waiting_for_first_output") return "waiting for provider output";
  if (stage === "waiting_for_final_answer") {
    return markerSeen ? "parsing provider completion" : "provider is still generating";
  }

  if (stage === "completed") return "job completed";
  return "job failed";
}

function toSnapshot(record: JobRecord): ProjectJobSnapshot {
  return {
    projectId: record.projectId,
    jobId: record.jobId,
    provider: record.provider,
    workspaceDir: record.workspaceDir,
    sessionName: record.sessionName,
    windowName: record.windowName,
    windowTarget: record.windowTarget,
    status: record.status,
    stage: record.stage,
    currentAction: record.currentAction,
    lastObservation: record.lastObservation,
    answerPreview: record.answerPreview,
    panePreview: record.panePreview,
    markerSeen: record.markerSeen,
    exitCode: record.exitCode,
    startedAt: record.startedAt,
    updatedAt: record.updatedAt,
    firstOutputAt: record.firstOutputAt,
    finalAnswerAt: record.finalAnswerAt,
    completedAt: record.completedAt,
    stalledForMs: Date.now() - record.lastPaneChangeAt,
    errorReason: record.errorReason,
    validationError: record.validationError,
  };
}

function updateRecord(record: JobRecord, patch: Partial<JobRecord>): void {
  Object.assign(record, patch, { updatedAt: Date.now() });
}

export const ensureProjectTmuxSession = (projectId: string, workspaceDir: string) =>
  Effect.promise(async (): Promise<ProjectSessionRecord> => {
    const existing = sessions.get(projectId);
    if (existing && (await sessionExists(existing.sessionName))) {
      return existing;
    }

    const sessionName = makeSessionName(projectId);
    const bootstrapCommand = ["bash", "-lc", `cd ${shellQuote(workspaceDir)} && exec bash`] as const;
    const created = await createDetachedSession(sessionName, bootstrapCommand);
    if (created.exitCode !== 0 && !(await sessionExists(sessionName))) {
      throw new Error(created.stderr.trim() || created.stdout.trim() || "Failed to create project tmux session.");
    }

    const record: ProjectSessionRecord = {
      projectId,
      workspaceDir,
      sessionName,
    };
    sessions.set(projectId, record);
    return record;
  });

export const submitProjectJobToTmux = (input: ProjectTmuxJobOptions) =>
  Effect.promise(async (): Promise<ProjectJobHandle> => {
    const options: ResolvedJobOptions = { ...defaultOptions, ...input };
    const jobKey = makeJobKey(options.projectId, options.jobId);
    if (jobs.has(jobKey)) {
      throw new Error(`Job already exists: ${jobKey}`);
    }

    const session = await Effect.runPromise(ensureProjectTmuxSession(options.projectId, options.workspaceDir));
    const marker = `__WORK_HELPER_EXIT__${sanitize(options.projectId)}_${sanitize(options.jobId)}_${Date.now().toString(36)}`;
    const prompt = await resolvePrompt(options.prompt, options.promptFilePath);
    const providerCommand = buildProviderCommand(options.provider, prompt, options.workspaceDir, marker);
    const windowName = makeWindowName(options.jobId);
    await logTmuxPromptDispatch(options.debugLogging, {
      scope: "projectManager.dispatch",
      target: `${session.sessionName}:${windowName}`,
      provider: options.provider,
      workspaceDir: options.workspaceDir,
      prompt,
    });
    const created = await createWindow(session.sessionName, windowName, providerCommand.argv);
    if (created.exitCode !== 0) {
      throw new Error(created.stderr.trim() || created.stdout.trim() || "Failed to create job window.");
    }

    const startedAt = Date.now();
    const record: JobRecord = {
      projectId: options.projectId,
      jobId: options.jobId,
      provider: options.provider,
      prompt,
      workspaceDir: options.workspaceDir,
      sessionName: session.sessionName,
      windowName,
      windowTarget: `${session.sessionName}:${windowName}`,
      marker,
      status: "queued",
      stage: "starting",
      currentAction: "starting tmux job",
      lastObservation: "Job submitted to tmux window.",
      panePreview: "",
      answerPreview: null,
      markerSeen: false,
      exitCode: null,
      validationError: null,
      errorReason: null,
      startedAt,
      updatedAt: startedAt,
      firstOutputAt: null,
      finalAnswerAt: null,
      completedAt: null,
      timeoutMs: options.totalTimeoutMs,
      lastPaneChangeAt: startedAt,
      resultPromise: Promise.resolve(undefined as never),
    };
    jobs.set(jobKey, record);
    record.resultPromise = monitorJob(record, options);

    return {
      projectId: options.projectId,
      jobId: options.jobId,
      sessionName: record.sessionName,
      windowName: record.windowName,
      windowTarget: record.windowTarget,
      startedAt: record.startedAt,
    };
  });

async function monitorJob(record: JobRecord, options: ResolvedJobOptions): Promise<ProjectJobSnapshot> {
  const startDeadline = record.startedAt + options.totalTimeoutMs;
  const firstOutputDeadline = record.startedAt + options.firstOutputTimeoutMs;
  const responseDeadline = record.startedAt + options.responseTimeoutMs;
  let lastPaneSnapshot = "";

  try {
    while (Date.now() < startDeadline) {
      const alive = await targetExists(record.windowTarget);
      const paneSnapshot = alive ? await captureTargetPane(record.windowTarget) : record.panePreview;

      if (paneSnapshot !== lastPaneSnapshot) {
        lastPaneSnapshot = paneSnapshot;
        updateRecord(record, {
          panePreview: paneSnapshot,
          lastPaneChangeAt: Date.now(),
          lastObservation: paneSnapshot.trim()
            ? `Pane updated: ${paneSnapshot.trim().split("\n").slice(-1)[0]?.slice(0, 120) ?? "output"}`
            : "Pane updated with empty output.",
        });
      }

      const parsed = parseMarker(record.panePreview, record.marker);
      const markerSeen = parsed.markerSeen;
      const exitCode = parsed.exitCode;
      const trimmed = record.panePreview.trim();
      let stage: RunPromptStage = record.stage;

      if (trimmed && record.firstOutputAt === null) {
        stage = "waiting_for_final_answer";
        updateRecord(record, {
          firstOutputAt: Date.now(),
        });
      } else if (!trimmed) {
        stage = "waiting_for_first_output";
      } else {
        stage = "waiting_for_final_answer";
      }

      const answer = extractAnswer(options.provider, options.prompt, record.panePreview, record.marker);
      updateRecord(record, {
        stage,
        status: jobStatusFromStage(stage),
        currentAction: currentActionForStage(stage, markerSeen),
        markerSeen,
        exitCode,
        answerPreview: answer,
      });

      if (answer) {
        const validationError = options.answerValidator?.(answer) ?? null;
        if (validationError) {
          if (markerSeen) {
            finishJob(record, "answer_validation_failed", validationError);
            await logTmuxPromptCompletion(options.debugLogging, {
              scope: "projectManager.completed",
              target: record.windowTarget,
              provider: record.provider,
              workspaceDir: record.workspaceDir,
              prompt: record.prompt,
              answer,
              status: "failed",
              stage: "answer_validation_failed",
              reason: validationError,
            });
            return cleanupAndSnapshot(record, options);
          }

          updateRecord(record, {
            validationError,
            lastObservation: `Answer candidate rejected by validator: ${validationError}`,
          });
        } else if (markerSeen || Date.now() - record.lastPaneChangeAt >= options.stableAnswerWindowMs) {
          finishJob(
            record,
            "completed",
            markerSeen
              ? "The provider returned a final answer."
              : "A valid answer was captured and remained stable before provider exit.",
          );
          await logTmuxPromptCompletion(options.debugLogging, {
            scope: "projectManager.completed",
            target: record.windowTarget,
            provider: record.provider,
            workspaceDir: record.workspaceDir,
            prompt: record.prompt,
            answer,
            status: "completed",
            stage: "completed",
            reason: record.lastObservation,
          });
          return cleanupAndSnapshot(record, options);
        }
      }

      if (!alive) {
        const failure = classifyFailure(record.panePreview, stage, markerSeen, alive);
        finishJob(record, failure.stage, failure.reason);
        await logTmuxPromptCompletion(options.debugLogging, {
          scope: "projectManager.completed",
          target: record.windowTarget,
          provider: record.provider,
          workspaceDir: record.workspaceDir,
          prompt: record.prompt,
          answer: record.answerPreview,
          status: "failed",
          stage: failure.stage,
          reason: failure.reason,
        });
        return cleanupAndSnapshot(record, options);
      }

      if (record.firstOutputAt === null && Date.now() > firstOutputDeadline) {
        const failure = classifyFailure(record.panePreview, "waiting_for_first_output", markerSeen, alive);
        finishJob(record, failure.stage, failure.reason);
        await logTmuxPromptCompletion(options.debugLogging, {
          scope: "projectManager.completed",
          target: record.windowTarget,
          provider: record.provider,
          workspaceDir: record.workspaceDir,
          prompt: record.prompt,
          answer: record.answerPreview,
          status: "failed",
          stage: failure.stage,
          reason: failure.reason,
        });
        return cleanupAndSnapshot(record, options);
      }

      if (record.firstOutputAt !== null && Date.now() > responseDeadline) {
        const failure = classifyFailure(record.panePreview, "waiting_for_final_answer", markerSeen, alive);
        finishJob(record, failure.stage, failure.reason);
        await logTmuxPromptCompletion(options.debugLogging, {
          scope: "projectManager.completed",
          target: record.windowTarget,
          provider: record.provider,
          workspaceDir: record.workspaceDir,
          prompt: record.prompt,
          answer: record.answerPreview,
          status: "failed",
          stage: failure.stage,
          reason: failure.reason,
        });
        return cleanupAndSnapshot(record, options);
      }

      await sleep(options.pollIntervalMs);
    }

    finishJob(record, "timeout", "The job exceeded the configured total timeout.");
    await logTmuxPromptCompletion(options.debugLogging, {
      scope: "projectManager.completed",
      target: record.windowTarget,
      provider: record.provider,
      workspaceDir: record.workspaceDir,
      prompt: record.prompt,
      answer: record.answerPreview,
      status: "failed",
      stage: "timeout",
      reason: "The job exceeded the configured total timeout.",
    });
    return cleanupAndSnapshot(record, options);
  } catch (error) {
    finishJob(record, "tmux_start_failed", error instanceof Error ? error.message : String(error));
    await logTmuxPromptCompletion(options.debugLogging, {
      scope: "projectManager.completed",
      target: record.windowTarget,
      provider: record.provider,
      workspaceDir: record.workspaceDir,
      prompt: record.prompt,
      answer: record.answerPreview,
      status: "failed",
      stage: "tmux_start_failed",
      reason: error instanceof Error ? error.message : String(error),
    });
    return cleanupAndSnapshot(record, options);
  }
}

function finishJob(record: JobRecord, stage: RunPromptStage, reason: string): void {
  const completedAt = Date.now();
  updateRecord(record, {
    stage,
    status: jobStatusFromStage(stage),
    currentAction: currentActionForStage(stage, record.markerSeen),
    errorReason: stage === "completed" ? null : reason,
    validationError: stage === "answer_validation_failed" ? reason : record.validationError,
    lastObservation: reason,
    finalAnswerAt: record.answerPreview ? completedAt : record.finalAnswerAt,
    completedAt,
  });
}

async function cleanupAndSnapshot(record: JobRecord, options: ResolvedJobOptions): Promise<ProjectJobSnapshot> {
  if ((record.status === "completed" || !options.preserveWindowOnFailure) && (await targetExists(record.windowTarget))) {
    await killWindow(record.windowTarget);
  }

  return toSnapshot(record);
}

export const getProjectJobSnapshot = (projectId: string, jobId: string) =>
  Effect.sync((): ProjectJobSnapshot | null => {
    const record = jobs.get(makeJobKey(projectId, jobId));
    return record ? toSnapshot(record) : null;
  });

export const listProjectJobs = (projectId?: string) =>
  Effect.sync((): ProjectJobListItem[] =>
    [...jobs.values()]
      .filter((job) => (projectId ? job.projectId === projectId : true))
      .map((job) => toSnapshot(job)),
  );

export const waitForProjectJob = (projectId: string, jobId: string) =>
  Effect.promise(async (): Promise<ProjectJobSnapshot> => {
    const record = jobs.get(makeJobKey(projectId, jobId));
    if (!record) {
      throw new Error(`Job not found: ${projectId}/${jobId}`);
    }

    return record.resultPromise;
  });

export const destroyProjectTmuxSession = (projectId: string) =>
  Effect.promise(async (): Promise<void> => {
    const session = sessions.get(projectId);
    if (!session) {
      return;
    }

    await killSession(session.sessionName);
    sessions.delete(projectId);
  });

const shellQuote = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`;
