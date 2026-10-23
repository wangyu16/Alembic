/**
 * Security loop r2 (round-2 audit, 2026-10-23): probes for the database
 * findings, on the Supabase-shaped harness (non-superuser owner, every
 * migration in a fresh session — P5.S.13). Each block reproduced its finding
 * on d4544cc (it failed there) and passes with migrations 0028_loop_r2_*.
 *
 *   NEW-2  P5.A.1.n  no projected timestamp is client-supplied or in the future
 *   NEW-3  P5.B.1.q  a docId / packageId is never reused, even after deletion
 *   NEW-4  P5.S.1.e  suggestions: pending-only, bounded, rate-limited
 *   NEW-5  P5.S.1.f  registrations are written by the server only
 *   LOW-1  P5.S.1.g  the public reads only listable registrations
 *   LOW-2  P5.B.1.r  documents_foreign_doc_ids answers only for the caller's own package
 *   LOW-3  P5.S.14   every SECURITY DEFINER function pins search_path = ''
 *   LOW-4  P5.S.3.f  a course adaptation counts only when the adapter holds content
 *   Impr.2 P5.S.15   no column the API role can write feeds ranking, listability,
 *                    recency or the /d byte source
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import {
  applyMigrationsFrom,
  asRole,
  freshDatabase,
  listPackage,
  manifestFor,
  seedDoc,
  seedPackage,
  seedUser,
} from "./discovery-pglite";

let db: PGlite;
let victim: string;
let attacker: string;

beforeAll(async () => {
  db = await freshDatabase();
  victim = await seedUser(db, "victim");
  attacker = await seedUser(db, "attacker");
}, 120_000);
afterAll(async () => {
  await db?.close();
});

async function attempt(fn: () => Promise<unknown>): Promise<"ok" | "refused"> {
  try {
    await fn();
    return "ok";
  } catch (e) {
    if (process.env["R2_DEBUG"]) console.log("refused:", (e as Error).message);
    return "refused";
  }
}

const FUTURE = "2099-01-01T00:00:00Z";
const REG = `insert into public.portal_registrations
  (package_id, title, description, license, public_repo_url, site_url, registered_at)
  values ($1, 't', '', 'CC-BY-4.0', 'https://github.com/x/y', 'https://x.github.io/y/', $2)`;
/** As the server writes it (service role, owner named explicitly — lib/package-trust-writes.ts). */
const REG_SVC = `insert into public.portal_registrations
  (package_id, owner_id, title, description, license, public_repo_url, site_url, registered_at)
  values ($1, $3, 't', '', 'CC-BY-4.0', 'https://github.com/x/y', 'https://x.github.io/y/', $2)`;

async function nowTs(): Promise<number> {
  return new Date((await db.query<{ n: Date }>(`select now() + interval '1 second' n`)).rows[0]!.n).getTime();
}

