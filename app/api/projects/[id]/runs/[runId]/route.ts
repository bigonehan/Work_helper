import { NextResponse } from "next/server";
import { Effect } from "effect";
import { getProjectRun } from "@/src/server/projectRuns";
import { listProjectJobs } from "@/src/projectManager";
import { getProjectDetail } from "@/src/server/uiProjectData";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string; runId: string }> }) {
  const { id, runId } = await params;
  const run = getProjectRun(runId);
  if (!run || run.projectId !== id) {
    return NextResponse.json({ error: "Run not found." }, { status: 404 });
  }

  const detail = await getProjectDetail(id);
  const liveSnapshots = await Effect.runPromise(listProjectJobs(id));
  const mergedRun = {
    ...run,
    currentAction: liveSnapshots.at(-1)?.currentAction ?? run.currentAction,
    snapshots: liveSnapshots.length > 0 ? liveSnapshots : run.snapshots,
  };

  return NextResponse.json({
    run: mergedRun,
    jobDocument: detail?.jobDocument ?? null,
    drafts: detail?.drafts ?? [],
  });
}
