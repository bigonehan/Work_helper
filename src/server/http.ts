import { NextResponse } from "next/server";

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export const badRequest = (error: unknown): NextResponse<{ error: string }> =>
  NextResponse.json({ error: errorMessage(error) }, { status: 400 });

export const notFound = (message: string): NextResponse<{ error: string }> =>
  NextResponse.json({ error: message }, { status: 404 });
