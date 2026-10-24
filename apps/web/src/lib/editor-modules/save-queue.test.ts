/**
 * Loop r5 (P5.B.3.w): a hosted editor's saves run one at a time, so a save
 * pressed again after the in-file 10 s acknowledgement wait carries the base
 * the slow first save moved forward — it lands instead of being refused as
 * stale. Modelled on the hosted editors' host-save closure (base read at the
 * call, moved forward on success) over the real write path.
 */
import { describe, expect, it } from "vitest";
import { sha256Hex } from "@alembic/package-contract";
import { MemoryPackageStore, writeThrough, type PackageRecord } from "@alembic/package-ops";
import { oneAtATime } from "./save-queue";

async function host() {
  const store = new MemoryPackageStore();
  await store.createPackage(
    { packageId: "p", ownerId: "u", title: "T", storage: "sandbox", repos: { public: null, private: null } } as unknown as PackageRecord,
    [{ repo: "public", path: "study-guide/ch1.md", content: "# One\n" }],
  );
  const baseRef = { current: (await sha256Hex("# One\n")) as string | null };
  let slow = true;
  /** The host's save: reads the base when it starts; the first is slow (a published commit). */
  const hostSave = async ({ source }: { source: string }) => {
    const base = baseRef.current;
    try {
      await writeThrough(store, null, "p", { summary: "s", changes: [{ repo: "public", path: "study-guide/ch1.md", content: source, baseHash: base }] });
      // The first save is slow to come back (a published commit, then the
      // projection): the in-file editor has given up waiting meanwhile.
      if (slow) {
        slow = false;
        await new Promise((r) => setTimeout(r, 30));
      }
      baseRef.current = await sha256Hex(source);
      return { ok: true as const };
    } catch (e) {
      return { ok: false as const, error: (e as Error).name };
    }
  };
  return { store, hostSave };
}

describe("hosted saves run one at a time (loop r5, P5.B.3.w)", () => {
  it("[P5.B.3.w] a save pressed again while a slow save runs carries the new base and lands", async () => {
    const { store, hostSave } = await host();
    const save = oneAtATime(hostSave);
    const pa = save({ source: "# One v1\n" });
    await new Promise((r) => setTimeout(r, 5));
    const [a, b] = await Promise.all([pa, save({ source: "# One v2\n" })]);
    expect(a).toEqual({ ok: true });
    expect(b).toEqual({ ok: true });
    expect(await store.readFile("p", "public", "study-guide/ch1.md")).toBe("# One v2\n");
  });

  it("[P5.B.3.w] without the queue the second save carried the stale base and was refused (the r4 behaviour, pinned)", async () => {
    const { store, hostSave } = await host();
    const first = hostSave({ source: "# One v1\n" });
    await new Promise((r) => setTimeout(r, 5)); // pressed again while the first is still running
    const b = await hostSave({ source: "# One v2\n" });
    expect(await first).toEqual({ ok: true });
    expect(b).toEqual({ ok: false, error: "FileChangedSinceOpenedError" }); // the newer text, refused as stale
    expect(await store.readFile("p", "public", "study-guide/ch1.md")).toBe("# One v1\n");
  });

  it("[P5.B.3.w] a failed save does not stop the next one; the hosted carrier uses the queue", async () => {
    const save = oneAtATime(async (n: number) => {
      if (n === 1) throw new Error("boom");
      return n;
    });
    await expect(save(1)).rejects.toThrow("boom");
    await expect(save(2)).resolves.toBe(2);
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("./hosted-carrier.ts", import.meta.url), "utf8");
    expect(src).toContain("save: oneAtATime(async ({ source, rendered, theme }");
  });
});
