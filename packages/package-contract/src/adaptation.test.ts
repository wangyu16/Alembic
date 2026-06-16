import { describe, expect, it } from "vitest";
import { AdaptationSourceSchema, canAdapt } from "./adaptation";
import { PackageManifestSchema } from "./manifest";

describe("canAdapt — CC compatibility", () => {
  it("CC0 source adapts into anything", () => {
    for (const t of ["CC0-1.0", "CC-BY-4.0", "CC-BY-SA-4.0", "CC-BY-NC-4.0", "CC-BY-NC-SA-4.0"] as const) {
      expect(canAdapt("CC0-1.0", t).ok).toBe(true);
    }
  });

  it("CC-BY adapts into any BY* but not CC0 (attribution must be kept)", () => {
    expect(canAdapt("CC-BY-4.0", "CC-BY-SA-4.0").ok).toBe(true);
    expect(canAdapt("CC-BY-4.0", "CC-BY-NC-4.0").ok).toBe(true);
    const r = canAdapt("CC-BY-4.0", "CC0-1.0");
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/attribution/i);
  });

  it("ShareAlike requires the same license", () => {
    expect(canAdapt("CC-BY-SA-4.0", "CC-BY-SA-4.0").ok).toBe(true);
    const r = canAdapt("CC-BY-SA-4.0", "CC-BY-4.0");
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/ShareAlike/i);
  });

  it("NonCommercial must stay NonCommercial", () => {
    expect(canAdapt("CC-BY-NC-4.0", "CC-BY-NC-SA-4.0").ok).toBe(true);
    const r = canAdapt("CC-BY-NC-4.0", "CC-BY-4.0");
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/NonCommercial/i);
  });

  it("NC-SA is locked to itself", () => {
    expect(canAdapt("CC-BY-NC-SA-4.0", "CC-BY-NC-SA-4.0").ok).toBe(true);
    expect(canAdapt("CC-BY-NC-SA-4.0", "CC-BY-NC-4.0").ok).toBe(false);
  });
});

describe("AdaptationSource + manifest lineage", () => {
  it("requires attribution on the source record", () => {
    const ok = AdaptationSourceSchema.safeParse({
      packageId: "pkg-x",
      license: "CC-BY-4.0",
      attribution: "Dr. A, Some University",
      adaptedAt: "2026-06-17T00:00:00Z",
    });
    expect(ok.success).toBe(true);
    const bad = AdaptationSourceSchema.safeParse({
      packageId: "pkg-x",
      license: "CC-BY-4.0",
      attribution: "",
      adaptedAt: "2026-06-17T00:00:00Z",
    });
    expect(bad.success).toBe(false);
  });

  it("a manifest can carry package-level adaptedFrom (additive)", () => {
    const m = PackageManifestSchema.parse({
      schemaVersion: 1,
      packageId: "pkg-y",
      title: "Adapted course",
      license: "CC-BY-SA-4.0",
      adaptedFrom: {
        packageId: "pkg-x",
        title: "Original",
        snapshot: "v1.0",
        license: "CC-BY-SA-4.0",
        attribution: "Dr. A",
      },
      createdAt: "2026-06-17T00:00:00Z",
    });
    expect(m.adaptedFrom?.packageId).toBe("pkg-x");
    // absent adaptedFrom stays valid (original work)
    const orig = PackageManifestSchema.parse({
      schemaVersion: 1,
      packageId: "pkg-z",
      title: "Original",
      license: "CC-BY-4.0",
      createdAt: "2026-06-17T00:00:00Z",
    });
    expect(orig.adaptedFrom).toBeUndefined();
  });
});
