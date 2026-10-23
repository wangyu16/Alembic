/**
 * P5.S.8 — Discover answers are cached for at most
 * `DISCOVERY_REVALIDATE_SECONDS` (120 s), and every owner action that changes
 * what Discover may show (list/unlist, archive/restore, share/unshare, a file
 * leaving the registry …) invalidates the `discovery` tag at once.
 *
 * Source-level invariant: the web app is scanned for every function that
 * WRITES a listability input — `portal_registrations`, `packages.archived_at`,
 * `documents.discoverable`, `documents.tombstoned` — and each such function
 * must call `discoveryChanged()`. Removing a call, or adding a new writer
 * without one, fails here.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const webSrc = join(here, "..");

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? walk(join(dir, e.name))
      : /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)
        ? [join(dir, e.name)]
        : [],
  );
}

/** Top-level functions and class methods, each with its body text. */
function functions(source: string): Array<{ name: string; body: string }> {
  const start =
    /^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+(\w+)|^ {2}(?!(?:if|for|while|switch|catch|return|await)\b)(?:async\s+)?(\w+)\s*\([^)]*\)[^;]*\{\s*$/;
  const lines = source.split("\n");
  const out: Array<{ name: string; body: string }> = [];
  let cur: { name: string; lines: string[] } | null = null;
  for (const line of lines) {
    const m = start.exec(line);
    if (m) {
      if (cur) out.push({ name: cur.name, body: cur.lines.join("\n") });
      cur = { name: (m[1] ?? m[2])!, lines: [line] };
    } else if (cur) cur.lines.push(line);
  }
  if (cur) out.push({ name: cur.name, body: cur.lines.join("\n") });
  return out;
}

/** Writes that change what the discovery views / read policy expose. */
const LISTABILITY_WRITES: Array<[string, RegExp]> = [
  ["portal_registrations write", /from\("portal_registrations"\)\s*\.(?:upsert|insert|update|delete)\(/],
  ["packages.archived_at write", /\.update\(\{[^}]*\barchived_at\s*:/],
  [
    "documents.discoverable write",
    /\.update\(\{[^}]*\bdiscoverable\b|patch[^=\n]*=\s*\{[^}]*\bdiscoverable\b|\[["']discoverable["']\]\s*=[^=]/,
  ],
  ["documents.tombstoned write", /\.update\(\{[^}]*\btombstoned\s*:\s*true/],
  // Since security loop r1 M2 the trust columns are written only through
  // lib/package-trust-writes.ts (service role): archive/restore, publish
  // (storage + recorded repo) and the accessibility record (badge, facet, rank).
  ["packages.archived_at write (server)", /\.setArchived\(/],
  ["packages.storage / public_repo write (server)", /\.recordPublished\(/],
  ["packages.a11y_status write (server)", /\.recordA11yCheck\(/],
  // Since security loop r2 (NEW-5) the listing row is written by the server.
  ["portal_registrations write (server)", /\.recordListing\(/],
];

/**
 * Writers that need no invalidation, with the reason. Trial (sandbox)
 * packages and archived packages are never in Discover, so deleting them
 * changes nothing a cached answer can show.
 */
const EXEMPT = new Map<string, string>([
  ["app/workspace/lifecycle-actions.ts#deletePackageAction", "trial packages only; never listed"],
  ["app/workspace/lifecycle-actions.ts#reconcileArchivedPackages", "archived packages only; never listed"],
  [
    "lib/package-trust-writes.ts#packageTrustWriter",
    "the server-write primitive; its callers (recordListing etc.) are scanned and invalidate",
  ],
]);

function writers(): Array<{ id: string; what: string[]; invalidates: boolean }> {
  const found: Array<{ id: string; what: string[]; invalidates: boolean }> = [];
  for (const file of walk(webSrc)) {
    const rel = relative(webSrc, file).split("\\").join("/");
    if (rel === "lib/discovery-pglite.ts") continue; // PGlite test fixture, not the app
    const source = readFileSync(file, "utf8");
    for (const fn of functions(source)) {
      const what = LISTABILITY_WRITES.filter(([, re]) => re.test(fn.body)).map(([w]) => w);
      if (what.length === 0) continue;
      found.push({ id: `${rel}#${fn.name}`, what, invalidates: /\bdiscoveryChanged\(\)/.test(fn.body) });
    }
  }
  return found;
}

describe("discovery cache invalidation", () => {
  it("[P5.S.8] every action that changes listability invalidates the discovery tag", () => {
    const all = writers();
    const ids = all.map((w) => w.id);
    // The scan sees the known owner actions (guards against a scanner that finds nothing).
    for (const known of [
      "app/workspace/[packageId]/portal-actions.ts#registerPackageAction",
      "app/workspace/[packageId]/portal-actions.ts#unregisterPackageAction",
      "app/workspace/lifecycle-actions.ts#archivePackageAction",
      "app/workspace/lifecycle-actions.ts#restorePackageAction",
      "app/workspace/[packageId]/github-actions.ts#publishToGitHubAction",
      "app/workspace/[packageId]/a11y-actions.ts#recheckA11yAction",
      "app/workspace/[packageId]/share-actions.ts#shareFileAction",
      "app/workspace/[packageId]/share-actions.ts#setAssetMetadataAction",
      "lib/document-registry-store.ts#tombstone",
      "lib/document-registry-store.ts#tombstoneMany",
    ]) {
      expect(ids, known).toContain(known);
    }
    const missing = all.filter((w) => !w.invalidates && !EXEMPT.has(w.id));
    expect(missing.map((w) => `${w.id} (${w.what.join(", ")})`)).toEqual([]);
  });

  it("[P5.S.8] the documented staleness bound is 120 s", () => {
    const cache = readFileSync(join(here, "discovery-cache.ts"), "utf8");
    expect(/DISCOVERY_REVALIDATE_SECONDS = (\d+);/.exec(cache)?.[1]).toBe("120");
    // Every cached read carries the revalidate window and the tag.
    expect(cache).toMatch(/revalidate: DISCOVERY_REVALIDATE_SECONDS,\s*tags: \[DISCOVERY_TAG\]/);
  });
});