// ---------------------------------------------------------------------------
// NEW-2 — projected timestamps are server-owned
// ---------------------------------------------------------------------------
describe("NEW-2 no projected timestamp is client-supplied or in the future", () => {
  it("[P5.A.1.n] registrations.registered_at ignores a client value on insert and update", async () => {
    const pkg = await seedPackage(db, { owner: victim });
    // The server (service role) writes registrations since NEW-5; even its
    // value is ignored.
    await asRole(db, "service_role", () => db.query(REG_SVC, [pkg, FUTURE, victim]));
    const t0 = await nowTs();
    const at = async () =>
      new Date(
        (await db.query<{ r: Date }>(`select registered_at r from public.portal_registrations where package_id = $1`, [pkg]))
          .rows[0]!.r,
      ).getTime();
    expect(await at()).toBeLessThanOrEqual(t0);
    const first = await at();
    await asRole(db, "service_role", () =>
      db.query(`update public.portal_registrations set registered_at = $2 where package_id = $1`, [pkg, FUTURE]),
    );
    expect(await at()).toBe(first);
  });

  it("[P5.A.1.n] documents.registered_at ignores a client value (direct insert, update, documents_apply)", async () => {
    const pkg = await seedPackage(db, { owner: attacker, listed: true });
    const t0 = await nowTs();
    await asRole(
      db,
      "authenticated",
      async () => {
        await db.query(
          `insert into public.documents (doc_id, package_id, repo, path, space, kind, source_hash, origin,
             discoverable, permalink_class, registered_at)
           values ('doc-fwd1', $1, 'public', 'assets/f1.svg', 'assets', 'svg', 'h', 'created', true, 'object', $2)`,
          [pkg, FUTURE],
        );
        await db.query(`update public.documents set registered_at = $2 where doc_id = 'doc-fwd1' and package_id = $1`, [
          pkg,
          FUTURE,
        ]);
        await db.query(`select public.documents_apply($1, null, $2::jsonb)`, [
          pkg,
          JSON.stringify([
            {
              doc_id: "doc-fwd2",
              package_id: pkg,
              repo: "public",
              path: "assets/f2.svg",
              space: "assets",
              kind: "svg",
              source_hash: "h",
              origin: "created",
              discoverable: true,
              permalink_class: "object",
              registered_at: FUTURE,
            },
          ]),
        ]);
      },
      attacker,
    );
    const { rows } = await db.query<{ r: Date }>(
      `select registered_at r from public.documents where doc_id in ('doc-fwd1', 'doc-fwd2')`,
    );
    expect(rows).toHaveLength(2);
    for (const r of rows) expect(new Date(r.r).getTime()).toBeLessThanOrEqual(t0);
  });

  it("[P5.A.1.n] the projector never projects a future timestamp, whatever a base row holds", async () => {
    const pkg = await seedPackage(db, { owner: victim, listed: true, title: "Clamp course" });
    const doc = await seedDoc(db, { packageId: pkg });
    // A legacy row (written before the owning triggers existed): forge it with
    // the triggers off, as the table owner.
    await db.exec(`alter table public.documents disable trigger user`);
    await db.query(`update public.documents set registered_at = $2, content_changed_at = $2 where doc_id = $1`, [doc, FUTURE]);
    await db.exec(`alter table public.documents enable trigger user`);
    await db.exec(`alter table public.portal_registrations disable trigger user`);
    await db.query(`update public.portal_registrations set registered_at = $2 where package_id = $1`, [pkg, FUTURE]);
    await db.exec(`alter table public.portal_registrations enable trigger user`);
    await db.query(`select public.discovery_refresh_package($1)`, [pkg]);
    const t0 = await nowTs();
    const c = await db.query<{ l: Date; u: Date }>(
      `select listed_at l, updated_at u from public.discovery_courses where package_id = $1`,
      [pkg],
    );
    const e = await db.query<{ l: Date; u: Date }>(
      `select listed_at l, updated_at u from public.discovery_elements where doc_id = $1`,
      [doc],
    );
    expect(c.rows).toHaveLength(1);
    expect(e.rows).toHaveLength(1);
    for (const r of [...c.rows, ...e.rows]) {
      expect(new Date(r.l).getTime()).toBeLessThanOrEqual(t0);
      expect(new Date(r.u).getTime()).toBeLessThanOrEqual(t0);
    }
  });
});

