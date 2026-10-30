/**
 * K1.17 (contract v3 §0, FD-09/FD-10): course content rules live in the
 * content profile (`src/profile/`), not in the platform's core. This is a
 * ratchet. Files that held course paths or licence names before the profile
 * existed (v1/v2 code that serves production until the cut-over, and v3 code
 * not yet moved) are listed with their count. A new file may hold none, and a
 * listed file may only go down. Lower a count, or delete an entry, when code
 * moves to the profile.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "../../../..");
const SCAN = ["packages", "apps"];
// Path-shaped course literals and licence identifiers (ordinary words in UI text are fine).
const LITERAL = /["'`](?:study-guide|concepts|assessment-support|practice|slides|assets)\/|\.slides\.md|["'`]CC-BY-|["'`]CC0-1\.0/g;

function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next" || name === "dist" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) files(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

function counts(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const top of SCAN) {
    for (const pkg of readdirSync(join(ROOT, top))) {
      const src = join(ROOT, top, pkg, "src");
      try { statSync(src); } catch { continue; }
      for (const f of files(src)) {
        const rel = relative(ROOT, f);
        if (rel.includes("/src/profile/") || rel.includes("/src/site-type/")) continue; // the seam: the profile and the site type definitions (family SITE-TYPE-CONTRACT)
        const n = (readFileSync(f, "utf8").match(LITERAL) ?? []).length;
        if (n) out[rel] = n;
      }
    }
  }
  return out;
}

const BASELINE: Record<string, number> = {
  "apps/web/src/app/workspace/[packageId]/adapt-actions.ts": 2,
  "apps/web/src/app/workspace/[packageId]/chapter-nav.tsx": 1,
  "apps/web/src/app/workspace/[packageId]/edit/document-actions-bar.tsx": 4,
  "apps/web/src/app/workspace/[packageId]/edit/studio-shell.tsx": 2,
  "apps/web/src/app/workspace/[packageId]/hosted-actions.ts": 3,
  "apps/web/src/app/workspace/[packageId]/publish/page.tsx": 2,
  "apps/web/src/app/workspace/[packageId]/site-actions.ts": 3,
  "apps/web/src/app/workspace/[packageId]/site-preview/page.tsx": 2,
  "apps/web/src/app/workspace/page.tsx": 12,
  "apps/web/src/app/workspace/v3-actions.ts": 1,
  "apps/web/src/lib/course-move.ts": 5,
  "apps/web/src/lib/course-outline.ts": 1,
  "apps/web/src/lib/discovery-labels.ts": 1,
  "apps/web/src/lib/discovery-pglite.ts": 3,
  "apps/web/src/lib/repo-sim.testkit.ts": 3,
  "apps/web/src/lib/slot-upsert.ts": 1,
  "apps/web/src/lib/try/examples.ts": 6,
  "apps/web/src/lib/try/guides.ts": 6,
  "apps/worker/src/orz-site-builder.ts": 7,
  "packages/package-contract/src/adaptation.ts": 21,
  "packages/package-contract/src/assessments.ts": 3,
  "packages/package-contract/src/concepts.ts": 3,
  "packages/package-contract/src/manifest.ts": 17,
  "packages/package-contract/src/registration.ts": 1,
  "packages/package-contract/src/slots.ts": 5,
  "packages/package-contract/src/validate.ts": 9,
  "packages/package-ops/src/adaptation.ts": 4,
  "packages/package-ops/src/assessments.ts": 6,
  "packages/package-ops/src/chapters.ts": 1,
  "packages/package-ops/src/course-committer.ts": 5,
  "packages/package-ops/src/create.ts": 1,
  "packages/package-ops/src/editor-edit.ts": 3,
  "packages/package-ops/src/fork-remint.ts": 6,
  "packages/package-ops/src/incoming-text.ts": 1,
  "packages/package-ops/src/license-texts.generated.ts": 5,
  "packages/package-ops/src/metadata.ts": 4,
  "packages/package-ops/src/populate-package.ts": 1,
  "packages/package-ops/src/publish-fakes.ts": 1,
  "packages/package-ops/src/publish-job.ts": 2,
  "packages/package-ops/src/publisher.ts": 5,
  "packages/package-ops/src/reconcile.ts": 1,
  "packages/package-ops/src/release-gates.ts": 1,
  "packages/package-ops/src/slides.ts": 2,
  "packages/package-ops/src/study-guide.ts": 2,
  "packages/package-ops/src/validate-package.ts": 1
};

describe("content rules stay in the content profile (K1.17)", () => {
  it("[K1.17] no file outside the profile gains course paths or licence names; legacy files only go down", () => {
    const now = counts();
    const grown = Object.entries(now).filter(([f, n]) => n > (BASELINE[f] ?? 0)).map(([f, n]) => `${f}: ${BASELINE[f] ?? 0} → ${n}`);
    expect(grown, "move these rules into src/profile/ (or the active profile) instead").toEqual([]);
  });
});
