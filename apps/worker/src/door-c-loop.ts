/**
 * Door C on the worker (B1; queue-and-jobs-v3 §4): process recorded GitHub
 * pushes to course working repos.
 * - Alembic's own commits (recorded planned/committed SHAs) are skipped.
 * - Forbidden content (links, submodules, Alembic's files, source records,
 *   Coursewerk records, unclassifiable paths) is undone by ONE system row per
 *   head, `undo:<head>`, priority 1, restoring the state before the push.
 * - Ordinary edits are recorded as the new versions (merge bases for later
 *   syncs) and raise an "Edited elsewhere" item naming the pusher.
 * - `.github/` changes raise an informational item only.
 * - A force-push that drops Alembic's last commit (history rewritten) is
 *   undone by one forced system row writing the last Alembic state forward
 *   again, and an urgent item names the pusher (§4 force-push restore).
 */
import { createHash } from "node:crypto";
import { CompareIncompleteError, GitHubClient, GitHubError, installationTokenSource, treeReader, type RepoCoords } from "@alembic/github-bridge";
import { editActionForPath } from "@alembic/package-contract";
import { classifyOutside, classifyPushedContent, mapLimit, outsideCommits, READ_CONCURRENCY, SqlQueueStore, undoKey, type PushedFile, type RowFile, type SqlClient } from "@alembic/package-ops";
import { activeProfile, fileKind, isSvgPath, MAX_UPLOAD_BYTES, unitPartForPath } from "@alembic/package-contract";

/** At most this many pushed files are fetched to check per push (the rest are checked again at Publish). */
const MAX_PUSH_CHECKS = 50;
/** A push that fails this many times is set aside (marked processed with its error) instead of blocking the line. */
const MAX_EVENT_ATTEMPTS = 10;

export interface DoorCConfig { sql: SqlClient; appId: string; privateKey: string; log?: (m: string) => void }

const sha256 = (t: string) => createHash("sha256").update(t, "utf8").digest("hex");
const TEXT = /\.(md|json|txt|ya?ml|csv|bib|tex)$/i;
const ZERO = /^0{40}$/;

interface Ev { delivery_id: string; repo_full_name: string | null; ref: string | null; before_sha: string | null; after_sha: string | null; forced: boolean; pusher_login: string | null; commit_ids: string[] }

async function done(sql: SqlClient, id: string) {
  await sql.query(`update public.github_events set processed_at = now() where delivery_id = $1`, [id]);
}

export async function doorCPass(cfg: DoorCConfig): Promise<number> {
  const { sql } = cfg;
  // Non-push events need nothing yet.
  await sql.query(`update public.github_events set processed_at = now() where processed_at is null and event <> 'push'`);
  const { rows } = await sql.query<Ev>(
    `select delivery_id, repo_full_name, ref, before_sha, after_sha, forced, pusher_login, commit_ids
       from public.github_events where processed_at is null and event = 'push' order by attempts, received_at limit 20`);
  let n = 0;
  for (const ev of rows) {
    try {
      await handlePush(cfg, ev);
      await done(sql, ev.delivery_id);
      n++;
    } catch (e) {
      // Tried again next pass, behind the others; after MAX_EVENT_ATTEMPTS it is set aside with its error (audit r2 L6).
      const msg = (e as Error).message.slice(0, 500);
      cfg.log?.(`door C ${ev.delivery_id}: ${msg}`);
      await sql.query(
        `update public.github_events set attempts = attempts + 1, last_error = $2,
                processed_at = case when attempts + 1 >= $3 then now() else null end where delivery_id = $1`,
        [ev.delivery_id, msg, MAX_EVENT_ATTEMPTS]).catch(() => {});
    }
  }
  return n;
}

