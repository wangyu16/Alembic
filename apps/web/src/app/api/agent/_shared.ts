import "server-only";
import { NextResponse } from "next/server";
import type { Reply } from "@/lib/agent-endpoint";

/** The body as JSON, refused over 12 MB (a hand-in carries at most 50 files of 4 MB, mostly far less). */
export async function jsonBody(req: Request): Promise<unknown | { tooBig: true } | { invalid: true }> {
  const len = Number(req.headers.get("content-length") ?? "0");
  if (len > 12 * 1024 * 1024) return { tooBig: true };
  const text = await req.text();
  if (text.length > 12 * 1024 * 1024) return { tooBig: true };
  try { return JSON.parse(text); } catch { return { invalid: true }; }
}

export const send = (r: Reply) => NextResponse.json(r.body, { status: r.status, headers: { "cache-control": "no-store" } });
