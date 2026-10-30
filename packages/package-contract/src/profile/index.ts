/**
 * The composition root for content profiles (FD-10): the one place that
 * chooses the active profile. Core code imports `activeProfile` from here,
 * never a profile directly, so a sibling platform swaps one line.
 */
import { DEFAULT_SITE_TYPE, profileFromDefinition, siteType } from "../site-type";

export type { ContentProfile, MediaKind, PathClass, UnitPart } from "./types";
export { COURSEWERK_CONTENT_VERSION, firstStudyGuide } from "./coursewerk-oer";

/** Built from the vendored site type definition (family docs/SITE-TYPE-CONTRACT.md), through the bridge. */
export const activeProfile = (() => { const t = siteType(DEFAULT_SITE_TYPE); return profileFromDefinition(t.definition, t.files); })();

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