async function handlePush(cfg: DoorCConfig, ev: Ev): Promise<void> {
  const { sql } = cfg;
  if (!ev.repo_full_name || ev.ref !== "refs/heads/main" || !ev.after_sha || !ev.before_sha || ZERO.test(ev.before_sha)) return;
  const [owner, name] = ev.repo_full_name.split("/");
  const { rows: courses } = await sql.query<{ id: string; installation_id: string }>(
    `select p.id, i.installation_id from public.packages p join public.course_installations i on i.package_id = p.id
      where lower(p.private_repo->>'owner') = lower($1) and lower(p.private_repo->>'name') = lower($2)`, [owner, name]);
  const course = courses[0];
  if (!course) return; // not a course's working repo

  const { rows: known } = await sql.query<{ sha: string }>(
    `select unnest(planned_shas) as sha from public.write_queue where package_id = $1
     union select jsonb_array_elements_text(result->'commits') from public.write_queue where package_id = $1 and jsonb_typeof(result->'commits') = 'array'`,
    [course.id]);
  const outside = outsideCommits(ev.commit_ids, new Set(known.map((k) => k.sha)));
  if (outside.length === 0 && !ev.forced) return; // only Alembic's own commits

  const coords: RepoCoords = { owner: owner!, repo: name! };
  const client = new GitHubClient(installationTokenSource({ appId: cfg.appId, privateKey: cfg.privateKey, installationId: Number(course.installation_id), repositories: [name!] }));
  if (ev.forced && (await restoreAfterForcePush(cfg, course.id, client, coords, ev))) return;
  const changed = await changedBetween(client, coords, ev.before_sha, ev.after_sha);
  if (changed.length === 0) return;
  const { entries } = await client.listTreeEntries(coords, ev.after_sha);
  const modeOf = new Map(entries.map((e) => [e.path, e.type === "commit" ? "160000" : e.mode]));
  const verdict = classifyOutside(changed.map((c) => ({ path: c.path, mode: c.status === "removed" ? null : (modeOf.get(c.path) ?? "100644") })));
  const who = ev.pusher_login ?? "someone";

  let regenerate: { license: string; owner: string } | null = null;
  // Second stage, by content (contract v3 §13.6): fetch only what the rules look at.
  const shaOf = new Map(entries.map((e) => [e.path, e.sha]));
  const sizeOf = new Map(entries.map((e) => [e.path, (e as { size?: number }).size ?? 0]));
  const relevant = changed.filter((c) => verdict.edits.includes(c.path) && (
    c.path === "alembic.json" || c.path === "LICENSE" || c.path === "CITATION.cff" || activeProfile.serverOnlyFiles.includes(c.path) ||
    (c.status === "removed" && unitPartForPath(c.path) !== null) ||
    (c.status !== "removed" && (isSvgPath(c.path) || (fileKind(c.path) ?? "text") !== "text"))));
  if (relevant.length) {
    const needManifest = relevant.some((c) => c.path === "alembic.json" || c.status === "removed");
    const [mBefore, mAfter] = needManifest
      ? await Promise.all([client.getFileAtRef(coords, "alembic.json", ev.before_sha), client.getFileAtRef(coords, "alembic.json", ev.after_sha)])
      : [null, null];
    // Bounded (round 1 audit M5): a pushed file over the course limit is undone unread, and at most
    // MAX_PUSH_CHECKS files are fetched per push; the rest are checked again at Publish.
    const tooBig: string[] = [];
    let fetched = 0;
    const files: PushedFile[] = await mapLimit(relevant, READ_CONCURRENCY, async (c) => {
      const sha = shaOf.get(c.path);
      const wantBytes = c.status !== "removed" && sha && (isSvgPath(c.path) || (fileKind(c.path) ?? "text") !== "text");
      if (wantBytes && (sizeOf.get(c.path) ?? 0) > MAX_UPLOAD_BYTES) { tooBig.push(c.path); return { path: c.path, status: c.status }; }
      if (wantBytes && ++fetched > MAX_PUSH_CHECKS) return { path: c.path, status: c.status };
      return { path: c.path, status: c.status, ...(wantBytes ? { bytes: await client.getBlob(coords, sha!) } : {}) };
    });
    for (const p of tooBig) { verdict.undo.push({ path: p, why: "larger than 4 MB, the most a course file may be" }); verdict.edits = verdict.edits.filter((x) => x !== p); }
    const { rows: own } = await sql.query<{ login: string | null; id: string }>(
      `select pr.github_username as login, pr.id from public.course_members m join public.profiles pr on pr.id = m.user_id where m.package_id = $1 and m.role = 'owner'`, [course.id]);
    const owner0 = own[0];
    const pusherIsOwner = !!(owner0?.login && ev.pusher_login && owner0.login.toLowerCase() === ev.pusher_login.toLowerCase());
    const content = classifyPushedContent({ files, manifestBefore: mBefore, manifestAfter: mAfter ?? mBefore, pathsAfter: new Set(entries.filter((e) => e.type === "blob").map((e) => e.path)), pusherIsOwner });
    for (const u of content.undo) {
      verdict.undo.push(u);
      verdict.edits = verdict.edits.filter((p) => p !== u.path);
    }
    if (content.regenerateLicense && owner0) regenerate = { license: content.regenerateLicense, owner: owner0.id };
  }

  if (verdict.undo.length) {
    let beforeTree: Map<string, string> | undefined;
    const beforeTreeOf = async () => {
      const t = await client.listTreeEntries(coords, ev.before_sha!);
      // A truncated listing would read a file as absent and delete it (round 1 audit L1): leave the event to retry.
      if (t.truncated) throw new Error("the course has too many files to list");
      return new Map(t.entries.map((e) => [e.path, e.sha]));
    };
    const files: RowFile[] = [];
    for (const u of verdict.undo) {
      // Restore what the course held before this push (absent then → remove it now). Only a real 404 means
      // absent (getFileAtRef returns null for it); any other failure leaves the event to be retried, so a
      // rate limit or outage never turns into deleting the file (audit r2 #6).
      // A non-text file comes back as the blob it was (never decoded as text).
      const kind = fileKind(u.path);
      if (kind && kind !== "text" && !isSvgPath(u.path)) {
        const was = (beforeTree ??= await beforeTreeOf()).get(u.path);
        files.push(was ? { path: u.path, baseVersion: null, text: null, blob: { sha: was, size: 0 } } : { path: u.path, baseVersion: null, text: null });
        continue;
      }
      const before = await client.getFileAtRef(coords, u.path, ev.before_sha);
      files.push({ path: u.path, baseVersion: null, text: before });
    }
    await new SqlQueueStore(sql).insert({
      packageId: course.id, kind: "system", idem: undoKey(ev.after_sha), priority: 1, pusher: ev.pusher_login,
      payload: { files, force: true, summary: `Undo changes Alembic can't accept (pushed by ${who})` },
    });
    await raiseUndone();
  }
  // After the undo row (round 1 audit L3): the owner's licence change on GitHub is kept and the licence files regenerated.
  if (regenerate) {
    await new SqlQueueStore(sql).insert({ packageId: course.id, kind: "courseop", idem: `license:${ev.after_sha}`, actorId: regenerate.owner, payload: { files: [], op: { op: "setLicense", license: regenerate.license } } });
  }
  async function raiseUndone() {
    await raise(sql, course!.id, `undo:${ev.after_sha}`, {
      title: `Changes on GitHub were undone (${verdict.undo.length} file${verdict.undo.length === 1 ? "" : "s"})`,
      detail: verdict.undo.map((u) => `${u.path}: ${u.why}`).join("; ").slice(0, 900),
      pusher: who, materials: false,
    }, null);
  }

  // The new versions are the merge bases for later syncs (read 8 at a time).
  const statusOf = new Map(changed.map((c) => [c.path, c.status]));
  const texts = verdict.edits.filter((p) => statusOf.get(p) !== "removed" && TEXT.test(p));
  // Many files (a course moved in by hand): the whole tree in one archive request instead of one per file.
  const many = texts.length > EDITED_ITEMS_MAX ? treeReader(client, coords) : null;
  const read = await mapLimit(texts, READ_CONCURRENCY, async (p) => {
    if (!many) return client.getFileAtRef(coords, p, ev.after_sha!);
    const b = await many(ev.after_sha!, p);
    return b === null ? null : new TextDecoder().decode(b);
  });
  for (const [k, path] of texts.entries()) {
    const text = read[k];
    if (text != null) {
      await sql.query(`insert into public.doc_versions (package_id, path, version, commit_sha) values ($1, $2, $3, $4) on conflict do nothing`,
        [course.id, path, sha256(text), ev.after_sha]);
    }
  }
  for (const item of editedItems(verdict.edits, statusOf, who, ev.after_sha!)) {
    await raise(sql, course.id, item.dedupe, { ...item.payload, pusher: who, commit: ev.after_sha }, item.target);
  }

  if (verdict.inform.length) {
    await raise(sql, course.id, `github-folder:${ev.after_sha}`, {
      title: `Automation files (.github/) were changed on GitHub by ${who}; they don't run in a course repository and are never published`,
      pusher: who, materials: false,
    }, null);
  }
}

