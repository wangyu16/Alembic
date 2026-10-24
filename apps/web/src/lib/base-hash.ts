/**
 * The "base" of an editor save (loop r4, P5.B.3.m): the SHA-256 (hex, of the
 * UTF-8 text) of the stored copy an editor opened — the same digest the store
 * keeps as `content_sha256`. The editor sends it with each save; the write
 * path refuses the save if the stored copy has moved on since (another tab,
 * or an outside change brought in), so a stale editor never silently
 * overwrites a newer version.
 *
 * Client-safe (Web Crypto). `null` = the file did not exist when opened.
 * `undefined` = unknown (no Web Crypto here): the save then goes unchecked,
 * as before r4, rather than failing.
 */
import { sha256Hex } from "@alembic/package-contract";

export async function baseHashOf(content: string | null): Promise<string | null | undefined> {
  if (content === null) return null;
  try {
    return await sha256Hex(content);
  } catch {
    return undefined;
  }
}

/**
 * A file an editor opens, with the base its saves are checked against (loop
 * r5, P5.B.3.p). The base comes from the file's REAL existence — `raw ===
 * null` — computed where the file was read, never from what the editor shows.
 * Before r5 the concept map / assessment guide editor derived "is there a
 * file" from `content.trim()`, so an existing whitespace-only or empty file
 * was opened with base "no file" and every save of it was refused ("changed
 * since you opened it"), on a published and a trial course alike.
 */
export interface OpenedFile {
  path: string;
  repo: "public" | "private";
  /** What the editor shows ("" for a file that does not exist yet). */
  content: string;
  /** Does the file exist (even empty)? */
  exists: boolean;
  /** SHA-256 of the stored text; null = no file (a save creates it). */
  baseHash: string | null;
}

export async function openedFile(
  path: string,
  repo: "public" | "private",
  raw: string | null,
): Promise<OpenedFile> {
  return {
    path,
    repo,
    content: raw ?? "",
    exists: raw !== null,
    baseHash: raw === null ? null : await sha256Hex(raw),
  };
}
