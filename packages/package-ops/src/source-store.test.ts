import { describe, expect, it } from "vitest";
import { SourcePointerSchema } from "@alembic/package-contract";
import { MemorySourceStore, newSourceId, newStorageKey } from "./source-store";

describe("source ids and keys", () => {
  it("ids match the contract's pattern and are distinct", () => {
    const ids = new Set(Array.from({ length: 200 }, () => newSourceId()));
    expect(ids.size).toBe(200);
    for (const id of ids) expect(/^src_[a-z2-7]{26}$/.test(id)).toBe(true);
    expect(() => SourcePointerSchema.shape.id.parse([...ids][0])).not.toThrow();
  });
  it("storage keys carry 128 random bits under the package", () => {
    expect(newStorageKey("pkg-abc")).toMatch(/^pkg-abc\/[0-9a-f]{32}$/);
    expect(() => newStorageKey("../x")).toThrow();
  });
  it("the memory store hashes and really deletes", async () => {
    const s = new MemorySourceStore();
    s.objects.set("k", new TextEncoder().encode("abc"));
    expect((await s.stat("k"))?.sha256).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    await s.delete("k");
    expect(await s.stat("k")).toBeNull();
  });
});
