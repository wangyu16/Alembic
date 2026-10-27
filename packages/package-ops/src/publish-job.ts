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

export interface WorkingSide {
  head(): Promise<string>;
  listTree(sha: string): Promise<{ entries: TreeEntry[]; truncated: boolean }>;
  readText(sha: string, path: string): Promise<string | null>;
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
}

export type PublishOutcome =
  | { status: "committed"; runId: string; publicSha: string; decisions: Decision[]; published: string[] }
  | { status: "stopped"; reason: string; drift?: string[] };

const TRAILER = "Alembic-Publish-Run";
const BINARY = /\.(png|jpe?g|gif|webp|avif|ico|pdf|zip|gz|mp4|webm|mov|mp3|wav|ogg|woff2?|ttf|otf)$/i;

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
  // 1. Authorise (P.8, Q.9).
  const firstPublish = (await pub.head()) === null;
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
    manifest = WorkingManifestV3Schema.parse(JSON.parse((await w.readText(W, "alembic.json")) ?? "null"));
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
    const binary = BINARY.test(e.path);
    const text = binary ? null : await w.readText(W, e.path);
    if (!binary && text === null) return { status: "stopped", reason: `Couldn't read ${e.path} to check it` };
    working.set(e.path, text === null ? { blobSha: e.blobSha } : { text });
    const key = unitKey(u);
    byUnit.set(key, [...(byUnit.get(key) ?? []), { path: e.path, text }]);
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

  // Kept units' published texts (for deleted assets they still link to, G3 H3).
  const keptTexts = new Map<string, string>();
  if (P !== null) {
    for (const f of previously) {
      if (f.version !== null && (f.unit.startsWith("chapter:") || f.unit === "course")) {
        const t = await pub.readText(P, f.path);
        if (t !== null) keptTexts.set(f.path, t);
      }
    }
  }

  // 7–9. Decide, assemble, link check.
  const draft = new Set(manifest.chapters.filter((c) => c.mode === "draft").map((c) => c.slug));
  const publishedMap = new Map(previously.map((f) => [f.path, { blobSha: f.blobSha, unit: f.unit }]));
  const { tree: assembled, decisions } = publishWithLinkCheck(
    { working, published: publishedMap, manifest, everPublishedChapters: everPublished, keptTexts },
    { units, findings, draft, approved, publishAnyway: new Set(i.choices.publishAnyway) },
  );

  // Records: every file carries its public blob id; a file with neither text nor blob is an error (G3 H2).
  const records: PublishedRecord[] = [];
  const files: Array<{ path: string; text?: string; blobSha?: string; delete?: true }> = [];
  for (const [path, f] of assembled.files) {
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
  if (P === null) P = await pub.create();
  for (let attempt = 0; ; attempt++) {
    const current = await pub.listTree(P);
    if (current.truncated) return { status: "stopped", reason: "The public copy is too large to update safely in one run" };
    const deletions = current.entries
      .filter((e) => e.type !== "tree" && e.mode !== "040000" && !assembled.files.has(e.path))
      .map((e) => ({ path: e.path, delete: true as const }));
    if (attempt === 0) {
      await store.insertPendingRun({ id: i.runId, packageId: i.packageId, by: i.by, workingSha: W, publicParent: P, choices: i.choices, intendedFiles: records });
    }
    try {
      const publicSha = await pub.commit({ expectedHead: P, message: `Publish\n\n${TRAILER}: ${i.runId}`, files: [...files, ...deletions] });
      // 11. Record committed immediately (before any site build).
      await store.markCommitted(i.runId, publicSha, records, { decisions: [...decisions.values()] });
      await store.acknowledge(i.packageId, publicSha);
      return { status: "committed", runId: i.runId, publicSha, decisions: [...decisions.values()], published: [...assembled.publishedChapters] };
    } catch (e) {
      if (!(e instanceof Error && e.name === "HeadMovedError") || attempt >= 2) {
        if (e instanceof Error && e.name === "HeadMovedError") return { status: "stopped", reason: "The public copy keeps changing; try again in a moment" };
        throw e;
      }
      const now = await pub.head();
      const ack = await store.acknowledged(i.packageId);
      if (now === null || now !== ack) return { status: "stopped", reason: "The public copy changed on GitHub during Publish; run Publish again" };
      P = now;
    }
  }
}
