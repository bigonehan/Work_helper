import { Effect } from "effect";
import { classifyFailure, extractAnswer, parseMarker } from "./answerExtraction";
import { logTmuxPromptCompletion, logTmuxPromptDispatch } from "./debugLogging";
import { resolveExecutionPaths } from "./executionPaths";
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
  ExecutionBackend,
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
  readonly projectId: string;
  readonly jobId: string;
  readonly provider: Provider;
  readonly prompt: string;
  readonly workspaceDir: string;
  readonly targetDir: string;
  readonly promptFilePath?: string;
  readonly debugLogging?: boolean;
  readonly totalTimeoutMs: number;
  readonly firstOutputTimeoutMs: number;
  readonly responseTimeoutMs: number;
  readonly pollIntervalMs: number;
  readonly stableAnswerWindowMs: number;
  readonly preserveWindowOnFailure: boolean;
  readonly answerValidator?: ProjectTmuxJobOptions["answerValidator"];
}

interface ProjectSessionRecord {
  readonly projectId: string;
  readonly workspaceDir: string;
  readonly sessionName: string;
}

interface JobRecord {
  readonly projectId: string;
  readonly jobId: string;
  readonly provider: Provider;
  readonly prompt: string;
  readonly workspaceDir: string;
  readonly targetDir: string;
  readonly executionBackend: ExecutionBackend;
  readonly sessionName: string;
  readonly windowName: string;
  readonly windowTarget: string;
  readonly marker: string;
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
  directExitCode: Promise<number> | null;
  directOutput: Promise<string> | null;
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
  if (stage === "starting") return "starting job";
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
    targetDir: record.targetDir,
    executionBackend: record.executionBackend,
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

function createBaseRecord(options: ResolvedJobOptions, prompt: string, marker: string): JobRecord {
  const startedAt = Date.now();
  return {
    projectId: options.projectId,
    jobId: options.jobId,
    provider: options.provider,
    prompt,
    workspaceDir: options.targetDir,
    targetDir: options.targetDir,
    executionBackend: "tmux",
    sessionName: makeSessionName(options.projectId),
    windowName: `job-${sanitize(options.jobId)}`,
    windowTarget: "",
    marker,
    status: "queued",
    stage: "starting",
    currentAction: "starting job",
    lastObservation: "Job submitted.",
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
    directExitCode: null,
    directOutput: null,
    resultPromise: Promise.resolve(undefined as never),
  };
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
    const paths = resolveExecutionPaths(input);
    const options: ResolvedJobOptions = {
      ...defaultOptions,
      ...input,
      ...paths,
    };
    const jobKey = makeJobKey(options.projectId, options.jobId);
    if (jobs.has(jobKey)) {
      throw new Error(`Job already exists: ${jobKey}`);
    }

    const marker = `__WORK_HELPER_EXIT__${sanitize(options.projectId)}_${sanitize(options.jobId)}_${Date.now().toString(36)}`;
    const prompt = await resolvePrompt(options.prompt, options.promptFilePath);
    const providerCommand = buildProviderCommand(options.provider, prompt, options.targetDir, marker);

    try {
      const session = await Effect.runPromise(ensureProjectTmuxSession(options.projectId, options.targetDir));
      const windowName = makeWindowName(options.jobId);
      await logTmuxPromptDispatch(options.debugLogging, {
        scope: "projectManager.dispatch",
        target: `${session.sessionName}:${windowName}`,
        provider: options.provider,
        workspaceDir: options.targetDir,
        prompt,
      });
      const created = await createWindow(session.sessionName, windowName, providerCommand.argv);
      if (created.exitCode !== 0) {
        throw new Error(created.stderr.trim() || created.stdout.trim() || "Failed to create job window.");
      }

      const record: JobRecord = {
        ...createBaseRecord(options, prompt, marker),
        executionBackend: "tmux",
        sessionName: session.sessionName,
        windowName,
        windowTarget: `${session.sessionName}:${windowName}`,
        lastObservation: "Job submitted to tmux window.",
      };
      jobs.set(jobKey, record);
      record.resultPromise = monitorTmuxJob(record, options);
      return {
        projectId: options.projectId,
        jobId: options.jobId,
        sessionName: record.sessionName,
        windowName: record.windowName,
        windowTarget: record.windowTarget,
        startedAt: record.startedAt,
      };
    } catch {
      const proc = Bun.spawn([...providerCommand.argv], {
        stdout: "pipe",
        stderr: "pipe",
      });
      await logTmuxPromptDispatch(options.debugLogging, {
        scope: "projectManager.dispatch",
        target: options.targetDir,
        provider: options.provider,
        workspaceDir: options.targetDir,
        prompt,
      });

      const record: JobRecord = {
        ...createBaseRecord(options, prompt, marker),
        executionBackend: "direct",
        sessionName: `direct-${sanitize(options.projectId)}`,
        windowName: `direct-${sanitize(options.jobId)}`,
        windowTarget: `direct:${sanitize(options.projectId)}:${sanitize(options.jobId)}`,
        currentAction: "running direct provider fallback",
        lastObservation: "tmux unavailable; running direct provider fallback.",
        directExitCode: proc.exited,
        directOutput: Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]).then(
          ([stdout, stderr]) => [stdout.trimEnd(), stderr.trimEnd()].filter(Boolean).join("\n"),
        ),
      };
      jobs.set(jobKey, record);
      record.resultPromise = monitorDirectJob(record, options);
      return {
        projectId: options.projectId,
        jobId: options.jobId,
        sessionName: record.sessionName,
        windowName: record.windowName,
        windowTarget: record.windowTarget,
        startedAt: record.startedAt,
      };
    }
  });

