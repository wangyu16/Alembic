/**
 * Test-only helper: a throwaway Postgres (PGlite, Postgres compiled to WASM,
 * with pg_trgm) carrying every Supabase migration in `supabase/migrations/`,
 * plus the few Supabase objects the migrations expect (the `anon` /
 * `authenticated` / `service_role` roles with Supabase's default grants,
 * `auth.users` + `auth.uid()`, the `extensions` and `storage` schemas).
 *
 * It lets the discovery projection, its triggers, RLS and the search SQL be
 * tested for real (Phase 5 Track A) without a local Supabase. It is NOT
 * Supabase: PGlite runs a newer Postgres and a single connection, so it
 * proves behaviour and SQL shape, not performance. Never imported by app code.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";

export const MIGRATIONS_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../supabase/migrations",
);

const SUPABASE_STUB = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create schema extensions;
create schema storage;
grant usage on schema public, extensions, auth to anon, authenticated, service_role;
create table auth.users (
  id uuid primary key,
  raw_user_meta_data jsonb default '{}',
  banned_until timestamptz
);
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant execute on function auth.uid() to anon, authenticated, service_role;
create table storage.buckets (id text primary key, name text, public boolean,
  file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid, bucket_id text, name text, owner uuid);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as
  $$ select string_to_array(name, '/') $$;
-- Supabase's defaults: new public objects are granted to the API roles.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
`;

export function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

export function readMigration(name: string): string {
  return readFileSync(join(MIGRATIONS_DIR, name), "utf8");
}

/**
 * A fresh database with every migration applied, in order — or, with
 * `before`, only the migrations whose file name sorts before it (so a test can
 * seed the state an upgrade meets, then `applyMigrationsFrom(db, before)`).
 */
export async function freshDatabase(opts: { before?: string } = {}): Promise<PGlite> {
  const db = await PGlite.create({ extensions: { pg_trgm } });
  await db.exec(SUPABASE_STUB);
  const files = migrationFiles().filter((f) => opts.before === undefined || f < opts.before);
  for (const f of files) await applyMigration(db, f);
  return db;
}

/** Apply every migration whose file name sorts at or after `from`, in order. */
export async function applyMigrationsFrom(db: PGlite, from: string): Promise<void> {
  for (const f of migrationFiles().filter((n) => n >= from)) await applyMigration(db, f);
}

async function applyMigration(db: PGlite, f: string): Promise<void> {
  try {
    await db.exec(readMigration(f));
  } catch (e) {
    throw new Error(`${f}: ${(e as Error).message}`);
  }
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
  await db.query(
    `insert into public.packages (id, owner_id, title, manifest, storage, archived_at)
     values ($1, $2, $3, $4, $5, $6)`,
    [id, seed.owner, title, JSON.stringify(manifest), storage, seed.archived ? new Date().toISOString() : null],
  );
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
