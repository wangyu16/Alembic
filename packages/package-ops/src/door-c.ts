/**
 * Door C — changes pushed straight to the working repo on GitHub (B1;
 * queue-and-jobs-v3 §2.2, §4). Pure: the webhook receiver and the sweep do
 * the I/O (signature first, then re-fetch the commits from GitHub as the App;
 * the payload's own file lists are never trusted).
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { REGULAR_FILE_MODES, activeProfile, fileKind, isHarnessPath, isSvgPath, isTextBytes, mediaProblems, normalizePath, spaceForPathV3, svgProblems, unitPartForPath, WorkingManifestV3Schema } from "@alembic/package-contract";

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

/* -------------------------------------------------------------------------- *
 * Content checks on a push (package-contract-v3 §13.6, §11.4; queue §4 amended)
 * -------------------------------------------------------------------------- */

/** The manifest fields that are Alembic's (contract v3 §13.5): never taken from a push. */
export const MECHANICS_FIELDS = ["packageId", "privateRepo", "publicRepo", "createdAt", "coursewerk", "upstream"] as const;

export interface PushedFile {
  path: string;
  /** "removed" when the push deleted it. */
  status: "added" | "modified" | "removed";
  /** The pushed bytes (absent for removals). */
  bytes?: Uint8Array;
}

export interface ContentVerdict {
  undo: Array<{ path: string; why: string }>;
  /** The owner changed the licence on GitHub: accepted, and the licence files are regenerated. */
  regenerateLicense?: string;
}

/**
 * The second stage of Door C: what a push may not change by content. Pure; the
 * worker fetches the pushed files and both manifests. `pusherIsOwner` comes from
 * matching the pusher's GitHub login to the owner's (an unmatched pusher is not
 * the owner).
 */
export function classifyPushedContent(i: {
  files: readonly PushedFile[];
  manifestBefore: string | null;
  manifestAfter: string | null;
  /** Every path at the pushed head. */
  pathsAfter: ReadonlySet<string>;
  pusherIsOwner: boolean;
}): ContentVerdict {
  const v: ContentVerdict = { undo: [] };
  const undo = (path: string, why: string) => { if (!v.undo.some((u) => u.path === path)) v.undo.push({ path, why }); };
  const parse = (t: string | null) => { try { return WorkingManifestV3Schema.parse(JSON.parse(t ?? "null")); } catch { return null; } };
  const before = parse(i.manifestBefore);
  const touched = new Set(i.files.map((f) => f.path));
  // The manifest: valid under the profile, Alembic's fields unchanged, the licence only by the owner.
  if (touched.has("alembic.json")) {
    const after = parse(i.manifestAfter);
    const raw = (t: string | null) => { try { return JSON.parse(t ?? "null") as Record<string, unknown>; } catch { return null; } };
    const rb = raw(i.manifestBefore) ?? {};
    const ra = raw(i.manifestAfter) ?? {};
    if (!after) undo("alembic.json", "the course settings aren't valid");
    else if (!activeProfile.licences.allowed.includes(after.license)) undo("alembic.json", "that licence isn't allowed");
    else if (MECHANICS_FIELDS.some((k) => JSON.stringify(rb[k]) !== JSON.stringify(ra[k]))) undo("alembic.json", "Alembic's own settings can only change in Alembic");
    else {
      // Compared under the new titles (a renamed chapter that already lacked a part isn't a new problem).
      const hadSlug = new Set(before ? before.chapters.map((c) => c.slug) : []);
      const problemsBefore = new Set(before ? activeProfile.unitProblems(after.chapters.filter((c) => hadSlug.has(c.slug)), i.pathsAfter) : []);
      const introduced = activeProfile.unitProblems(after.chapters, i.pathsAfter).filter((p) => !problemsBefore.has(p));
      if (introduced.length) undo("alembic.json", introduced[0]!);
      else if (before && after.license !== before.license) {
        if (i.pusherIsOwner) v.regenerateLicense = after.license;
        else undo("alembic.json", "only the owner changes the licence");
      }
    }
  }
  const listed = new Set((parse(i.manifestAfter) ?? before)?.chapters.map((c) => c.slug) ?? []);
  for (const f of i.files) {
    if (f.path === "LICENSE" || f.path === "CITATION.cff") { undo(f.path, "the licence files are written by Alembic"); continue; }
    if (activeProfile.serverOnlyFiles.includes(f.path)) { undo(f.path, "Alembic's own note"); continue; }
    if (f.status === "removed") {
      const part = unitPartForPath(f.path);
      if (part && listed.has(part.slug)) undo(f.path, "a chapter's parts are removed with the chapter");
      continue;
    }
    const kind = fileKind(f.path);
    // A kind of file a course can't hold (.html, .js …): scripts would run on the published site (audit r3 HIGH-1).
    if (kind === null) { undo(f.path, "a kind of file a course can't hold"); continue; }
    if (kind !== "text" && f.bytes) {
      const problems = mediaProblems(kind, f.bytes);
      if (problems.length) undo(f.path, problems[0]!);
    } else if (isSvgPath(f.path) && f.bytes) {
      const problems = isTextBytes(f.bytes) ? svgProblems(new TextDecoder().decode(f.bytes)) : ["it isn't an SVG picture"];
      if (problems.length) undo(f.path, problems[0]!);
    }
  }
  return v;
}
