/**
 * Test-only helper: a throwaway Postgres (PGlite, Postgres compiled to WASM,
 * with pg_trgm) carrying every Supabase migration in `supabase/migrations/`,
 * plus the few Supabase objects the migrations expect (the `anon` /
 * `authenticated` / `service_role` roles with Supabase's default grants,
 * `auth.users` + `auth.uid()`, the `extensions` and `storage` schemas).
 *
 * Supabase-shaped privileges (loop r2, claim P5.S.13). Supabase does not run
 * migrations as a superuser: its `postgres` role is a NON-superuser with
 * CREATEROLE + BYPASSRLS that owns `public`, and every migration runs in its
 * own session. So does this harness: the superuser only lays down the stub
 * (what the platform provides), then every migration file is applied as the
 * non-superuser owner `supa_postgres` in a FRESH backend session (the data
 * directory is dumped and reopened between files). A migration that only
 * works as a superuser, or that leans on session state an earlier file left
 * behind (round 1's 42501: setting a pg_trgm parameter before the extension's
 * library is loaded in that session), fails here as it would in production.
 * Tests then run as that same owner (RLS bypassed for seeding) and switch to
 * the API roles with `asRole`.
 *
 * A full fresh-session replay costs ~30 s, so the migrated data directory is
 * cached on disk (os.tmpdir(), keyed by a hash of the stub, the PGlite
 * version and every applied migration's name + bytes) and each
 * `freshDatabase()` reopens a copy (~1 s). Editing any migration changes the
 * key, so the cache can never serve a stale schema.
 *
 * It is NOT Supabase: PGlite runs a newer Postgres and a single connection, so
 * it proves behaviour, privileges and SQL shape, not performance. Never
 * imported by app code.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";

export const MIGRATIONS_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../supabase/migrations",
);

/** The non-superuser that owns `public` and applies every migration (Supabase's `postgres`). */
export const OWNER_ROLE = "supa_postgres";

/** Bump when the harness's replay semantics change (invalidates the disk cache). */
const HARNESS_VERSION = "r2-nsu-1";
const PGLITE_VERSION = "0.5.11";

// Laid down by the superuser: only what the Supabase platform itself provides.
const SUPABASE_STUB = `
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;
create role ${OWNER_ROLE} login createrole createdb bypassrls;
grant anon, authenticated, service_role to ${OWNER_ROLE} with admin option;
create schema auth;
create schema extensions;
create schema storage;
grant usage on schema public, extensions, auth, storage to anon, authenticated, service_role, ${OWNER_ROLE};
grant create on schema extensions to ${OWNER_ROLE};
alter schema public owner to ${OWNER_ROLE};
create table auth.users (
  id uuid primary key,
  email text,
  raw_user_meta_data jsonb default '{}',
  banned_until timestamptz
);
grant all on auth.users to ${OWNER_ROLE};
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant execute on function auth.uid() to anon, authenticated, service_role, ${OWNER_ROLE};
create table storage.buckets (id text primary key, name text, public boolean,
  file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid, bucket_id text, name text, owner uuid);
alter table storage.objects enable row level security;
alter table storage.objects owner to ${OWNER_ROLE};
alter table storage.buckets owner to ${OWNER_ROLE};
create function storage.foldername(name text) returns text[] language sql immutable as
  $$ select string_to_array(name, '/') $$;
-- Supabase's defaults: objects the owner creates in public are granted to the API roles.
alter default privileges for role ${OWNER_ROLE} in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges for role ${OWNER_ROLE} in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges for role ${OWNER_ROLE} in schema public grant all on sequences to anon, authenticated, service_role;
`;

export function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

export function readMigration(name: string): string {
  return readFileSync(join(MIGRATIONS_DIR, name), "utf8");
}

export interface DatabaseOptions {
  /** Only the migrations whose file name sorts before this (an upgrade test's starting state). */
  before?: string;
  /**
   * Server configuration (postgresql.conf), set by the platform before the
   * owner's session starts — e.g. `{ track_functions: "all" }` for a test that
   * counts function calls. The owner never sets a superuser parameter itself.
   */
  serverSettings?: Record<string, string>;
}

type Dump = File | Blob;
const memo = new Map<string, Promise<Dump>>();

async function openFresh(dump?: Dump): Promise<PGlite> {
  return dump
    ? PGlite.create({ extensions: { pg_trgm }, loadDataDir: dump })
    : PGlite.create({ extensions: { pg_trgm } });
}

/** Start a session as the platform: apply server settings, then become the owner. */
async function ownerSession(db: PGlite, settings: Record<string, string> = {}): Promise<PGlite> {
  for (const [k, v] of Object.entries(settings)) {
    if (!/^[a-z_.]+$/.test(k)) throw new Error(`bad setting name ${k}`);
    await db.query(`select set_config($1, $2, false)`, [k, v]);
  }
  await db.exec(`set session authorization ${OWNER_ROLE}`);
  return db;
}

