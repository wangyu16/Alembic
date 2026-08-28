/**
 * Staging bucket helpers — transient intake for raw materials (zip, Word, PDF,
 * PPT) on their way into a package. See
 * docs/specs/storage-and-write-paths.md §2 and §5, and the
 * `0020_staging_bucket.sql` migration for the bucket + its RLS.
 *
 * Contract, in one line: **staging is never a home.** An object here exists
 * only between "the browser uploaded it" and "the run consumed it"; the caller
 * deletes it on success, and an operator sweep removes anything older than 24
 * hours. Nothing durable may be read from here, and no permalink may point
 * here.
 *
 * Every object is namespaced by owner: `<userId>/<uuid>-<safe-name>`. The
 * database enforces that prefix (RLS), and `assertOwnedStagingPath` enforces it
 * again in app code before any path that arrived from a client is used —
 * defence in depth, because a path is the one thing a caller can forge.
 */

/** The single staging bucket. Private; every read needs a signed URL. */
export const STAGING_BUCKET = "staging";

/** Longest sanitized filename we keep (the uuid prefix carries uniqueness). */
const MAX_NAME_LENGTH = 100;

/** Raised for any staging failure; message is educator-facing. */
export class StagingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StagingError";
  }
}

/**
 * Reduce a user-supplied filename to a flat, safe object-name component.
 *
 * Guarantees (relied on by `createStagingUploadUrl`): the result contains no
 * `/`, no `\`, no `..`, never starts with a dot, is never empty, and is capped
 * in length. Sanitizing rather than rejecting is deliberate — the original
 * name is decoration here; identity comes from the uuid.
 */
export function safeStagingName(filename: string): string {
  const base = filename.split(/[/\\]/).pop() ?? "";
  const cleaned = base
    .normalize("NFKD")
    // Drop combining marks so "réactions.pdf" stays "reactions.pdf" instead of
    // turning the accent into a separator.
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/\.{2,}/g, ".")
    .replace(/-{2,}/g, "-")
    .replace(/^[.\-]+/, "")
    .replace(/[.\-]+$/, "")
    .slice(0, MAX_NAME_LENGTH);
  return cleaned.length > 0 ? cleaned : "upload";
}

/**
 * Guard a staging path that came from (or passed through) a client.
 *
 * Pure — no IO, so it is cheap enough to call on every entry point. Throws
 * `StagingError` unless `path` is exactly `<userId>/<rest>` with a non-empty
 * `rest` and no traversal. Note the prefix test is segment-aware: for userId
 * `abc`, the path `abc2/x` is rejected (a plain `startsWith(userId)` would
 * accept it).
 */
export function assertOwnedStagingPath(path: string, userId: string): void {
  const bad = (why: string): never => {
    throw new StagingError(`That upload doesn't belong to this account (${why}).`);
  };
  if (!userId) bad("no account");
  if (typeof path !== "string" || path.length === 0) bad("empty path");
  if (path.includes("\\")) bad("bad path");
  if (path.startsWith("/")) bad("absolute path");
  // Reject percent-encoding outright: decoding games are how `..` sneaks back
  // in, and a name we minted never contains a `%`.
  if (path.includes("%")) bad("bad path");
  if (path.includes("\0")) bad("bad path");

  const segments = path.split("/");
  if (segments.length < 2) bad("bad path");
  for (const segment of segments) {
    if (segment.length === 0) bad("bad path");
    if (segment === "." || segment === "..") bad("traversal");
  }
  if (segments[0] !== userId) bad("wrong owner");
}

/**
 * Mint a one-shot signed upload URL for a new staged object.
 *
 * Returns the object `path` (store it with the job; it is what the consumer
 * later downloads), the `signedUrl` the browser PUTs to, and the `token` for
 * SDK-side `uploadToSignedUrl`.
 */
export async function createStagingUploadUrl(
  supabase: StagingClient,
  userId: string,
  filename: string,
): Promise<{ path: string; signedUrl: string; token: string }> {
  if (!userId) {
    throw new StagingError("You need to be signed in to upload a file.");
  }
  const path = `${userId}/${crypto.randomUUID()}-${safeStagingName(filename)}`;
  // Belt and braces: never hand out a path our own guard would reject.
  assertOwnedStagingPath(path, userId);

  const { data, error } = await supabase.storage
    .from(STAGING_BUCKET)
    .createSignedUploadUrl(path);
  if (error || !data) {
    throw new StagingError(
      `We couldn't start that upload. Please try again.${suffix(error)}`,
    );
  }
  return { path, signedUrl: data.signedUrl, token: data.token };
}

/**
 * Read a staged object's bytes.
 *
 * Callers MUST have run `assertOwnedStagingPath(path, userId)` on any path that
 * came from a client (RLS is the backstop, not the only gate).
 */
export async function downloadStagingObject(
  supabase: StagingClient,
  path: string,
): Promise<Uint8Array> {
  const { data, error } = await supabase.storage
    .from(STAGING_BUCKET)
    .download(path);
  if (error || !data) {
    throw new StagingError(
      `We couldn't read that uploaded file. Please upload it again.${suffix(error)}`,
    );
  }
  return new Uint8Array(await data.arrayBuffer());
}

/**
 * Delete a staged object. Idempotent from the caller's point of view: a
 * missing object is not an error, because the normal flow deletes as soon as
 * the run consumed the bytes and a retry must not fail on the second delete.
 */
export async function deleteStagingObject(
  supabase: StagingClient,
  path: string,
): Promise<void> {
  const { error } = await supabase.storage.from(STAGING_BUCKET).remove([path]);
  if (error) {
    throw new StagingError(
      `We couldn't clear up that uploaded file.${suffix(error)}`,
    );
  }
}

function suffix(error: { message?: string } | null | undefined): string {
  return error?.message ? ` (${error.message})` : "";
}

/**
 * The slice of the Supabase client these helpers use. Narrow on purpose: it
 * documents the whole surface, and a `SupabaseClient` satisfies it
 * structurally, so tests can pass a small double without casting the world.
 */
export interface StagingClient {
  storage: {
    from(bucket: string): {
      createSignedUploadUrl(
        path: string,
      ): Promise<{
        data: { signedUrl: string; token: string; path: string } | null;
        error: { message: string } | null;
      }>;
      download(
        path: string,
      ): Promise<{
        data: { arrayBuffer(): Promise<ArrayBuffer> } | null;
        error: { message: string } | null;
      }>;
      remove(
        paths: string[],
      ): Promise<{ data: unknown; error: { message: string } | null }>;
    };
  };
}