// ---------------------------------------------------------------------------
// NEW-3 — retired ids are never reused
// ---------------------------------------------------------------------------
describe("NEW-3 a docId and a packageId are never reused, even after deletion", () => {
  it("[P5.B.1.q] a deleted package's docId cannot be reclaimed by another package (probe2)", async () => {
    const v = await seedPackage(db, { owner: victim, listed: true });
    const a = await seedPackage(db, { owner: attacker, listed: true });
    await seedDoc(db, { packageId: v, docId: "doc-cited1", path: "fragments/weak-acid.md", space: "fragments", kind: "md" });
    // The victim's course reaches end of life: the row is purged (REST delete
    // or reconcileArchivedPackages).
    await asRole(db, "authenticated", () => db.query(`delete from public.packages where id = $1`, [v]), victim);
    const row = (id: string) => ({
      doc_id: id,
      package_id: a,
      repo: "public",
      path: "fragments/weak-acid.md",
      space: "fragments",
      kind: "md",
      source_hash: "5d5e142d",
      origin: "created",
      discoverable: true,
      permalink_class: "document",
    });
    // The registry asks first: a retired id is "taken" → the app mints anew.
    const taken = await asRole(
      db,
      "authenticated",
      () => db.query<{ d: string }>(`select d from public.documents_foreign_doc_ids($1, array['doc-cited1']) d`, [a]),
      attacker,
    );
    expect(taken.rows.map((r) => r.d)).toEqual(["doc-cited1"]);
    // And the database refuses it outright (documents_apply and a direct insert).
    expect(
      await attempt(() =>
        asRole(
          db,
          "authenticated",
          () => db.query(`select public.documents_apply($1, null, $2::jsonb)`, [a, JSON.stringify([row("doc-cited1")])]),
          attacker,
        ),
      ),
    ).toBe("refused");
    expect(
      await attempt(() =>
        asRole(
          db,
          "authenticated",
          () =>
            db.query(
              `insert into public.documents (doc_id, package_id, repo, path, space, kind, source_hash, origin, discoverable, permalink_class)
               values ('doc-cited1', $1, 'public', 'fragments/w.md', 'fragments', 'md', 'h', 'created', true, 'document')`,
              [a],
            ),
          attacker,
        ),
      ),
    ).toBe("refused");
    expect((await db.query(`select 1 from public.documents where doc_id = 'doc-cited1'`)).rows).toEqual([]);
    expect(
      (await asRole(db, "anon", () => db.query(`select 1 from public.discovery_elements where doc_id = 'doc-cited1'`))).rows,
    ).toEqual([]);
  });

  it("[P5.B.1.q] a deleted package's id cannot be re-created by anyone (probe3: no inherited adaptations)", async () => {
    const id = "pkg-popular-ab12cd34";
    await seedPackage(db, { owner: victim, id, listed: true });
    const fork = await seedPackage(db, {
      owner: await seedUser(db, "adapter"),
      listed: true,
      manifest: { adaptedFrom: { packageId: id, title: "Popular", attribution: "Victim" } },
    });
    await seedDoc(db, { packageId: fork });
    await asRole(db, "authenticated", () => db.query(`delete from public.packages where id = $1`, [id]), victim);
    const r = await attempt(() =>
      asRole(
        db,
        "authenticated",
        () =>
          db.query(`insert into public.packages (id, owner_id, title, manifest) values ($1, $2, 'Squat', $3)`, [
            id,
            attacker,
            JSON.stringify(manifestFor(id, "Squat")),
          ]),
        attacker,
      ),
    );
    expect(r).toBe("refused");
    // Not even the platform re-creates it.
    expect(
      await attempt(() =>
        asRole(db, "service_role", () =>
          db.query(`insert into public.packages (id, owner_id, title, manifest) values ($1, $2, 'Squat', '{}')`, [id, attacker]),
        ),
      ),
    ).toBe("refused");
  });

  it("[P5.B.1.q] the retired-id ledger is private and fed only by deletion", async () => {
    for (const role of ["anon", "authenticated"] as const) {
      expect(
        await attempt(() => asRole(db, role, () => db.query(`select * from public.retired_ids`), attacker)),
      ).toBe("refused");
      expect(
        await attempt(() =>
          asRole(db, role, () => db.query(`insert into public.retired_ids (kind, id) values ('doc', 'doc-x')`), attacker),
        ),
      ).toBe("refused");
    }
  });
});

