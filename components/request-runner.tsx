"use client";

import { Send } from "lucide-react";
import { useEffect, useMemo, useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { ProjectRunRecord } from "@/src/server/projectRuns";
import type { UiDraftSummary } from "@/src/server/uiProjectData";

interface RunResponse {
  readonly run: ProjectRunRecord;
  readonly jobDocument?: string | null;
  readonly drafts?: readonly UiDraftSummary[];
  readonly error?: string;
}

export function RequestRunner({
  projectId,
  initialJobDocument,
}: {
  readonly projectId: string;
  readonly initialJobDocument: string | null;
}) {
  const [request, setRequest] = useState("Create a minimal React todo app in this project.");
  const [runId, setRunId] = useState<string | null>(null);
  const [run, setRun] = useState<ProjectRunRecord | null>(null);
  const [jobDocument, setJobDocument] = useState(initialJobDocument);
  const [drafts, setDrafts] = useState<readonly UiDraftSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const snapshots = useMemo(() => run?.snapshots ?? [], [run]);
  const isActive = run?.status === "queued" || run?.status === "running";

  const submit = () => {
    startTransition(async () => {
      setError(null);
      const response = await fetch(`/api/projects/${projectId}/requests`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ request, provider: "codex" }),
      });
      const data = (await response.json()) as RunResponse;
      if (!response.ok || data.error) {
        setError(data.error ?? "Request failed.");
        return;
      }
      setRun(data.run);
      setRunId(data.run.runId);
    });
  };

  useEffect(() => {
    if (!runId || !isActive) {
      return;
    }

    const timer = window.setInterval(async () => {
      const response = await fetch(`/api/projects/${projectId}/runs/${runId}`, { cache: "no-store" });
      const data = (await response.json()) as RunResponse;
      if (response.ok) {
        setRun(data.run);
        setJobDocument(data.jobDocument ?? null);
        setDrafts(data.drafts ?? []);
      }
    }, 1500);

    return () => window.clearInterval(timer);
  }, [isActive, projectId, runId]);

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
      <Card>
        <CardHeader>
          <CardTitle>Request</CardTitle>
          <CardDescription>Submit work to the project manager and watch implementation and verification state.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <textarea
            className="min-h-32 w-full resize-y rounded-md border border-[var(--border)] bg-white p-3 text-sm leading-6 outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
            value={request}
            onChange={(event) => setRequest(event.target.value)}
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={submit} disabled={isPending || isActive || !request.trim()}>
              <Send className="size-4" aria-hidden="true" />
              Send request
            </Button>
            {run ? (
              <Badge
                data-testid="run-status"
                variant={run.status === "completed" ? "default" : run.status === "failed" ? "outline" : "secondary"}
              >
                {run.status}
              </Badge>
            ) : null}
          </div>
          {error ? <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Progress</CardTitle>
          <CardDescription>Current action, verification result, and recent provider snapshots</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-md bg-[var(--muted)] p-3 text-sm">
            <p className="font-medium">{run?.currentAction ?? "No request submitted."}</p>
            <p className="mt-1 text-[var(--muted-foreground)]">{run?.error ?? run?.result?.reason ?? "Waiting for input."}</p>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <Metric label="Attempts" value={String(run?.result?.attempts.length ?? 0)} />
            <Metric label="Draft bundles" value={String(drafts.length)} />
            <Metric label="Snapshots" value={String(snapshots.length)} />
          </div>
          <div className="space-y-2">
            {snapshots.slice(-4).map((snapshot) => (
              <div key={`${snapshot.jobId}-${snapshot.updatedAt}`} className="rounded-md border border-[var(--border)] p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{snapshot.jobId}</span>
                  <Badge variant="secondary">{snapshot.status}</Badge>
                </div>
                <p className="mt-2 text-[var(--muted-foreground)]">{snapshot.currentAction}</p>
                <p className="mt-1 line-clamp-2 text-[var(--muted-foreground)]">{snapshot.lastObservation}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card className="xl:col-span-2">
        <CardHeader>
          <CardTitle>job.md</CardTitle>
          <CardDescription>Live workflow document from the selected project folder</CardDescription>
        </CardHeader>
        <CardContent>
          {jobDocument ? (
            <pre className="max-h-[30rem] rounded-md bg-[var(--muted)] p-4 text-sm leading-6">{jobDocument}</pre>
          ) : (
            <p className="text-sm text-[var(--muted-foreground)]">No job document found yet.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Metric({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="rounded-md bg-[var(--muted)] p-3 text-sm">
      <p className="text-[var(--muted-foreground)]">{label}</p>
      <p className="mt-1 font-semibold">{value}</p>
    </div>
  );
}