/** A brand-new cluster with the platform stub, as a dump (fresh-session start). */
async function stubDump(): Promise<Dump> {
  const db = await openFresh();
  try {
    await db.exec(SUPABASE_STUB);
    const dbname = (await db.query<{ d: string }>("select current_database() d")).rows[0]!.d;
    // Supabase's postgres may create (trusted) extensions in its database.
    await db.exec(`grant create on database "${dbname}" to ${OWNER_ROLE}`);
    return await db.dumpDataDir("none");
  } finally {
    await db.close();
  }
}

/**
 * Apply `files` (in order) to the cluster in `from`, each in a FRESH session
 * as the non-superuser owner; returns the resulting data directory. `transform`
 * lets a probe alter a migration's text (e.g. drop a line) before it runs.
 */
export async function replayMigrations(
  files: string[],
  opts: { from?: Dump; transform?: (file: string, sql: string) => string } = {},
): Promise<Dump> {
  let dump = opts.from ?? (await stubDump());
  for (const f of files) {
    const db = await ownerSession(await openFresh(dump));
    try {
      const sql = readMigration(f);
      await db.exec(opts.transform ? opts.transform(f, sql) : sql);
      dump = await db.dumpDataDir("none");
    } catch (e) {
      const err = e as Error & { code?: string };
      const wrapped = new Error(`${f}: ${err.message}`) as Error & { code?: string };
      wrapped.code = err.code;
      throw wrapped;
    } finally {
      await db.close();
    }
  }
  return dump;
}

