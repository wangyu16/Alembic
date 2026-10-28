/**
 * The Publish job (publisher-v3 §3 with queue-and-jobs §5): authorise, pin,
 * read the manifest AT the pinned version, refuse unsafe trees, detect public
 * drift (recognising Alembic's own crashed run), check units, decide,
 * assemble with the link check, record the run as pending, commit the public
 * repo with a compare-and-swap (retried), and record it committed. Every rule
 * that decides what reaches students lives in publisher.ts; this is the
 * orchestration over seams. G3 round 1 fixes are marked.
 */

import {
  assertRegularTree,
  can,
  isProjectable,
  isPublishGenerated,
  sha256Hex,
  WorkingManifestV3Schema,
  type Role,
  type WorkingManifestV3,
} from "@alembic/package-contract";
import { publishWithLinkCheck, unitKey, unitOf, type Decision, type Finding, type TreeFile } from "./publisher";

/* -------------------------------------------------------------------------- *
 * Seams
 * -------------------------------------------------------------------------- */

export interface TreeEntry { path: string; mode: string; type?: string; blobSha: string }

/**
 * A file's content, classified by CONTENT (NUL byte or invalid UTF-8 = binary), never by name (G3 r2 M5).
 * A binary file still carries a best-effort decoding for the checks (UTF-16 by BOM or NUL pattern,
 * otherwise windows-1252), so text in another encoding can't skip them (G3 r3 M-a).
 */
export type FileContent = { text: string } | { binary: true; decoded: string };

export interface WorkingSide {
  head(): Promise<string>;
  listTree(sha: string): Promise<{ entries: TreeEntry[]; truncated: boolean }>;
  /** null = the file couldn't be read at all. */
  readFile(sha: string, path: string): Promise<FileContent | null>;
}

/** Classify bytes as text or binary by content (for adapters). */
export function classifyBytes(bytes: Uint8Array): FileContent {
  if (!bytes.includes(0)) {
    try {
      return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes) };
    } catch {
      /* not UTF-8: binary, decoded best-effort below */
    }
  }
  return { binary: true, decoded: bestEffortDecode(bytes) };
}

function bestEffortDecode(b: Uint8Array): string {
  const le = b[0] === 0xff && b[1] === 0xfe;
  const be = b[0] === 0xfe && b[1] === 0xff;
  if (le || be) return new TextDecoder(le ? "utf-16le" : "utf-16be").decode(b.subarray(2));
  // Every other byte NUL: UTF-16 without a BOM.
  let oddNul = 0;
  let evenNul = 0;
  for (let i = 0; i < Math.min(b.length, 4096); i++) if (b[i] === 0) i % 2 ? oddNul++ : evenNul++;
  const half = Math.min(b.length, 4096) / 2;
  if (oddNul > half * 0.8) return new TextDecoder("utf-16le").decode(b);
  if (evenNul > half * 0.8) return new TextDecoder("utf-16be").decode(b);
  return new TextDecoder("windows-1252").decode(b);
}

export interface PublicSide {
  /** null when the public repo doesn't exist yet. */
  head(): Promise<string | null>;
  create(): Promise<string>; // returns the initial head
  listTree(sha: string): Promise<{ entries: TreeEntry[]; truncated: boolean }>;
  readText(sha: string, path: string): Promise<string | null>;
  recentCommits(limit: number): Promise<Array<{ sha: string; message: string }>>;
  changedPaths(from: string, to: string): Promise<string[]>;
  /** One commit on `expectedHead`; throws an error named "HeadMovedError" if the head moved. */
  commit(input: { expectedHead: string; message: string; files: Array<{ path: string; text?: string; blobSha?: string; delete?: true }> }): Promise<string>;
}

export interface PublishStore {
  acknowledged(packageId: string): Promise<string | null>;
  acknowledge(packageId: string, publicSha: string): Promise<void>;
  anyCommittedRun(packageId: string): Promise<boolean>;
  pendingRun(packageId: string, runId: string): Promise<{ id: string; intendedFiles: PublishedRecord[] } | null>;
  insertPendingRun(run: { id: string; packageId: string; by: string; workingSha: string; publicParent: string | null; choices: unknown; intendedFiles: PublishedRecord[] }): Promise<void>;
  markCommitted(runId: string, publicSha: string, files: PublishedRecord[], results: unknown): Promise<void>;
  publishedFiles(packageId: string): Promise<PublishedRecord[]>;
  /** Paths approved at exactly these versions (course-plan parts). */
  approvedAt(packageId: string, parts: Array<{ path: string; version: string }>): Promise<Set<string>>;
  /** Record approvals (approve-and-publish), each bound to its version at W. */
  approve(packageId: string, by: string, role: Role, parts: Array<{ path: string; version: string }>): Promise<void>;
  /** Bring public drift into the working repo (a system queue row); resolves when it ended. */
  bringInDrift(packageId: string, publicSha: string, paths: string[]): Promise<"done" | "not-done">;
  /** A run that stopped after being recorded pending (e.g. the public copy kept changing). */
  markStopped?(runId: string, reason: string): Promise<void>;
}

