import { NextResponse } from "next/server";
import { badRequest } from "@/src/server/http";
import { getAppSettings, updateAppSettings } from "@/src/server/project";

export async function GET() {
  return NextResponse.json({ settings: await getAppSettings() });
}

export async function PATCH(request: Request) {
  try {
    const body = (await request.json()) as { defaultProjectPath?: string };
    const settings = await updateAppSettings({ defaultProjectPath: body.defaultProjectPath });
    return NextResponse.json({ settings });
  } catch (error) {
    return badRequest(error);
  }
}
