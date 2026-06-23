import { NextResponse } from "next/server";
import { badRequest, notFound } from "@/src/server/http";
import { deleteProject, deleteProjectFiles, getProjectDetail, updateProject } from "@/src/server/uiProjectData";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await getProjectDetail(id);
  if (!project) {
    return notFound("Project not found.");
  }

  return NextResponse.json(project);
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const body = (await request.json()) as { name?: string; type?: "code" | "mono"; state?: "init" | "wait" | "work" | "check" | "complete"; path?: string };
    const project = await updateProject(id, body);
    if (!project) {
      return notFound("Project not found.");
    }

    return NextResponse.json({ project });
  } catch (error) {
    return badRequest(error);
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const body = await _request.json().catch(() => ({})) as { mode?: "files" | "registry" };
    const deleted = body.mode === "files" ? await deleteProjectFiles(id) : await deleteProject(id);
    if (!deleted) {
      return notFound("Project not found.");
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return badRequest(error);
  }
}