/** One public file: always identified by its git blob id in the public repo (G3 H2). */
export interface PublishedRecord { path: string; unit: string; blobSha: string; version: string | null }

export interface UnitCheck {
  id: string;
  run(unit: string, files: Array<{ path: string; text: string | null }>): Promise<Finding[]>;
}

export interface PublishInput {
  runId: string;
  packageId: string;
  by: string;
  /** The publisher's role, resolved by the server at execution. */
  role: Role;
  choices: { publishAnyway: string[]; approveAndPublish: string[] };
  /**
   * Files Publish writes itself (`.github/`, `.alembic/`, `.gitignore`): the
   * site build. Each path must be on the generated list (spec §2); without
   * them a Publish removes the build files the public repo started with.
   */
  generated?: Readonly<Record<string, string>>;
}

export type PublishOutcome =
  | { status: "committed"; runId: string; publicSha: string; decisions: Decision[]; published: string[] }
  | { status: "stopped"; reason: string; drift?: string[] };

const TRAILER = "Alembic-Publish-Run";

/** Git's blob id of a text: sha1("blob <bytes>\0" + utf8) (G3 H2). */
export async function gitBlobSha(text: string): Promise<string> {
  const body = new TextEncoder().encode(text);
  const head = new TextEncoder().encode(`blob ${body.length}\0`);
  const all = new Uint8Array(head.length + body.length);
  all.set(head);
  all.set(body, head.length);
  const d = await globalThis.crypto.subtle.digest("SHA-1", all);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const generatedOrSecret = (p: string) =>
  p === "alembic.json" || p === ".gitignore" || p.startsWith(".alembic/") || p.startsWith(".github/") || p.startsWith("provenance/coursewerk/");

/* -------------------------------------------------------------------------- *
 * The job
 * -------------------------------------------------------------------------- */

export async function runPublish(i: PublishInput, w: WorkingSide, pub: PublicSide, store: PublishStore, checks: UnitCheck[]): Promise<PublishOutcome> {
  // 1. Authorise (P.8, Q.9). "First" = no Publish has ever been committed, even if the repo exists (G3 r2 M3).
  const firstPublish = (await pub.head()) === null || !(await store.anyCommittedRun(i.packageId));
  if (!can(i.role, firstPublish ? "publish.first" : "publish.later")) {
    return { status: "stopped", reason: firstPublish ? "Only the owner makes the first Publish" : "Only the owner or deputy publishes" };
  }
  if (i.choices.publishAnyway.length && !can(i.role, "publish.anyway")) return { status: "stopped", reason: "Not allowed to publish anyway" };
  if (i.choices.approveAndPublish.length && !can(i.role, "approve.plan")) return { status: "stopped", reason: "Not allowed to approve the course plan" };

  // 3. Pin; refuse unsafe trees; read the manifest AT W (G3 H1).
  const W = await w.head();
  const tree = await w.listTree(W);
  if (tree.truncated) return { status: "stopped", reason: "This course is too large to publish safely in one run" };
  try {
    assertRegularTree(tree.entries);
  } catch (e) {
    return { status: "stopped", reason: `The course contains a link or submodule that must be removed first (${(e as Error).message})` };
  }
  let manifest: WorkingManifestV3;
  try {
    const m = await w.readFile(W, "alembic.json");
    manifest = WorkingManifestV3Schema.parse(JSON.parse(m && "text" in m ? m.text : "null"));
  } catch {
    return { status: "stopped", reason: "The course manifest can't be read at this version" };
  }
  const chapters = new Set(manifest.chapters.map((c) => c.slug));
  const previously = await store.publishedFiles(i.packageId);
  const everPublished = new Set(previously.filter((f) => f.unit.startsWith("chapter:")).map((f) => f.unit.slice(8)));

  // 4. Public drift.
  let P = await pub.head();
  if (P !== null) {
    const ack = await store.acknowledged(i.packageId);
    if (ack !== P) {
      const recent = await pub.recentCommits(50);
      let ownSha: string | null = null;
      for (const c of recent) {
        const m = new RegExp(`^${TRAILER}: ([0-9a-f-]{36})$`, "m").exec(c.message);
        if (m) {
          const pending = await store.pendingRun(i.packageId, m[1]!);
          if (pending) {
            await store.markCommitted(pending.id, c.sha, pending.intendedFiles, { recovered: true });
            await store.acknowledge(i.packageId, c.sha);
            ownSha = c.sha;
          }
          break;
        }
        if (c.sha === ack) break;
      }
      let base = ownSha ?? ack;
      if (base === null && !(await store.anyCommittedRun(i.packageId))) {
        // A first Publish that crashed right after creating the repo (and before its commit): the head is the baseline (G3 L3).
        await store.acknowledge(i.packageId, P);
        base = P;
      }
      if (base !== P) {
        const changed = base === null ? [] : await pub.changedPaths(base, P);
        // Bring in every changed projectable unit file, new ones included (G3 M3).
        const bringable = changed.filter((p) => {
          if (generatedOrSecret(p) || !isProjectable(p)) return false;
          const u = unitOf(p, chapters, everPublished);
          return u.kind !== "none" && u.kind !== "orphan";
        });
        // Files added under a chapter name the course doesn't have can't be placed: stop and name them,
        // without acknowledging, so nothing is deleted silently (G3 r2 L5).
        const orphans = changed.filter((p) => !generatedOrSecret(p) && isProjectable(p) && unitOf(p, chapters, everPublished).kind === "orphan");
        if (orphans.length) return { status: "stopped", reason: `Files were added on GitHub under a chapter this course doesn't have: ${orphans.join(", ")}. Move or remove them on GitHub, then publish again.`, drift: orphans };
        const landed = bringable.length ? await store.bringInDrift(i.packageId, P, bringable) : "done";
        if (landed !== "done") return { status: "stopped", reason: "The public copy was changed on GitHub and those changes couldn't be brought in yet", drift: bringable };
        await store.acknowledge(i.packageId, P);
        return { status: "stopped", reason: "The public copy was changed on GitHub — those changes were brought in; run Publish again", drift: bringable };
      }
    }
  }

  // 6. Read units at W; a text file that can't be read stops the run (fail closed, G3 M2).
  const working = new Map<string, TreeFile>();
  const byUnit = new Map<string, Array<{ path: string; text: string | null }>>();
  for (const e of tree.entries) {
    if (e.type === "tree" || e.mode === "040000") continue;
    const u = unitOf(e.path, chapters, everPublished);
    if (u.kind === "none" || u.kind === "orphan") continue;
    const content = await w.readFile(W, e.path);
    if (content === null) return { status: "stopped", reason: `Couldn't read ${e.path} to check it` };
    const text = "text" in content ? content.text : null;
    // Text files carry their git blob id too, so stale-asset comparisons are blob to blob (G3 r3 M-b).
    working.set(e.path, text === null ? { blobSha: e.blobSha } : { text, blobSha: await gitBlobSha(text) });
    const key = unitKey(u);
    // The checks always see words: a binary file is checked through its best-effort decoding (G3 r3 M-a).
    byUnit.set(key, [...(byUnit.get(key) ?? []), { path: e.path, text: text ?? ("decoded" in content ? content.decoded : null) }]);
  }
  const units = [...byUnit.keys()];
  const findings: Finding[] = [];
  for (const unit of units) for (const c of checks) findings.push(...(await c.run(unit, byUnit.get(unit)!)));

  // Approvals at W (both plan parts must exist and be approved); approve-and-publish first.
  const parts: Array<{ path: string; version: string; slug: string }> = [];
  for (const slug of chapters) {
    for (const path of [`concepts/${slug}.md`, `assessment-support/${slug}.md`]) {
      const f = working.get(path);
      if (f?.text !== undefined) parts.push({ path, version: await sha256Hex(f.text), slug });
    }
  }
  const toApprove = parts.filter((p) => i.choices.approveAndPublish.includes(p.path));
  if (toApprove.length) await store.approve(i.packageId, i.by, i.role, toApprove);
  const approvedPaths = await store.approvedAt(i.packageId, parts);
  const approved = new Set<string>();
  for (const slug of chapters) {
    const mine = parts.filter((p) => p.slug === slug);
    if (mine.length === 2 && mine.every((p) => approvedPaths.has(p.path))) approved.add(slug);
  }

  // Published chapter and course texts, with their unit: assembly uses those of KEPT units to keep the
  // deleted assets they still link to (G3 H3; r2 M1: whatever the record's version; r2 M2: keyed by unit).
  const keptTexts = new Map<string, { unit: string; text: string }>();
  if (P !== null) {
    for (const f of previously) {
      if (f.unit.startsWith("chapter:") || f.unit === "course") {
        const t = await pub.readText(P, f.path);
        if (t !== null) keptTexts.set(f.path, { unit: f.unit, text: t });
      }
    }
  }

  // 7–9. Decide, assemble, link check.
  const draft = new Set(manifest.chapters.filter((c) => c.mode === "draft").map((c) => c.slug));
  const publishedMap = new Map(previously.map((f) => [f.path, { blobSha: f.blobSha, unit: f.unit }]));
  const generated = new Map<string, TreeFile>();
  for (const [path, text] of Object.entries(i.generated ?? {})) {
    if (path === "alembic.json" || !isPublishGenerated(path)) throw new Error(`"${path}" is not a file Publish generates`);
    generated.set(path, { text });
  }
  const { tree: assembled, decisions } = publishWithLinkCheck(
    { working, published: publishedMap, manifest, everPublishedChapters: everPublished, keptTexts, generated },
    { units, findings, draft, approved, publishAnyway: new Set(i.choices.publishAnyway) },
  );

  // Records: every file carries its public blob id; a file with neither text nor blob is an error (G3 H2).
  const records: PublishedRecord[] = [];
  const files: Array<{ path: string; text?: string; blobSha?: string; delete?: true }> = [];
  for (const [path, f] of assembled.files) {
    // The site build is Publish's own output, not a unit: written every run, never recorded as published.
    if (f.origin === "generated" && path !== "alembic.json") {
      files.push({ path, text: f.text! });
      continue;
    }
    if (f.text !== undefined) {
      files.push({ path, text: f.text });
      records.push({ path, unit: f.unit, blobSha: await gitBlobSha(f.text), version: await sha256Hex(f.text) });
    } else if (f.blobSha) {
      files.push({ path, blobSha: f.blobSha });
      records.push({ path, unit: f.unit, blobSha: f.blobSha, version: null });
    } else {
      throw new Error(`Publish has no content for ${path}`);
    }
  }

  // 10. Record pending, then one commit to the public repo (CAS on P, retried).
  // Every exit after the pending record either marks the run committed or stopped (G3 r3 L-c).
  if (P === null) P = await pub.create();
  let pendingInserted = false;
  let finished = false;
  try {
  for (let attempt = 0; ; attempt++) {
    const current = await pub.listTree(P);
    if (current.truncated) return { status: "stopped", reason: "The public copy is too large to update safely in one run" };
    const deletions = current.entries
      .filter((e) => e.type !== "tree" && e.mode !== "040000" && !assembled.files.has(e.path))
      .map((e) => ({ path: e.path, delete: true as const }));
    if (attempt === 0) {
      await store.insertPendingRun({ id: i.runId, packageId: i.packageId, by: i.by, workingSha: W, publicParent: P, choices: i.choices, intendedFiles: records });
      pendingInserted = true;
    }
    try {
      const publicSha = await pub.commit({ expectedHead: P, message: `Publish\n\n${TRAILER}: ${i.runId}`, files: [...files, ...deletions] });
      // 11. Record committed immediately (before any site build).
      await store.markCommitted(i.runId, publicSha, records, { decisions: [...decisions.values()] });
      finished = true;
      await store.acknowledge(i.packageId, publicSha);
      return { status: "committed", runId: i.runId, publicSha, decisions: [...decisions.values()], published: [...assembled.publishedChapters] };
    } catch (e) {
      if (!(e instanceof Error && e.name === "HeadMovedError") || attempt >= 2) {
        if (e instanceof Error && e.name === "HeadMovedError") {
          return { status: "stopped", reason: "The public copy keeps changing; try again in a moment" };
        }
        throw e;
      }
      const now = await pub.head();
      const ack = await store.acknowledged(i.packageId);
      if (now === null || now !== ack) {
        return { status: "stopped", reason: "The public copy changed on GitHub during Publish; run Publish again" };
      }
      P = now;
    }
  }
  } finally {
    // A commit that landed but wasn't recorded (crash) is completed by the next run from its trailer;
    // anything else that ends here after the pending record is marked stopped.
    if (pendingInserted && !finished) {
      const landed = (await pub.recentCommits(1).catch(() => []))[0]?.message.includes(`${TRAILER}: ${i.runId}`);
      if (!landed) await store.markStopped?.(i.runId, "stopped before the public commit").catch(() => undefined);
    }
  }
}
