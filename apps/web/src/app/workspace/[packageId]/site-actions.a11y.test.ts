/**
 * Closed loop r5 — LOW (P5.R.5.i): the published site's schema.org
 * accessibility metadata follows the server's own CURRENT check
 * (`packages.a11y_status`, owner decision 2 of 2026-10-24), not the
 * owner-written `manifest.accessibility`, which is no longer refreshed for a
 * published course. Not checked → the site says nothing about accessibility.
 * The action runs; the session, stores, page generation and push are doubles.
 */
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  serverStatus: "unknown" as unknown,
  manifestStatus: "pass" as string | undefined,
  meta: [] as Array<Record<string, unknown>>,
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: () => { throw new Error("redirect"); } }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "u-1" } }, error: null }) },
    from: (table: string) => {
      if (table !== "packages") throw new Error(`unexpected table ${table}`);
      const q = {
        select: () => q,
        eq: () => q,
        maybeSingle: async () => ({ data: { a11y_status: mocks.serverStatus }, error: null }),
      };
      return q;
    },
  }),
}));
vi.mock("@/lib/sandbox-store", () => ({
  SupabaseSandboxStore: class {
    async getPackage() {
      return {
        packageId: "pkg-a",
        title: "Course",
        storage: "github",
        repos: { public: { owner: "ed", name: "course" } },
        manifest: {
          schemaVersion: 2,
          packageId: "pkg-a",
          title: "Course",
          license: "CC-BY-4.0",
          ...(mocks.manifestStatus
            ? { accessibility: { status: mocks.manifestStatus, errorCount: 0, warningCount: 0, checkedAt: "2026-01-01T00:00:00Z" } }
            : {}),
        },
      };
    }
    async listFiles() {
      return [];
    }
  },
}));
vi.mock("@alembic/package-ops", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@alembic/package-ops")>()),
  releaseGates: async () => ({ ok: true, checks: [] }),
  backfillLicenseFile: async () => {},
  listChapters: async () => [{ slug: "01", title: "One", path: "study-guide/01.md" }],
  loadStudyGuide: async (_s: unknown, _p: unknown, path: string) =>
    path.startsWith("study-guide/")
      ? { preamble: "", blocks: [{ id: "blk-aaaaaaaa1", title: "Intro", body: "Text." }] }
      : { preamble: "", blocks: [] },
  loadSlidesDeck: async () => ({ source: "" }),
}));
vi.mock("@/lib/events", () => ({ supabaseEventLogger: () => ({ log: async () => {} }) }));
vi.mock("@/lib/github", () => ({
  clientForUser: async () => ({ client: { enablePages: async () => ({ url: "https://ed.github.io/course/" }) } }),
}));
vi.mock("@/lib/committer", () => ({ committerFor: async () => ({ kind: "unavailable", reason: "x" }) }));
vi.mock("@/lib/app-url", () => ({ appBaseUrl: () => null }));
vi.mock("@/lib/document-registry-store", () => ({ SupabaseDocumentRegistryStore: class {} }));
vi.mock("@/lib/theme", () => ({ getRenderTheme: async () => "light" }));
vi.mock("@/lib/worker-client", () => ({ generateSelfContainedFile: async () => "<html></html>" }));
vi.mock("@/lib/doc-metadata", () => ({ docMetaForPackage: () => ({}) }));
vi.mock("@/lib/site-publish", () => ({
  PAGES_BRANCH: "gh-pages",
  courseSiteFiles: (input: { meta: Record<string, unknown> }) => {
    mocks.meta.push(input.meta);
    return [{ path: "index.html", content: "<html></html>" }];
  },
  pushCourseSite: async () => {},
}));

// eslint-disable-next-line import/first -- after vi.mock (hoisted)
import { publishSiteAction } from "./site-actions";

async function published(server: unknown, manifest: string | undefined) {
  mocks.serverStatus = server;
  mocks.manifestStatus = manifest;
  mocks.meta = [];
  const r = await publishSiteAction("pkg-a");
  expect(r.ok, r.error).toBe(true);
  expect(mocks.meta).toHaveLength(1);
  return mocks.meta[0]!;
}

describe("the published site's accessibility metadata follows the server's check (P5.R.5.i)", () => {
  it("[P5.R.5.i] the site carries the server's current check; with no current check it omits accessibility, whatever the manifest says", async () => {
    // The manifest says pass, the server has no current check: say nothing.
    expect(await published("unknown", "pass")).not.toHaveProperty("accessibility");
    expect(await published(null, "pass")).not.toHaveProperty("accessibility");
    // The manifest says pass, the server's check failed: the failure, never pass.
    expect((await published("fail", "pass"))["accessibility"]).toBe("fail");
    // The server's pass is used even when the manifest has nothing (or is stale).
    expect((await published("pass", undefined))["accessibility"]).toBe("pass");
    expect((await published("warn", "fail"))["accessibility"]).toBe("warn");
    // Anything else in the column is not a check.
    expect(await published("bogus", "pass")).not.toHaveProperty("accessibility");
  });
});
