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