function cacheKey(files: string[]): string {
  const h = createHash("sha256").update(HARNESS_VERSION).update(PGLITE_VERSION).update(SUPABASE_STUB);
  for (const f of files) h.update(`\0${f}\0`).update(readMigration(f));
  return h.digest("hex").slice(0, 32);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The migrated data directory for `files`, built once (fresh sessions) and cached on disk. */
async function migratedDump(files: string[]): Promise<Dump> {
  const key = cacheKey(files);
  let p = memo.get(key);
  if (!p) {
    p = (async () => {
      const dir = join(tmpdir(), "alembic-pglite-cache");
      mkdirSync(dir, { recursive: true });
      const file = join(dir, `${key}.tar`);
      const lock = `${file}.lock`;
      for (;;) {
        if (existsSync(file)) return new Blob([readFileSync(file)]);
        try {
          mkdirSync(lock);
        } catch {
          // Another worker is building it; a lock older than 5 min is stale.
          try {
            if (Date.now() - statSync(lock).mtimeMs > 300_000) rmdirSync(lock);
          } catch {
            /* gone already */
          }
          await sleep(500);
          continue;
        }
        try {
          if (existsSync(file)) continue;
          const dump = await replayMigrations(files);
          const tmp = `${file}.${process.pid}.tmp`;
          writeFileSync(tmp, Buffer.from(await dump.arrayBuffer()));
          renameSync(tmp, file);
          return dump;
        } finally {
          rmdirSync(lock);
        }
      }
    })();
    memo.set(key, p);
    p.catch(() => memo.delete(key));
  }
  return p;
}

/**
 * A fresh database with every migration applied, in order — or, with
 * `before`, only the migrations whose file name sorts before it (so a test can
 * seed the state an upgrade meets, then `applyMigrationsFrom(db, before)`).
 * The session is the non-superuser owner.
 */
export async function freshDatabase(opts: DatabaseOptions = {}): Promise<PGlite> {
  const files = migrationFiles().filter((f) => opts.before === undefined || f < opts.before);
  return ownerSession(await openFresh(await migratedDump(files)), opts.serverSettings);
}

/**
 * Apply every migration whose file name sorts at or after `from`, in order,
 * each in a fresh session as the owner. Closes `db` and returns the upgraded
 * database (a fresh session) — use the returned handle.
 */
export async function applyMigrationsFrom(db: PGlite, from: string): Promise<PGlite> {
  const start = await db.dumpDataDir("none");
  await db.close();
  const dump = await replayMigrations(
    migrationFiles().filter((n) => n >= from),
    { from: start },
  );
  return ownerSession(await openFresh(dump));
}

// ---------------------------------------------------------------------------
// Seeding (as the database owner — RLS does not apply).
// ---------------------------------------------------------------------------

let seq = 0;
const next = () => (++seq).toString(36).padStart(4, "0");

export async function seedUser(db: PGlite, handle = "educator"): Promise<string> {
  const id = `00000000-0000-4000-8000-${(++seq).toString(16).padStart(12, "0")}`;
  await db.query(`insert into auth.users (id, raw_user_meta_data) values ($1, $2)`, [
    id,
    JSON.stringify({ user_name: handle }),
  ]);
  return id;
}

export interface PackageSeed {
  owner: string;
  id?: string;
  title?: string;
  storage?: "sandbox" | "github";
  archived?: boolean;
  /** Merged over a valid published manifest. */
  manifest?: Record<string, unknown>;
  /** Insert the "List publicly" consent row. */
  listed?: boolean;
  /**
   * The repository the publish path recorded (`packages.public_repo`, service
   * role only since migration 0025). Default for a published package: the
   * manifest's `publicRepo`; `null` = none recorded.
   */
  recordedRepo?: { owner: string; name: string } | null;
  /** The server-recorded accessibility result (`packages.a11y_status`, 0025). */
  a11y?: "pass" | "warn" | "fail" | "unknown";
}

export function manifestFor(id: string, title: string, over: Record<string, unknown> = {}) {
  return {
    schemaVersion: 2,
    packageId: id,
    title,
    description: "",
    keywords: [],
    discipline: "chemistry",
    courseContext: {},
    license: "CC-BY-4.0",
    publicRepo: { owner: "educator", name: `${id}-oer` },
    privateRepo: { owner: "educator", name: `${id}-private` },
    createdAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

export async function seedPackage(db: PGlite, seed: PackageSeed): Promise<string> {
  const id = seed.id ?? `pkg-${next()}`;
  const title = seed.title ?? `Course ${id}`;
  const storage = seed.storage ?? "github";
  const manifest = manifestFor(id, title, seed.manifest);
  if (storage === "sandbox" && !seed.manifest?.["publicRepo"]) {
    delete (manifest as Record<string, unknown>)["publicRepo"];
    delete (manifest as Record<string, unknown>)["privateRepo"];
  }
  const recorded =
    seed.recordedRepo !== undefined
      ? seed.recordedRepo
      : storage === "github"
        ? ((manifest as Record<string, unknown>)["publicRepo"] ?? null)
        : null;
  await db.query(
    `insert into public.packages (id, owner_id, title, manifest, storage, archived_at, public_repo)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [
      id,
      seed.owner,
      title,
      JSON.stringify(manifest),
      storage,
      seed.archived ? new Date().toISOString() : null,
      recorded === null ? null : JSON.stringify(recorded),
    ],
  );
  if (seed.a11y) {
    await db.query(`update public.packages set a11y_status = $2, a11y_checked_at = now() where id = $1`, [
      id,
      seed.a11y,
    ]);
  }
  if (seed.listed) await listPackage(db, id, seed.owner);
  return id;
}

export async function listPackage(db: PGlite, packageId: string, owner: string): Promise<void> {
  const { rows } = await db.query<{ title: string; manifest: Record<string, unknown> }>(
    `select title, manifest from public.packages where id = $1`,
    [packageId],
  );
  const m = rows[0]!.manifest;
  // The snapshot columns as registerPackageAction writes them.
  await db.query(
    `insert into public.portal_registrations
       (package_id, owner_id, title, description, license, public_repo_url, site_url)
     values ($1, $2, $3, '', $4, 'https://github.com/x/y', 'https://x.github.io/y/')`,
    [packageId, owner, rows[0]!.title, (m["license"] as string) ?? "CC-BY-4.0"],
  );
}

export interface DocSeed {
  packageId: string;
  docId?: string;
  repo?: "public" | "private";
  path?: string;
  space?: string;
  kind?: string;
  permalinkClass?: "document" | "object";
  description?: string | null;
  altText?: string | null;
  tags?: string[];
  license?: string | null;
  discoverable?: boolean;
  tombstoned?: boolean;
  adaptedFrom?: string | null;
  sourceHash?: string;
}

export async function seedDoc(db: PGlite, seed: DocSeed): Promise<string> {
  const docId = seed.docId ?? `doc-${next()}`;
  await db.query(
    `insert into public.documents
       (doc_id, package_id, repo, path, space, kind, source_hash, origin, description,
        alt_text, tags, license, discoverable, permalink_class, tombstoned, adapted_from)
     values ($1, $2, $3, $4, $5, $6, $7, 'created', $8, $9, $10, $11, $12, $13, $14, $15)`,
    [
      docId,
      seed.packageId,
      seed.repo ?? "public",
      seed.path ?? `assets/${docId}.svg`,
      seed.space ?? "assets",
      seed.kind ?? "svg",
      seed.sourceHash ?? "h1",
      seed.description === undefined ? "A titration curve for a weak acid" : seed.description,
      seed.altText ?? null,
      seed.tags ?? [],
      seed.license ?? null,
      seed.discoverable ?? true,
      seed.permalinkClass ?? "object",
      seed.tombstoned ?? false,
      seed.adaptedFrom ?? null,
    ],
  );
  return docId;
}

/** Run `fn` as an API role (`anon`, or `authenticated` with a user id). */
export async function asRole<T>(
  db: PGlite,
  role: "anon" | "authenticated" | "service_role",
  fn: () => Promise<T>,
  userId?: string,
): Promise<T> {
  await db.exec(`set role ${role}`);
  if (userId) await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userId]);
  try {
    return await fn();
  } finally {
    await db.exec(`reset role`);
    await db.query(`select set_config('request.jwt.claim.sub', '', false)`);
  }
}
