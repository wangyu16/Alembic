/**
 * Bring another person's synced change into an open editor (A8; design §7.1)
 * without touching what this person changed and hasn't synced yet.
 * Three texts: `base` (the version the editor last knew), `local` (the editor
 * now), `remote` (the new version). The remote change is applied only where
 * it doesn't overlap the local change; otherwise nothing changes on screen
 * (the next sync's version rule keeps both versions).
 */
import { diffEdit } from "./kit";

export type MergeResult =
  | { applied: true; text: string }
  | { applied: false; reason: "same-place" };

export function mergeRemote(base: string, local: string, remote: string): MergeResult {
  if (remote === base || remote === local) return { applied: true, text: local };
  if (local === base) return { applied: true, text: remote };
  const r = diffEdit(base, remote)!; // base[r.from, r.to) → r.insert
  const l = diffEdit(base, local)!;
  // Overlapping or touching regions: the same place was changed on both sides.
  if (!(r.to < l.from || l.to < r.from)) return { applied: false, reason: "same-place" };
  // Apply the remote edit to the local text, shifting it past the local edit if it comes later.
  const shift = r.from > l.to ? l.insert.length - (l.to - l.from) : 0;
  const from = r.from + shift;
  const to = r.to + shift;
  return { applied: true, text: local.slice(0, from) + r.insert + local.slice(to) };
}
