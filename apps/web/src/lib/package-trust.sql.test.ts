/**
 * Security loop r1, finding M2 — what discovery may trust about a package.
 *
 * Before migration 0025 the packages policy "owner full access" let an owner
 * write EVERY column through the public API: a trial package could publish
 * itself (`storage = 'github'`), un-archive itself, point `publicRepo` at
 * someone else's repository (then `adaptFromPortalAction` fetched content from
 * it — licence laundering), claim an accessibility "pass", and inflate a
 * course's adaptation count with throw-away trial packages. Repro:
 * /tmp/alembic-audit/flip.mts.
 *
 * Now: storage, archived_at, public_repo, private_repo and the server-recorded
 * accessibility result are written by the service role only (the publish,
 * archive/restore and accessibility-check actions); discovery reads the
 * publish-recorded repository and the server-recorded check; adaptations count
 * distinct OTHER educators whose adapting package is published.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asRole, freshDatabase, seedDoc, seedPackage, seedUser } from "./discovery-pglite";

let db: PGlite;
let owner: string;
let other: string;

beforeAll(async () => {
  db = await freshDatabase();
  owner = await seedUser(db, "educator");
  other = await seedUser(db, "colleague");
}, 60_000);
afterAll(async () => {
  await db?.close();
});

async function attempt(fn: () => Promise<unknown>): Promise<"ok" | "refused"> {
  try {
    await fn();
    return "ok";
  } catch {
    return "refused";
  }
}

const asOwner = <T>(user: string, fn: () => Promise<T>) => asRole(db, "authenticated", fn, user);

async function course(id: string) {
  const { rows } = await asRole(db, "anon", () =>
    db.query<{
      package_id: string;
      public_repo_url: string;
      site_url: string;
      accessibility_status: string;
      adaptation_count: number;
    }>(
      `select package_id, public_repo_url, site_url, accessibility_status, adaptation_count
         from public.discovery_courses where package_id = $1`,
      [id],
    ),
  );
  return rows[0];
}

async function setByService(id: string, set: string, params: unknown[] = []) {
  await asRole(db, "service_role", () =>
    db.query(`update public.packages set ${set} where id = $1`, [id, ...params]),
  );
}

describe("M2 trust columns are written by the server only", () => {
  it("[P5.S.3.a] an owner cannot publish, archive, restore or re-point a package through the API", async () => {
    const trial = await seedPackage(db, { owner, storage: "sandbox" });
    const pub = await seedPackage(db, { owner, archived: true });
    const outcome: Record<string, string> = {};
    const tries: Record<string, [string, unknown[]]> = {
      publish: [`update public.packages set storage = 'github' where id = $1`, [trial]],
      archive: [`update public.packages set archived_at = now() where id = $1`, [trial]],
      restore: [`update public.packages set archived_at = null where id = $1`, [pub]],
      repoint: [
        `update public.packages set public_repo = '{"owner":"someone-else","name":"their-repo"}' where id = $1`,
        [pub],
      ],
      privateRepo: [`update public.packages set private_repo = '{"owner":"x","name":"y"}' where id = $1`, [pub]],
      insertPublished: [
        `insert into public.packages (id, owner_id, title, manifest, storage) values ('pkg-evil-a', $1, 't', '{}', 'github')`,
        [owner],
      ],
      insertArchived: [
        `insert into public.packages (id, owner_id, title, manifest, archived_at) values ('pkg-evil-b', $1, 't', '{}', now())`,
        [owner],
      ],
      insertRepo: [
        `insert into public.packages (id, owner_id, title, manifest, public_repo) values ('pkg-evil-c', $1, 't', '{}', '{"owner":"a","name":"b"}')`,
        [owner],
      ],
    };
    for (const [name, [sql, params]] of Object.entries(tries)) {
      outcome[name] = await attempt(() => asOwner(owner, () => db.query(sql, params)));
    }
    expect(outcome).toEqual({
      publish: "refused",
      archive: "refused",
      restore: "refused",
      repoint: "refused",
      privateRepo: "refused",
      insertPublished: "refused",
      insertArchived: "refused",
      insertRepo: "refused",
    });
    const { rows } = await db.query<{ storage: string }>(`select storage from public.packages where id = $1`, [trial]);
    expect(rows[0]!.storage).toBe("sandbox");
  });

  it("[P5.S.3.a] an owner still creates trial packages and edits title, manifest and review settings", async () => {
    await asOwner(owner, () =>
      db.query(
        `insert into public.packages (id, owner_id, title, manifest) values ('pkg-new-trial', $1, 'New', '{}')`,
        [owner],
      ),
    );
    const { rows } = await db.query<{ storage: string; archived_at: string | null }>(
      `select storage, archived_at from public.packages where id = 'pkg-new-trial'`,
    );
    expect(rows[0]).toEqual({ storage: "sandbox", archived_at: null });
    await asOwner(owner, () =>
      db.query(
        `update public.packages set title = 'Renamed', manifest = manifest || '{"title":"Renamed"}',
           review_all = true, last_synced_sha = 'abc', updated_at = now() where id = 'pkg-new-trial'`,
      ),
    );
    // And may delete their own trial package.
    const { rows: del } = await asOwner(owner, () =>
      db.query(`delete from public.packages where id = 'pkg-new-trial' returning id`),
    );
    expect(del).toHaveLength(1);
  });

  it("[P5.S.3.a] the audit's flip scenario lists nothing and exposes no trial element", async () => {
    const trial = await seedPackage(db, { owner, storage: "sandbox" });
    const doc = await seedDoc(db, { packageId: trial });
    await asOwner(owner, async () => {
      await db
        .query(
          `update public.packages set storage = 'github', manifest = manifest ||
             '{"publicRepo":{"owner":"someone-else","name":"their-repo"},"accessibility":{"status":"pass"}}'::jsonb
           where id = $1`,
          [trial],
        )
        .catch(() => undefined);
      await db
        .query(
          `insert into public.portal_registrations (package_id, title, license, public_repo_url, site_url)
           values ($1, 't', 'CC-BY-4.0', 'u', 's')`,
          [trial],
        )
        .catch(() => undefined);
    });
    expect(await course(trial)).toBeUndefined();
    const { rows } = await asRole(db, "anon", () =>
      db.query(`select doc_id from public.discovery_elements where doc_id = $1`, [doc]),
    );
    expect(rows).toHaveLength(0);
  });
});

describe("M2 discovery reads the publish-recorded repository", () => {
  it("[P5.S.3.b] a listed course links the recorded repo, never manifest.publicRepo", async () => {
    const id = await seedPackage(db, {
      owner,
      listed: true,
      manifest: { publicRepo: { owner: "someone-else", name: "their-repo" } },
      recordedRepo: { owner: "educator", name: "chem-oer" },
    });
    const c = await course(id);
    expect(c?.public_repo_url).toBe("https://github.com/educator/chem-oer");
    expect(c?.site_url).toBe("https://educator.github.io/chem-oer/");
    // Editing the manifest's repo changes nothing.
    await asOwner(owner, () =>
      db.query(
        `update public.packages set manifest = manifest || '{"publicRepo":{"owner":"evil","name":"x"}}' where id = $1`,
        [id],
      ),
    );
    expect((await course(id))?.public_repo_url).toBe("https://github.com/educator/chem-oer");
  });

  it("[P5.S.3.b] a published package with no recorded repo is not listed, whatever its manifest says", async () => {
    const id = await seedPackage(db, { owner, listed: true, recordedRepo: null });
    expect(await course(id)).toBeUndefined();
    const { rows } = await db.query<{ ok: boolean }>(`select public.discovery_course_listable($1) as ok`, [id]);
    expect(rows[0]!.ok).toBe(false);
    // Recording the repo (the publish path, service role) lists it.
    await setByService(id, `public_repo = '{"owner":"educator","name":"late-oer"}'`);
    expect((await course(id))?.public_repo_url).toBe("https://github.com/educator/late-oer");
  });
});

describe("M2 adaptation counts only published adaptations by other educators", () => {
  it("[P5.S.3.c] trial socks and the owner's own packages add nothing; distinct educators count once", async () => {
    const target = await seedPackage(db, { owner, listed: true });
    // A fork holds content (loop r2, LOW-4: an empty course naming a source
    // adds nothing), then the publish path records its state.
    const fork = async (by: string, storage: "sandbox" | "github", archived = false) => {
      const id = await seedPackage(db, {
        owner: by,
        storage: "sandbox",
        manifest: { adaptedFrom: { packageId: target, license: "CC-BY-4.0", attribution: "x" } },
      });
      await seedDoc(db, { packageId: id, path: "study-guide/a.md", space: "study-guide", kind: "md" });
      if (storage === "github" || archived) {
        await setByService(id, `storage = '${storage}'${archived ? ", archived_at = now()" : ""}`);
      }
      return id;
    };
    for (let i = 0; i < 5; i++) await fork(other, "sandbox");
    await fork(owner, "github");
    expect((await course(target))?.adaptation_count).toBe(0);
    await fork(other, "github", true);
    expect((await course(target))?.adaptation_count).toBe(0);
    const real = await fork(other, "github");
    await fork(other, "github");
    expect((await course(target))?.adaptation_count).toBe(1);
    // Archiving the adapter (service role) takes its count away again.
    await setByService(real, `archived_at = now()`);
    expect((await course(target))?.adaptation_count).toBe(1);
    const third = await seedUser(db, "third");
    const trialFork = await fork(third, "sandbox");
    expect((await course(target))?.adaptation_count).toBe(1);
    // Publishing an adapter (service role) is what makes it count.
    await setByService(trialFork, `storage = 'github', public_repo = '{"owner":"third","name":"f-oer"}'`);
    expect((await course(target))?.adaptation_count).toBe(2);
  });

  it("[P5.S.3.c] element copies count only from other educators' published packages", async () => {
    const src = await seedPackage(db, { owner, listed: true });
    const el = await seedDoc(db, { packageId: src });
    const copyInto = async (pkg: string) => seedDoc(db, { packageId: pkg, adaptedFrom: el });
    await copyInto(await seedPackage(db, { owner: other, storage: "sandbox" }));
    await copyInto(await seedPackage(db, { owner, storage: "github" }));
    const elCount = async () => {
      const { rows } = await asRole(db, "anon", () =>
        db.query<{ adaptation_count: number }>(
          `select adaptation_count from public.discovery_elements where doc_id = $1`,
          [el],
        ),
      );
      return rows[0]?.adaptation_count;
    };
    expect(await elCount()).toBe(0);
    expect((await course(src))?.adaptation_count).toBe(0);
    await copyInto(await seedPackage(db, { owner: other, storage: "github" }));
    await copyInto(await seedPackage(db, { owner: other, storage: "github" }));
    expect(await elCount()).toBe(1);
    expect((await course(src))?.adaptation_count).toBe(1);
  });
});

describe("M2 the accessibility status is the server's record", () => {
  it("[P5.S.3.d] a manifest 'pass' the server never recorded shows as unknown", async () => {
    const id = await seedPackage(db, {
      owner,
      listed: true,
      manifest: { accessibility: { status: "pass", errorCount: 0, warningCount: 0, checkedAt: "2026-10-01T00:00:00.000Z" } },
    });
    expect((await course(id))?.accessibility_status).toBe("unknown");
    // The owner cannot write the server record.
    const r = await attempt(() =>
      asOwner(owner, () => db.query(`update public.packages set a11y_status = 'pass' where id = $1`, [id])),
    );
    expect(r).toBe("refused");
    // The accessibility-check action records it with the service role.
    await setByService(id, `a11y_status = 'warn', a11y_checked_at = now()`);
    expect((await course(id))?.accessibility_status).toBe("warn");
    const { rows } = await asRole(db, "anon", () =>
      db.query<{ package_id: string }>(
        `select package_id from public.discovery_search_courses(p_a11y => 'warn', p_limit => 51)`,
      ),
    );
    expect(rows.map((x) => x.package_id)).toContain(id);
  });
});
