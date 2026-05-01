import { NextResponse } from "next/server";
import { startProjectRun } from "@/src/server/projectRuns";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const body = (await request.json()) as { request?: string; provider?: "codex" | "gemini" };
    const run = await startProjectRun({
      projectId: id,
      request: body.request ?? "",
      provider: body.provider,
    });
    return NextResponse.json({ run }, { status: 202 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
