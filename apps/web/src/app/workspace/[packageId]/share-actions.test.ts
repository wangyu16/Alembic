/**
 * P5.R.2 (owner ruling 2026-10-23) — "Share this" is not offered in a trial
 * course and returns once the course is published. The UI hides the control
 * (`canOfferShare`); the server actions refuse to make a trial course's file
 * discoverable (defence in depth).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const state = {
  storage: "sandbox" as string,
  row: {
    doc_id: "doc-1",
    package_id: "pkg-1",
    space: "assets",
    kind: "image",
    permalink_class: "object",
    description: "A benzene ring",
    discoverable: false,
    tombstoned: false,
  } as Record<string, unknown>,
  updates: [] as Array<Record<string, unknown>>,
};

function query(table: string) {
  const q = {
    select: () => q,
    eq: () => q,
    maybeSingle: async () =>
      table === "documents"
        ? { data: state.row, error: null }
        : table === "packages"
          ? { data: { storage: state.storage }, error: null }
          : { data: null, error: null },
    update: (patch: Record<string, unknown>) => {
      state.updates.push(patch);
      const chain = { eq: () => chain, then: (r: (v: { error: null }) => void) => r({ error: null }) };
      return chain;
    },
  };
  return q;
}

vi.mock("next/navigation", () => ({ redirect: vi.fn(() => { throw new Error("redirect"); }) }));
vi.mock("@/lib/discovery-cache", () => ({ discoveryChanged: vi.fn() }));
vi.mock("@/lib/record-discovery-event", () => ({ recordDiscoveryEvent: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
    from: (table: string) => query(table),
  }),
}));

const { shareFileAction, setAssetMetadataAction } = await import("./share-actions");
const { canOfferShare, SHARE_NEEDS_PUBLISH } = await import("@/lib/share-policy");

beforeEach(() => {
  state.storage = "sandbox";
  state.row = { ...state.row, discoverable: false };
  state.updates = [];
});

describe("sharing in a trial course", () => {
  it("[P5.R.2] the server actions refuse to share a file of a trial course", async () => {
    const a = await shareFileAction("pkg-1", "doc-1", true);
    expect(a.ok).toBe(false);
    expect(a.error).toBe(SHARE_NEEDS_PUBLISH);
    const b = await setAssetMetadataAction("pkg-1", "doc-1", { description: "x", discoverable: true });
    expect(b.ok).toBe(false);
    expect(b.error).toBe(SHARE_NEEDS_PUBLISH);
    expect(state.updates.some((u) => u["discoverable"] === true)).toBe(false);
    // Plain language, no developer vocabulary.
    expect(SHARE_NEEDS_PUBLISH).toBe("Sharing is available once the course is published.");
  });

  it("[P5.R.2] a trial course can still save metadata (and unshare) without the share control", async () => {
    const r = await setAssetMetadataAction("pkg-1", "doc-1", { description: "Benzene", tags: ["ring"] });
    expect(r.ok).toBe(true);
    expect(state.updates.at(-1)).not.toHaveProperty("discoverable");
    const off = await shareFileAction("pkg-1", "doc-1", false);
    expect(off.ok).toBe(true);
  });

  it("[P5.R.2] sharing returns once the course is published", async () => {
    state.storage = "github";
    const r = await shareFileAction("pkg-1", "doc-1", true);
    expect(r).toEqual({ ok: true, permalink: "/d/doc-1" });
    const m = await setAssetMetadataAction("pkg-1", "doc-1", { discoverable: true });
    expect(m.ok).toBe(true);
    expect(state.updates.at(-1)).toMatchObject({ discoverable: true });
  });

  it("[P5.R.2] the share control is offered only for a published course", () => {
    expect(canOfferShare("github")).toBe(true);
    for (const s of ["sandbox", "trial", "", null, undefined]) expect(canOfferShare(s)).toBe(false);
  });

  it("[P5.R.2] the workspace shows the share control only when canOfferShare allows it", () => {
    const edit = join(dirname(fileURLToPath(import.meta.url)), "edit");
    const page = readFileSync(join(edit, "page.tsx"), "utf8");
    expect(page).toMatch(/canShare=\{canOfferShare\(record\.storage\)\}/);
    const view = readFileSync(join(edit, "assets-collection-view.tsx"), "utf8");
    // The one share control (the Discoverable checkbox) sits in the canShare
    // branch; the trial branch shows the plain-language note instead.
    const gate = view.indexOf("{canShare ? (");
    const control = view.indexOf("Discoverable — others can find");
    const note = view.indexOf("{SHARE_NEEDS_PUBLISH}");
    expect(gate).toBeGreaterThan(-1);
    expect(control).toBeGreaterThan(gate);
    expect(note).toBeGreaterThan(control);
    expect(view.match(/type="checkbox"/g)?.length).toBe(1);
    // A trial save leaves sharing alone instead of sending the flag.
    expect(view).toMatch(/\.\.\.\(canShare \? \{ discoverable \} : \{\}\)/);
  });
});
