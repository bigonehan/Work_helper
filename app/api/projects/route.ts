import { NextResponse } from "next/server";
import { createProject, listProjects } from "@/src/server/uiProjectData";

export async function GET() {
  return NextResponse.json({ projects: await listProjects() });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { name?: string; type?: "code" | "mono"; state?: "init" | "wait" | "work" | "check" | "complete"; path?: string };
    const project = await createProject({
      name: body.name ?? "",
      type: body.type,
      state: body.state,
      path: body.path,
    });
    return NextResponse.json({ project }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