/**
 * What a push changed. GitHub's compare lists at most 300 files: a bigger push
 * (a course moved in by hand) is compared tree to tree instead, so its
 * forbidden content is still undone and it is never retried forever (RC.7).
 */
export async function changedBetween(
  client: Pick<GitHubClient, "compareCommits" | "listTreeEntries">, coords: RepoCoords, before: string, after: string,
): Promise<Array<{ path: string; status: "added" | "modified" | "removed" }>> {
  try {
    return await client.compareCommits(coords, before, after);
  } catch (e) {
    if (!(e instanceof CompareIncompleteError)) throw e;
    const blobs = async (sha: string) => {
      const t = await client.listTreeEntries(coords, sha);
      if (t.truncated) throw new Error("the tree is too large to compare");
      return new Map(t.entries.filter((x) => x.type !== "tree").map((x) => [x.path, `${x.mode}:${x.sha}`]));
    };
    const [a, b] = await Promise.all([blobs(before), blobs(after)]);
    const out: Array<{ path: string; status: "added" | "modified" | "removed" }> = [];
    for (const [p, v] of b) if (!a.has(p)) out.push({ path: p, status: "added" }); else if (a.get(p) !== v) out.push({ path: p, status: "modified" });
    for (const p of a.keys()) if (!b.has(p)) out.push({ path: p, status: "removed" });
    return out;
  }
}