// ---------------------------------------------------------------------------
// NEW-4 — suggestions
// ---------------------------------------------------------------------------
describe("NEW-4 a suggestion is pending, bounded and rate-limited on arrival", () => {
  // Exactly the columns lib/suggestions.ts sends; decided_at only when forged.
  const SUG = `insert into public.suggestions (target_package_id, from_package_id, from_user_id, chapter_path,
    source_block_id, suggested_title, suggested_body, status)
    values ($1, $2, $3, 'study-guide/a.md', $4, 't', $5, $6)`;
  const SUG_DECIDED = `insert into public.suggestions (target_package_id, from_package_id, from_user_id, chapter_path,
    source_block_id, suggested_title, suggested_body, status, decided_at)
    values ($1, $2, $3, 'study-guide/a.md', $4, 't', $5, $6, $7)`;
  let target: string;
  let from: string;
  beforeAll(async () => {
    target = await seedPackage(db, { owner: victim, listed: true });
    from = await seedPackage(db, { owner: attacker, storage: "sandbox" });
  });
  const send = (block: string, body = "b", status = "pending", decided: string | null = null) =>
    attempt(() =>
      asRole(
        db,
        "authenticated",
        () =>
          decided === null
            ? db.query(SUG, [target, from, attacker, block, body, status])
            : db.query(SUG_DECIDED, [target, from, attacker, block, body, status, decided]),
        attacker,
      ),
    );

  it("[P5.S.1.e] a sender cannot insert a pre-decided suggestion", async () => {
    expect(await send("b-acc", "b", "accepted", new Date().toISOString())).toBe("refused");
    expect(await send("b-acc2", "b", "accepted")).toBe("refused");
    expect(await send("b-dec", "b", "pending", new Date().toISOString())).toBe("refused");
    expect(await send("b-ok")).toBe("ok");
  });

  it("[P5.S.1.e] text columns are bounded (body ≤ 20,000 characters)", async () => {
    expect(await send("b-big", "x".repeat(20_001))).toBe("refused");
    expect(await send("b-max", "x".repeat(20_000))).toBe("ok");
    expect(await send("b".repeat(300))).toBe("refused");
  });

  it("[P5.S.1.e] one statement of 2,000 suggestions is refused (per-sender rate limit)", async () => {
    const r = await attempt(() =>
      asRole(
        db,
        "authenticated",
        () =>
          db.query(
            `insert into public.suggestions (target_package_id, from_package_id, from_user_id, chapter_path,
               source_block_id, suggested_title, suggested_body)
             select $1, $2, $3, 'c.md', 'b' || g, 't', 'x' from generate_series(1, 2000) g`,
            [target, from, attacker],
          ),
        attacker,
      ),
    );
    expect(r).toBe("refused");
    const { rows } = await db.query<{ n: number }>(
      `select count(*)::int n from public.suggestions where from_user_id = $1`,
      [attacker],
    );
    expect(rows[0]!.n).toBeLessThanOrEqual(20);
  });

  it("[P5.S.1.e] the hourly cap stops a sender sending one by one", async () => {
    const sender = await seedUser(db, "chatty");
    const own = await seedPackage(db, { owner: sender, storage: "sandbox" });
    const results: string[] = [];
    for (let i = 0; i < 22; i++) {
      results.push(
        await attempt(() =>
          asRole(db, "authenticated", () => db.query(SUG, [target, own, sender, `b-${i}`, "b", "pending"]), sender),
        ),
      );
    }
    expect(results.slice(0, 20).every((r) => r === "ok")).toBe(true);
    expect(results.slice(20)).toEqual(["refused", "refused"]);
  });

  it("[P5.S.1.e] the target owner resolves only status and decided_at", async () => {
    const { rows } = await db.query<{ id: number }>(
      `select id from public.suggestions where target_package_id = $1 limit 1`,
      [target],
    );
    const id = rows[0]!.id;
    expect(
      await attempt(() =>
        asRole(
          db,
          "authenticated",
          () => db.query(`update public.suggestions set status = 'accepted', decided_at = now() where id = $1`, [id]),
          victim,
        ),
      ),
    ).toBe("ok");
    expect(
      await attempt(() =>
        asRole(db, "authenticated", () => db.query(`update public.suggestions set suggested_body = 'x' where id = $1`, [id]), victim),
      ),
    ).toBe("refused");
  });
});

