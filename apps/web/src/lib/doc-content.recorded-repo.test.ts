/**
 * Security loop r2, NEW-1 (claim P5.S.3.e): the bytes `/d`, server-side
 * includes and element adaptation serve for a published package come from the
 * repository the PUBLISH PATH recorded (`packages.public_repo`), never from
 * the owner-writable `manifest.publicRepo`. Repro (round-2 audit): an owner
 * PATCHes only `manifest` (a granted column) to name another educator's repo;
 * `/d/{their own docId}` then served the victim's bytes under the attacker's
 * course, licence and attribution.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("server-only", () => ({}));

import { fetchDocBytes } from "./doc-content";

function dbWith(row: Record<string, unknown>, sandbox: string | null = null): SupabaseClient {
  return {
    from: (table: string) => ({
      select: () => {
        const q = {
          eq: () => q,
          maybeSingle: async () =>
            table === "packages" ? { data: row } : { data: sandbox === null ? null : { content: sandbox } },
        };
        return q;
      },
    }),
  } as unknown as SupabaseClient;
}

afterEach(() => vi.unstubAllGlobals());

function stubFetch(urls: string[]) {
  vi.stubGlobal("fetch", async (u: string) => {
    urls.push(String(u));
    return new Response(String(u).includes("/victim/") ? "VICTIM BYTES" : "OWN BYTES", { status: 200 });
  });
}

describe("P5.S.3.e /d bytes come from the publish-recorded repository", () => {
  it("[P5.S.3.e] a manifest re-pointed at another educator's repo does not change where /d reads", async () => {
    const urls: string[] = [];
    stubFetch(urls);
    const row = {
      storage: "github",
      public_repo: { owner: "attacker", name: "a-oer" },
      manifest: { license: "CC0-1.0", publicRepo: { owner: "victim", name: "victim-oer" } },
    };
    const bytes = await fetchDocBytes(dbWith(row), { package_id: "pkg-a", repo: "public", path: "assets/fig.svg" });
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain("/attacker/a-oer/");
    expect(urls[0]).not.toContain("victim");
    expect(bytes?.toString()).toBe("OWN BYTES");
  });

  it("[P5.S.3.e] a published package with no recorded repo reads no repository at all (only its own stored copy)", async () => {
    const urls: string[] = [];
    stubFetch(urls);
    const row = { storage: "github", public_repo: null, manifest: { publicRepo: { owner: "victim", name: "victim-oer" } } };
    const bytes = await fetchDocBytes(dbWith(row, "stored copy"), {
      package_id: "pkg-a",
      repo: "public",
      path: "notes/a.md",
    });
    expect(urls).toEqual([]);
    expect(bytes?.toString()).toBe("stored copy");
  });
});