/** Above this many edited files, one push raises one item, not one per file (RC.7). */
export const EDITED_ITEMS_MAX = 20;

/** The "Edited elsewhere" items for a push's ordinary edits. */
export function editedItems(edits: readonly string[], statusOf: ReadonlyMap<string, string>, who: string, after: string):
  Array<{ dedupe: string; target: string | null; payload: Record<string, unknown> }> {
  const verb = (p: string) => (statusOf.get(p) === "removed" ? "deleted" : statusOf.get(p) === "added" ? "added" : "changed");
  if (edits.length <= EDITED_ITEMS_MAX) {
    return edits.map((path) => ({
      dedupe: `edited:${path}:${after}`, target: path,
      payload: { title: `${path} was ${verb(path)} on GitHub by ${who}`, materials: editActionForPath(path) === "edit.materials" },
    }));
  }
  const shown = edits.slice(0, EDITED_ITEMS_MAX).map((p) => `${p} (${verb(p)})`).join("; ");
  return [{
    dedupe: `edited-many:${after}`, target: null,
    payload: {
      title: `${edits.length} files were changed on GitHub by ${who}`,
      detail: `${shown}; and ${edits.length - EDITED_ITEMS_MAX} more.`.slice(0, 900),
      materials: edits.every((p) => editActionForPath(p) === "edit.materials"),
    },
  }];
}