// ---------------------------------------------------------------------------
// NEW-5 / LOW-1 — registrations
// ---------------------------------------------------------------------------
describe("NEW-5 a registration is written by the server only; LOW-1 the public reads listable ones only", () => {
  it("[P5.S.1.f] the owner cannot insert or update a registration through the API, only delete it", async () => {
    const pkg = await seedPackage(db, { owner: attacker });
    expect(
      await attempt(() => asRole(db, "authenticated", () => db.query(REG, [pkg, new Date().toISOString()]), attacker)),
    ).toBe("refused");
    await asRole(db, "service_role", () => db.query(REG_SVC, [pkg, new Date().toISOString(), attacker]));
    expect(
      await attempt(() =>
        asRole(
          db,
          "authenticated",
          () => db.query(`update public.portal_registrations set title = 'x' where package_id = $1`, [pkg]),
          attacker,
        ),
      ),
    ).toBe("refused");
    const del = await asRole(
      db,
      "authenticated",
      () => db.query(`delete from public.portal_registrations where package_id = $1 returning package_id`, [pkg]),
      attacker,
    );
    expect(del.rows).toHaveLength(1);
  });

  it("[P5.S.1.g] a registration row of a trial or archived package is not publicly readable; its owner still sees it", async () => {
    const trial = await seedPackage(db, { owner: attacker, storage: "sandbox", title: "secret trial" });
    await listPackage(db, trial, attacker); // a legacy / stray row
    const archived = await seedPackage(db, { owner: attacker, archived: true });
    await listPackage(db, archived, attacker);
    for (const role of ["anon", "authenticated"] as const) {
      const { rows } = await asRole(
        db,
        role,
        () =>
          db.query(`select package_id from public.portal_registrations where package_id in ($1, $2)`, [trial, archived]),
        role === "authenticated" ? victim : undefined,
      );
      expect(rows).toEqual([]);
    }
    const own = await asRole(
      db,
      "authenticated",
      () => db.query(`select package_id from public.portal_registrations where package_id = $1`, [trial]),
      attacker,
    );
    expect(own.rows).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// LOW-2 — documents_foreign_doc_ids
// ---------------------------------------------------------------------------
describe("LOW-2 documents_foreign_doc_ids answers only for the caller's own package", () => {
  it("[P5.B.1.r] asking relative to someone else's package answers nothing (no membership oracle)", async () => {
    const vt = await seedPackage(db, { owner: victim, storage: "sandbox" });
    await seedDoc(db, { packageId: vt, docId: "doc-vtrial", repo: "private", space: "private", path: "notes/x.md" });
    const mine = await seedPackage(db, { owner: attacker, storage: "sandbox" });
    const q = (pkg: string) =>
      asRole(
        db,
        "authenticated",
        () => db.query<{ d: string }>(`select d from public.documents_foreign_doc_ids($1, array['doc-vtrial', 'doc-nope']) d`, [pkg]),
        attacker,
      );
    // Before: asking relative to the victim's package answered [] for a
    // member and the id for a non-member — a membership oracle.
    expect(await attempt(() => q(vt))).toBe("refused");
    // Relative to the caller's own package it still says "taken" (HIGH-2).
    expect((await q(mine)).rows.map((r) => r.d)).toEqual(["doc-vtrial"]);
  });
});

// ---------------------------------------------------------------------------
// LOW-3 — SECURITY DEFINER functions pin search_path
// ---------------------------------------------------------------------------
describe("LOW-3 every SECURITY DEFINER function pins an empty search_path", () => {
  it("[P5.S.14] every SECURITY DEFINER function in public has an empty search_path", async () => {
    const { rows } = await db.query<{ sig: string; cfg: string | null }>(
      `select p.oid::regprocedure::text sig, array_to_string(p.proconfig, ',') cfg
       from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosecdef order by 1`,
    );
    expect(rows.length).toBeGreaterThan(20);
    const bad = rows.filter((r) => !(r.cfg ?? "").split(",").includes(`search_path=""`)).map((r) => `${r.sig} [${r.cfg}]`);
    expect(bad).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// LOW-4 — adaptation counts need adapted content
// ---------------------------------------------------------------------------
describe("LOW-4 a course adaptation counts only when the adapter holds content", () => {
  it("[P5.S.3.f] an empty published course claiming adaptedFrom adds nothing; one with a live file counts", async () => {
    const src = await seedPackage(db, { owner: victim, listed: true, title: "Source course" });
    const count = async () =>
      (
        await asRole(db, "anon", () =>
          db.query<{ n: number }>(`select adaptation_count n from public.discovery_courses where package_id = $1`, [src]),
        )
      ).rows[0]!.n;
    const sock = await seedPackage(db, {
      owner: await seedUser(db, "sock"),
      manifest: { adaptedFrom: { packageId: src, title: "Source course" } },
    });
    await db.query(`select public.discovery_refresh_package($1)`, [src]);
    expect(await count()).toBe(0);
    await seedDoc(db, { packageId: sock, repo: "public", path: "study-guide/a.md", space: "study-guide", kind: "md" });
    await db.query(`select public.discovery_refresh_package($1)`, [src]);
    expect(await count()).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Improvement 2 — the writable-column inventory
// ---------------------------------------------------------------------------

/**
 * Columns that feed ranking, listability, recency or the /d byte source, and
 * that an owner must therefore not be able to set through the API.
 */
const SENSITIVE: Array<[table: string, column: string, privilege: "INSERT" | "UPDATE"]> = [
  ["packages", "storage", "INSERT"],
  ["packages", "storage", "UPDATE"],
  ["packages", "archived_at", "INSERT"],
  ["packages", "archived_at", "UPDATE"],
  ["packages", "public_repo", "INSERT"],
  ["packages", "public_repo", "UPDATE"],
  ["packages", "private_repo", "INSERT"],
  ["packages", "private_repo", "UPDATE"],
  ["packages", "a11y_status", "INSERT"],
  ["packages", "a11y_status", "UPDATE"],
  ["packages", "a11y_checked_at", "INSERT"],
  ["packages", "a11y_checked_at", "UPDATE"],
  ["packages", "listing_changed_at", "INSERT"],
  ["packages", "listing_changed_at", "UPDATE"],
  ["packages", "owner_id", "UPDATE"],
  ["packages", "id", "UPDATE"],
  ["portal_registrations", "package_id", "INSERT"],
  ["portal_registrations", "package_id", "UPDATE"],
  ["portal_registrations", "owner_id", "INSERT"],
  ["portal_registrations", "owner_id", "UPDATE"],
  ["portal_registrations", "registered_at", "INSERT"],
  ["portal_registrations", "registered_at", "UPDATE"],
  ["portal_registrations", "public_repo_url", "INSERT"],
  ["portal_registrations", "public_repo_url", "UPDATE"],
  ["portal_registrations", "accessibility_status", "INSERT"],
  ["portal_registrations", "accessibility_status", "UPDATE"],
  ["documents", "registered_at", "INSERT"],
  ["documents", "registered_at", "UPDATE"],
  ["documents", "content_changed_at", "INSERT"],
  ["documents", "content_changed_at", "UPDATE"],
  ["documents", "package_id", "UPDATE"],
  ["documents", "adapted_from", "INSERT"],
  ["documents", "adapted_from", "UPDATE"],
  ["sandbox_files", "content_sha256", "INSERT"],
  ["sandbox_files", "content_sha256", "UPDATE"],
  ["discovery_courses", "updated_at", "UPDATE"],
  ["discovery_elements", "updated_at", "UPDATE"],
  ["suggestions", "status", "INSERT"],
  ["suggestions", "decided_at", "INSERT"],
  ["research_events", "occurred_at", "INSERT"],
  ["rate_limit_counters", "hits", "UPDATE"],
];

/**
 * Sensitive columns the API role still holds a privilege on, each with the
 * mechanism that makes a client value inert — exercised in the test below.
 */
const NEUTRALISED: Record<string, string> = {
  "documents.registered_at": "BEFORE trigger documents_registered_at: now() on insert, old value on update (0028_loop_r2_1)",
  "documents.content_changed_at": "BEFORE trigger documents_content_changed_at (0026)",
  "documents.package_id": "BEFORE trigger documents_no_cross_package_move refuses a change (0027)",
  "sandbox_files.content_sha256": "GENERATED ALWAYS column: any client value is refused (0027)",
  "suggestions.status": "insert policy requires status = 'pending' (0028_loop_r2_3)",
  "suggestions.decided_at": "insert policy requires decided_at is null (0028_loop_r2_3)",
  "rate_limit_counters.hits": "RLS enabled with no policy: no row is visible or writable",
  // ACCEPTED OPEN (DecisionLog 2026-10-23 loop r2, LOW-4): file-level lineage
  // is owner-asserted; it counts only for a different educator's published,
  // live copy. Sybil inflation needs real GitHub accounts; per-user quotas open.
  "documents.adapted_from": "ACCEPTED OPEN: counts only from another educator's published live copy (P5.S.3.c)",
};

describe("Improvement 2 the API role can write no column that feeds ranking, listability, recency or /d", () => {
  it("[P5.S.15] every sensitive column is unwritable by authenticated, or listed with what neutralises it", async () => {
    const writable: string[] = [];
    for (const [t, c, priv] of SENSITIVE) {
      const { rows } = await db.query<{ ok: boolean }>(
        `select has_column_privilege('authenticated', ('public.' || $1)::regclass, $2, $3) ok`,
        [t, c, priv],
      );
      if (rows[0]!.ok) writable.push(`${t}.${c}`);
    }
    const unexplained = [...new Set(writable)].filter((k) => !(k in NEUTRALISED));
    expect(unexplained).toEqual([]);
  });

  it("[P5.S.15] the inventory is complete: every column authenticated can write is either harmless or listed", async () => {
    const { rows } = await db.query<{ t: string; c: string }>(
      `select c.relname t, a.attname c
       from pg_class c join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
       where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
         and (has_column_privilege('authenticated', c.oid, a.attnum, 'INSERT')
              or has_column_privilege('authenticated', c.oid, a.attnum, 'UPDATE'))
       order by 1, 2`,
    );
    const sensitive = new Set(SENSITIVE.map(([t, c]) => `${t}.${c}`));
    // Owner-asserted by design (the course's own text and consent decisions),
    // the owner's private workspace, or log rows; none is a ranking,
    // listability, recency or byte-source signal another educator relies on.
    const HARMLESS_TABLES = new Set(["ai_invocations", "package_changes", "rate_limit_counters"]);
    const HARMLESS_COLUMNS = new Set([
      "packages.id", "packages.owner_id", "packages.title", "packages.manifest", "packages.review_all",
      "packages.last_synced_sha", "packages.updated_at",
      "documents.doc_id", "documents.repo", "documents.path", "documents.space", "documents.kind",
      "documents.format_version", "documents.source_hash", "documents.origin", "documents.author",
      "documents.license", "documents.description", "documents.alt_text", "documents.discoverable",
      "documents.permalink_class", "documents.tombstoned", "documents.tags", "documents.content_sha256",
      "documents.package_id",
      "sandbox_files.package_id", "sandbox_files.repo", "sandbox_files.path", "sandbox_files.content",
      "sandbox_files.updated_at",
      "suggestions.id", "suggestions.target_package_id", "suggestions.from_package_id", "suggestions.from_user_id",
      "suggestions.chapter_path", "suggestions.source_block_id", "suggestions.suggested_title",
      "suggestions.suggested_body", "suggestions.note", "suggestions.created_at",
      "profiles.display_name",
    ]);
    const unknown = rows
      .map((r) => `${r.t}.${r.c}`)
      .filter((k) => !sensitive.has(k) && !HARMLESS_COLUMNS.has(k) && !HARMLESS_TABLES.has(k.split(".")[0]!));
    expect(unknown).toEqual([]);
  });

  it("[P5.S.15] the neutralised columns are inert in practice", async () => {
    const pkg = await seedPackage(db, { owner: attacker, listed: true });
    const t0 = await nowTs();
    await asRole(
      db,
      "authenticated",
      async () => {
        await db.query(
          `insert into public.documents (doc_id, package_id, repo, path, space, kind, source_hash, origin, discoverable,
             permalink_class, registered_at, content_changed_at)
           values ('doc-inert1', $1, 'public', 'assets/i.svg', 'assets', 'svg', 'h', 'created', true, 'object', $2, $2)`,
          [pkg, FUTURE],
        );
        await db.query(
          `update public.documents set registered_at = $2, content_changed_at = $2 where doc_id = 'doc-inert1' and package_id = $1`,
          [pkg, FUTURE],
        );
      },
      attacker,
    );
    const { rows } = await db.query<{ r: Date; c: Date }>(
      `select registered_at r, content_changed_at c from public.documents where doc_id = 'doc-inert1'`,
    );
    expect(new Date(rows[0]!.r).getTime()).toBeLessThanOrEqual(t0);
    expect(new Date(rows[0]!.c).getTime()).toBeLessThanOrEqual(t0);
    expect(
      await attempt(() =>
        asRole(
          db,
          "authenticated",
          () =>
            db.query(
              `insert into public.sandbox_files (package_id, repo, path, content, content_sha256) values ($1, 'public', 'x.md', 'hi', '00')`,
              [pkg],
            ),
          attacker,
        ),
      ),
    ).toBe("refused");
  });
});

// ---------------------------------------------------------------------------
// Upgrade: 0028 clamps the future timestamps that exist before it
// ---------------------------------------------------------------------------
describe("NEW-2 upgrade: 0028 clamps existing future timestamps", () => {
  it("[P5.A.1.n] future registered_at values already stored are brought back to now", async () => {
    let old = await freshDatabase({ before: "0028" });
    try {
      const o = await seedUser(old, "o");
      const pkg = await seedPackage(old, { owner: o, listed: true });
      const doc = await seedDoc(old, { packageId: pkg });
      await old.query(`update public.portal_registrations set registered_at = $2 where package_id = $1`, [pkg, FUTURE]);
      await old.query(`update public.documents set registered_at = $2 where doc_id = $1`, [doc, FUTURE]);
      // The operator's read-only pre-check named in the migration header.
      const pre = await old.query<{ n: number }>(
        `select (select count(*) from public.portal_registrations where registered_at > now())
              + (select count(*) from public.documents where registered_at > now()) as n`,
      );
      expect(Number(pre.rows[0]!.n)).toBe(2);
      old = await applyMigrationsFrom(old, "0028");
      const after = await old.query<{ n: number }>(
        `select (select count(*) from public.portal_registrations where registered_at > now())
              + (select count(*) from public.documents where registered_at > now())
              + (select count(*) from public.discovery_courses where listed_at > now() or updated_at > now())
              + (select count(*) from public.discovery_elements where listed_at > now() or updated_at > now()) as n`,
      );
      expect(Number(after.rows[0]!.n)).toBe(0);
    } finally {
      await old.close();
    }
  }, 180_000);
});