async function monitorTmuxJob(record: JobRecord, options: ResolvedJobOptions): Promise<ProjectJobSnapshot> {
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
      const stage: RunPromptStage = trimmed ? "waiting_for_final_answer" : "waiting_for_first_output";
      if (trimmed && record.firstOutputAt === null) {
        updateRecord(record, {
          firstOutputAt: Date.now(),
        });
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
            await logCompletion(record, options, answer, "answer_validation_failed", validationError);
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
          await logCompletion(record, options, answer, "completed", record.lastObservation);
          return cleanupAndSnapshot(record, options);
        }
      }

      if (!alive) {
        const failure = classifyFailure(record.panePreview, stage, markerSeen, alive);
        finishJob(record, failure.stage, failure.reason);
        await logCompletion(record, options, record.answerPreview, failure.stage, failure.reason);
        return cleanupAndSnapshot(record, options);
      }

      if (record.firstOutputAt === null && Date.now() > firstOutputDeadline) {
        const failure = classifyFailure(record.panePreview, "waiting_for_first_output", markerSeen, alive);
        finishJob(record, failure.stage, failure.reason);
        await logCompletion(record, options, record.answerPreview, failure.stage, failure.reason);
        return cleanupAndSnapshot(record, options);
      }

      if (record.firstOutputAt !== null && Date.now() > responseDeadline) {
        const failure = classifyFailure(record.panePreview, "waiting_for_final_answer", markerSeen, alive);
        finishJob(record, failure.stage, failure.reason);
        await logCompletion(record, options, record.answerPreview, failure.stage, failure.reason);
        return cleanupAndSnapshot(record, options);
      }

      await sleep(options.pollIntervalMs);
    }

    finishJob(record, "timeout", "The job exceeded the configured total timeout.");
    await logCompletion(record, options, record.answerPreview, "timeout", "The job exceeded the configured total timeout.");
    return cleanupAndSnapshot(record, options);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    finishJob(record, "tmux_start_failed", reason);
    await logCompletion(record, options, record.answerPreview, "tmux_start_failed", reason);
    return cleanupAndSnapshot(record, options);
  }
}

async function monitorDirectJob(record: JobRecord, options: ResolvedJobOptions): Promise<ProjectJobSnapshot> {
  const deadline = record.startedAt + options.totalTimeoutMs;

  while (Date.now() < deadline) {
    const exitRace = await Promise.race([
      record.directExitCode?.then((code) => ({ done: true as const, code })) ?? Promise.resolve({ done: false as const, code: null }),
      sleep(options.pollIntervalMs).then(() => ({ done: false as const, code: null })),
    ]);

    if (!exitRace.done) {
      updateRecord(record, {
        stage: "waiting_for_first_output",
        status: "waiting",
        currentAction: "waiting for provider output",
      });
      continue;
    }

    const paneSnapshot = (await record.directOutput) ?? "";
    updateRecord(record, {
      panePreview: paneSnapshot,
      exitCode: exitRace.code,
      firstOutputAt: paneSnapshot.trim() ? Date.now() : null,
      lastPaneChangeAt: Date.now(),
      lastObservation: paneSnapshot.trim() ? "Direct execution completed." : "Direct execution completed without output.",
    });

    const parsed = parseMarker(paneSnapshot, record.marker);
    const answer = extractAnswer(options.provider, options.prompt, paneSnapshot, record.marker);
    updateRecord(record, {
      markerSeen: parsed.markerSeen,
      answerPreview: answer,
      stage: paneSnapshot.trim() ? "waiting_for_final_answer" : "waiting_for_first_output",
      status: paneSnapshot.trim() ? "running" : "waiting",
    });

    if (answer) {
      const validationError = options.answerValidator?.(answer) ?? null;
      if (validationError) {
        finishJob(record, "answer_validation_failed", validationError);
        await logCompletion(record, options, answer, "answer_validation_failed", validationError);
        return toSnapshot(record);
      }

      finishJob(record, "completed", "The provider returned a final answer.");
      await logCompletion(record, options, answer, "completed", record.lastObservation);
      return toSnapshot(record);
    }

    const failure = classifyFailure(paneSnapshot, "waiting_for_final_answer", parsed.markerSeen, false);
    finishJob(record, failure.stage, failure.reason);
    await logCompletion(record, options, record.answerPreview, failure.stage, failure.reason);
    return toSnapshot(record);
  }

  finishJob(record, "timeout", "The job exceeded the configured total timeout.");
  await logCompletion(record, options, record.answerPreview, "timeout", "The job exceeded the configured total timeout.");
  return toSnapshot(record);
}

async function logCompletion(
  record: JobRecord,
  options: ResolvedJobOptions,
  answer: string | null,
  stage: RunPromptStage,
  reason: string,
): Promise<void> {
  await logTmuxPromptCompletion(options.debugLogging, {
    scope: "projectManager.completed",
    target: record.windowTarget,
    provider: record.provider,
    workspaceDir: record.workspaceDir,
    prompt: record.prompt,
    answer,
    status: stage === "completed" ? "completed" : "failed",
    stage,
    reason,
  });
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
  if (record.executionBackend === "tmux" && (record.status === "completed" || !options.preserveWindowOnFailure) && (await targetExists(record.windowTarget))) {
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
