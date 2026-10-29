/**
 * The composition root for content profiles (FD-10): the one place that
 * chooses the active profile. Core code imports `activeProfile` from here,
 * never a profile directly, so a sibling platform swaps one line.
 */
import { coursewerkOerProfile } from "./coursewerk-oer";

export type { ContentProfile, PathClass, UnitPart } from "./types";
export { COURSEWERK_CONTENT_VERSION, firstStudyGuide } from "./coursewerk-oer";

export const activeProfile = coursewerkOerProfile;

/** The part of a unit a path is, if any (exact inverse of `part.path`). */
export function unitPartForPath(path: string): { part: string; slug: string } | null {
  for (const p of activeProfile.unitParts) {
    const probe = p.path("\u0000");
    const [pre, post] = probe.split("\u0000") as [string, string];
    if (path.startsWith(pre) && path.endsWith(post)) {
      const slug = path.slice(pre.length, path.length - post.length);
      if (/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return { part: p.id, slug };
    }
  }
  return null;
}
