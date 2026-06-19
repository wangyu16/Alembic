/**
 * Course/chapter description metadata (editor-overhaul Phase 1, guardrail G6).
 *
 * `metadata/course.md` is the **single source of truth** for the human/AI
 * course description. `manifest.description` — which feeds the LRMI JSON and the
 * portal/Discover record — is **derived** from it (a plain-text summary) on
 * save, so the three never drift. The `.md` file is prose (no `{{attrs[#…]}}`
 * block IDs), so it stays outside the block-ID/reconcile machinery.
 */

import {
  assertPathAllowedInRepo,
  parseManifest,
  type PackageManifest,
} from "@alembic/package-contract";
import type { PackageStore } from "./store";

const MANIFEST_PATH = "alembic.json";

/** Canonical course-description file (markdown, public `metadata` layer). */
export const COURSE_DESCRIPTION_PATH = "metadata/course.md";

/** Per-chapter description file. */
export function chapterDescriptionPath(slug: string): string {
  return `metadata/${slug}.md`;
}

/** Max length of the derived plain-text description (LRMI/portal summary). */
const DESCRIPTION_MAX = 300;

/**
 * Derive a plain-text summary from a markdown description — the first real
 * paragraph, with inline markdown stripped, collapsed and capped. Pure; no IO.
 * This is what becomes `manifest.description` (→ LRMI + portal).
 */
export function deriveDescription(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const para: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (para.length === 0) {
      // Skip leading blanks, ATX headings, HTML comments, and image-only lines.
      if (!t || t.startsWith("#") || t.startsWith("<!--") || /^!\[[^\]]*\]\([^)]*\)$/.test(t)) {
        continue;
      }
      para.push(t);
    } else {
      if (!t) break; // paragraph ends at the first blank line
      para.push(t);
    }
  }
  const text = para
    .join(" ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "") // images → drop
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // links → text
    .replace(/`([^`]*)`/g, "$1") // inline code → content
    .replace(/[*_~]+/g, "") // emphasis markers
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= DESCRIPTION_MAX) return text;
  return text.slice(0, DESCRIPTION_MAX).replace(/\s+\S*$/, "") + "…";
}

async function readManifest(
  store: PackageStore,
  packageId: string,
): Promise<{ manifest: PackageManifest }> {
  const files = await store.listFiles(packageId);
  const file = files.find((f) => f.repo === "public" && f.path === MANIFEST_PATH);
  if (!file) {
    throw new Error(`Manifest (${MANIFEST_PATH}) not found for package ${packageId}`);
  }
  return { manifest: parseManifest(JSON.parse(file.content)) };
}

/** The current course description markdown (canonical), or null if unset. */
export async function loadCourseDescription(
  store: PackageStore,
  packageId: string,
): Promise<string | null> {
  const files = await store.listFiles(packageId);
  const file = files.find(
    (f) => f.repo === "public" && f.path === COURSE_DESCRIPTION_PATH,
  );
  return file?.content ?? null;
}

/**
 * Set the canonical course description: write `metadata/course.md` and **derive**
 * `manifest.description` from it (keeping LRMI + portal in step). Returns the
 * updated manifest so the caller can refresh the projection row and mirror to
 * GitHub. The markdown is the source of truth; never hand-edit
 * `manifest.description` independently.
 */
export async function setCourseDescription(
  store: PackageStore,
  packageId: string,
  markdown: string,
): Promise<{ manifest: PackageManifest; description: string }> {
  const { manifest } = await readManifest(store, packageId);
  const description = deriveDescription(markdown);
  const updated: PackageManifest = { ...manifest, description };

  assertPathAllowedInRepo(COURSE_DESCRIPTION_PATH, "public");
  assertPathAllowedInRepo(MANIFEST_PATH, "public");
  await store.putFiles(packageId, [
    { repo: "public", path: COURSE_DESCRIPTION_PATH, content: markdown },
    {
      repo: "public",
      path: MANIFEST_PATH,
      content: JSON.stringify(updated, null, 2) + "\n",
    },
  ]);

  return { manifest: updated, description };
}