async function raise(sql: SqlClient, packageId: string, dedupe: string, payload: Record<string, unknown>, target: string | null, interrupt = false) {
  await sql.query(`select public.needs_you_raise($1, 'edited-elsewhere', 'platform', $2, $3::text::jsonb, null, $4, $5)`,
    [packageId, dedupe, JSON.stringify(payload), target, interrupt]);
}

/** At most this many files are put back automatically after a rewrite; more raises an item instead. */
const MAX_RESTORE_FILES = 200;

/**
 * A force-push: if Alembic's last landed commit is no longer in the history
 * of the new head, write that state forward again (text files; never
 * `.github/`), as one forced `undo:<head>` system row. Returns true when the
 * push was handled here (restored, or reported for a person to resolve).
 */
async function restoreAfterForcePush(cfg: DoorCConfig, packageId: string, client: GitHubClient, coords: RepoCoords, ev: Ev): Promise<boolean> {
  const { sql } = cfg;
  const after = ev.after_sha;
  if (!after) return false;
  const { rows: last } = await sql.query<{ head: string }>(
    `select result->>'head' as head from public.write_queue
      where package_id = $1 and status = 'done' and result ? 'head'
      order by finished_at desc nulls last, seq desc limit 1`, [packageId]);
  const lastHead = last[0]?.head;
  if (!lastHead || lastHead === after) return false;
  const who = ev.pusher_login ?? "someone";
  const report = (title: string, detail: string) => raise(sql, packageId, `force:${after}`, { title, detail, pusher: who, materials: false }, null, true);
  try {
    await client.compareCommits(coords, lastHead, after);
    return false; // Alembic's last commit is still in the history: an ordinary push on top
  } catch (e) {
    if (e instanceof CompareIncompleteError && e.reason === "too-many-files") return false; // reachable, just large
    if (!(e instanceof CompareIncompleteError) && !(e instanceof GitHubError && e.status === 404)) throw e;
    if (e instanceof GitHubError) {
      await report(`The course's history on GitHub was rewritten by ${who}`, "Alembic's last saved version can't be found any more, so nothing was put back automatically. Check the course on GitHub.");
      return true;
    }
  }
  // History rewritten: put back every file that differs from Alembic's last state.
  const blobs = async (sha: string) => new Map((await client.listTreeEntries(coords, sha)).entries.filter((e) => e.type === "blob").map((e) => [e.path, e.sha]));
  const [mine, theirs] = await Promise.all([blobs(lastHead), blobs(after)]);
  const differ = [...new Set([...mine.keys(), ...theirs.keys()])].filter((p) => mine.get(p) !== theirs.get(p) && !p.startsWith(".github/"));
  if (differ.length > MAX_RESTORE_FILES) {
    await report(`The course's history on GitHub was rewritten by ${who}`, `${differ.length} files differ from Alembic's last saved version: too many to put back automatically. Check the course on GitHub.`);
    return true;
  }
  const files: Array<{ path: string; baseVersion: null; text: string | null }> = [];
  const binary: string[] = [];
  for (const path of differ) {
    const sha = mine.get(path);
    if (!sha) { files.push({ path, baseVersion: null, text: null }); continue; } // added by the rewrite: removed
    const bytes = await client.getBlob(coords, sha);
    let text: string | null = null;
    if (!bytes.includes(0)) { try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { /* binary */ } }
    if (text === null) binary.push(path);
    else files.push({ path, baseVersion: null, text });
  }
  if (files.length) {
    await new SqlQueueStore(sql).insert({
      packageId, kind: "system", idem: undoKey(after), priority: 1, pusher: ev.pusher_login,
      payload: { files, force: true, summary: `Put back the course after its history was rewritten on GitHub (by ${who})` },
    });
  }
  await report(
    `The course's history on GitHub was rewritten by ${who}; Alembic put back its last saved version`,
    (binary.length ? `These files couldn't be put back automatically: ${binary.join(", ")}. ` : "") + `${files.length} file${files.length === 1 ? "" : "s"} restored.`.slice(0, 900),
  );
  return true;
}
