/**
 * Door C — changes pushed straight to the working repo on GitHub (B1;
 * queue-and-jobs-v3 §2.2, §4). Pure: the webhook receiver and the sweep do
 * the I/O (signature first, then re-fetch the commits from GitHub as the App;
 * the payload's own file lists are never trusted).
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { REGULAR_FILE_MODES, isHarnessPath, normalizePath, spaceForPathV3 } from "@alembic/package-contract";

/** `X-Hub-Signature-256: sha256=<hex>` over the raw body. */
export function verifyGithubWebhook(rawBody: string, header: string | null, secret: string): boolean {
  if (!header || !secret || !header.startsWith("sha256=")) return false;
  const got = Buffer.from(header.slice(7), "hex");
  const want = createHmac("sha256", secret).update(rawBody, "utf8").digest();
  return got.length === want.length && timingSafeEqual(got, want);
}

export interface PushSummary {
  installationId: number;
  repoId: number;
  repoFullName: string;
  ref: string;
  before: string;
  after: string;
  forced: boolean;
  pusherLogin: string | null;
  /** Commit ids only; their contents are re-fetched. */
  commitIds: string[];
}

const SHA = /^[0-9a-f]{40}$/;

/** The fields a push event is trusted for (ids, to look things up); null when malformed. */
export function parsePush(body: unknown): PushSummary | null {
  const b = body as Record<string, any>;
  const installationId = b?.installation?.id;
  const repoId = b?.repository?.id;
  const repoFullName = b?.repository?.full_name;
  if (!Number.isSafeInteger(installationId) || !Number.isSafeInteger(repoId) || typeof repoFullName !== "string") return null;
  if (typeof b.ref !== "string" || !SHA.test(b.before ?? "") || !SHA.test(b.after ?? "")) return null;
  const commits = Array.isArray(b.commits) ? b.commits : [];
  return {
    installationId,
    repoId,
    repoFullName,
    ref: b.ref,
    before: b.before,
    after: b.after,
    forced: b.forced === true,
    pusherLogin: typeof b.pusher?.name === "string" ? b.pusher.name : null,
    commitIds: commits.map((c: any) => c?.id).filter((id: unknown): id is string => typeof id === "string" && SHA.test(id)),
  };
}

/** Commits Alembic made itself: known by their recorded/planned SHAs, never by trailers (anyone can write a trailer). */
export function outsideCommits(commitIds: readonly string[], alembicShas: ReadonlySet<string>): string[] {
  return commitIds.filter((id) => !alembicShas.has(id));
}

export interface ChangedEntry {
  path: string;
  /** The new tree mode ("100644", "120000" symlink, "160000" submodule …); null when deleted. */
  mode: string | null;
}

export interface OutsideVerdict {
  /** Restore these to their last Alembic-written state (one `undo:<head>` system row). */
  undo: Array<{ path: string; why: string }>;
  /** `.github/` changes: informational only (Actions are off; never projected). */
  inform: string[];
  /** Ordinary edits: recorded as Edited elsewhere and taken as they are. */
  edits: string[];
}

export function classifyOutside(changes: readonly ChangedEntry[]): OutsideVerdict {
  const v: OutsideVerdict = { undo: [], inform: [], edits: [] };
  for (const c of changes) {
    let p: string;
    try {
      p = normalizePath(c.path);
    } catch {
      v.undo.push({ path: c.path, why: "a name Alembic can't accept" });
      continue;
    }
    if (c.mode !== null && c.mode !== "040000" && !(REGULAR_FILE_MODES as readonly string[]).includes(c.mode)) {
      v.undo.push({ path: p, why: c.mode === "120000" ? "a link" : c.mode === "160000" ? "a submodule" : `file mode ${c.mode}` });
      continue;
    }
    if (p.startsWith(".github/")) { v.inform.push(p); continue; }
    if (p.startsWith(".alembic/") || p === ".gitignore") { v.undo.push({ path: p, why: "Alembic's own files" }); continue; }
    if (p.startsWith("private/sources/")) { v.undo.push({ path: p, why: "source records are kept by Alembic" }); continue; }
    if (isHarnessPath(p)) { v.undo.push({ path: p, why: "Coursewerk records arrive only through Coursewerk" }); continue; }
    try {
      spaceForPathV3(p);
    } catch {
      v.undo.push({ path: p, why: "outside the course folders" });
      continue;
    }
    v.edits.push(p);
  }
  return v;
}

/** The one system row per head that undoes forbidden content (never re-enqueued for the same head). */
export const undoKey = (head: string) => `undo:${head}`;
