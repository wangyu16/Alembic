/**
 * Door D — Download and Replace (K4 step 4; design §7.4).
 *
 * Download assembles the course text into a self-contained file in the
 * browser, with Alembic's host keys in the FC-18 header (§5: host keys use
 * `x_<name>_`): which course and file it is, and the synced version it was
 * made from. Replace reads a file back (an assembled .html or the bare
 * text), checks it is this document, takes the base version, and strips the
 * host keys before the text goes to the version rule.
 */
import type { OrzKit } from "./kit";

export const HOST_KEYS = ["x_alembic_course", "x_alembic_path", "x_alembic_base"] as const;

export interface DownloadMeta {
  packageId: string;
  path: string;
  /** The synced version (sha256) the downloaded text is. */
  baseVersion: string;
}

export function withHostKeys(kit: OrzKit, text: string, m: DownloadMeta): string {
  return kit.editHeader(text, { x_alembic_course: m.packageId, x_alembic_path: m.path, x_alembic_base: m.baseVersion });
}

export async function assembleDownload(kit: OrzKit, text: string, m: DownloadMeta): Promise<string> {
  return kit.assemble(withHostKeys(kit, text, m), { delivery: "inline" });
}

/** The flat key: value lines of the FC-18 header (enough to read our own host keys). */
export function headerValues(text: string): Record<string, string> {
  const m = /^﻿?\{\{nyml[ \t]*\r?\n([\s\S]*?)\}\}/.exec(text);
  const out: Record<string, string> = {};
  if (!m) return out;
  for (const line of m[1]!.split(/\r\n|\r|\n/)) {
    const kv = /^([A-Za-z0-9_]+)[ \t]*:[ \t]*(.*?)[ \t]*$/.exec(line);
    if (kv) out[kv[1]!] = kv[2]!.replace(/^(["'])(.*)\1$/, "$2");
  }
  return out;
}

export type Replacement =
  | { ok: true; text: string; baseVersion: string | null }
  | { ok: false; reason: "not-a-document" | "other-course" | "other-file" | "other-kind" };

/**
 * Read a replacement for `expected`. A file with no Alembic keys (made
 * elsewhere) is accepted with no base: the version rule then treats every
 * difference as a change on top of the current version.
 */
export function readReplacement(
  kit: OrzKit,
  content: string,
  expected: { packageId: string; path: string; kind: string },
): Replacement {
  let text = content;
  if (/^\s*<(!doctype|html)/i.test(content)) {
    const ex = kit.extract(content);
    if (!ex) return { ok: false, reason: "not-a-document" };
    if (ex.kind && ex.kind !== expected.kind) return { ok: false, reason: "other-kind" };
    text = ex.text;
  }
  const h = headerValues(text);
  if (h["x_alembic_course"] && h["x_alembic_course"] !== expected.packageId) return { ok: false, reason: "other-course" };
  if (h["x_alembic_path"] && h["x_alembic_path"] !== expected.path) return { ok: false, reason: "other-file" };
  const base = h["x_alembic_base"] && /^[0-9a-f]{64}$/.test(h["x_alembic_base"]) ? h["x_alembic_base"] : null;
  const present = HOST_KEYS.filter((k) => k in h);
  const clean = present.length ? kit.editHeader(text, Object.fromEntries(present.map((k) => [k, null]))) : text;
  return { ok: true, text: clean, baseVersion: base };
}
