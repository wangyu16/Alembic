import { describe, expect, it } from "vitest";
import { assertPathAllowedInRepo } from "./layers";
import {
  ASSET_ID_PATTERN,
  AssetRecordSchema,
  AssetReferenceError,
  assertPublicMarkdownReferences,
  assertPublicReference,
  assetRecordPath,
  classifyReference,
  livePermalink,
  newAssetId,
  pinnedPermalink,
} from "./assets";

const validRecord = {
  assetId: "ast-abcd1234",
  path: "materials/structures/benzene.ketcher.svg",
  kind: "ketcher",
  payload: "svg" as const,
  contentHash: "deadbeef",
  altText: "A benzene ring with alternating double bonds",
  createdAt: "2026-06-16T12:00:00Z",
};

describe("AssetRecordSchema", () => {
  it("parses a valid asset record", () => {
    const record = AssetRecordSchema.parse(validRecord);
    expect(record.assetId).toBe("ast-abcd1234");
    expect(record.payload).toBe("svg");
  });

  it("rejects a missing altText (accessibility is required)", () => {
    const { altText, ...rest } = validRecord;
    void altText;
    expect(() => AssetRecordSchema.parse(rest)).toThrow();
  });

  it("rejects an empty altText", () => {
    expect(() => AssetRecordSchema.parse({ ...validRecord, altText: "" })).toThrow();
  });

  it("rejects a malformed assetId", () => {
    expect(() => AssetRecordSchema.parse({ ...validRecord, assetId: "asset-1" })).toThrow();
    expect(() => AssetRecordSchema.parse({ ...validRecord, assetId: "ast-AB" })).toThrow();
  });

  it("rejects an empty path", () => {
    expect(() => AssetRecordSchema.parse({ ...validRecord, path: "" })).toThrow();
  });

  it("rejects an unknown payload", () => {
    expect(() => AssetRecordSchema.parse({ ...validRecord, payload: "png" })).toThrow();
  });
});

describe("newAssetId", () => {
  it("generates well-formed, distinct IDs", () => {
    const ids = new Set(Array.from({ length: 500 }, () => newAssetId()));
    expect(ids.size).toBe(500);
    for (const id of ids) expect(id).toMatch(ASSET_ID_PATTERN);
  });
});

describe("assetRecordPath", () => {
  it("lives under the allowlisted .alembic dir (valid in public repo)", () => {
    const path = assetRecordPath("ast-abcd1234");
    expect(path).toBe(".alembic/assets/ast-abcd1234.json");
    expect(() => assertPathAllowedInRepo(path, "public")).not.toThrow();
  });
});

describe("assertPublicReference", () => {
  it("allows a public materials/ path", () => {
    expect(() =>
      assertPublicReference("materials/structures/x.ketcher.svg"),
    ).not.toThrow();
  });

  it("rejects a private-instructor path", () => {
    expect(() =>
      assertPublicReference("private-instructor/secret.ketcher.svg"),
    ).toThrow(AssetReferenceError);
  });

  it("allows an allowlisted root file", () => {
    expect(() => assertPublicReference("README.md")).not.toThrow();
  });
});

describe("assertPublicMarkdownReferences (two-repo boundary — adversarial)", () => {
  it("allows public materials references (image and link form)", () => {
    expect(() =>
      assertPublicMarkdownReferences("![s](materials/structures/x.ketcher.svg)"),
    ).not.toThrow();
    expect(() =>
      assertPublicMarkdownReferences("[see](materials/figures/p.plot.svg)"),
    ).not.toThrow();
  });

  it("skips external URLs, anchors, bare filenames, and chapter links", () => {
    expect(() =>
      assertPublicMarkdownReferences(
        "![x](https://example.com/a.png) [y](#sec) [z](02-acids.html) [t](mailto:a@b.c)",
      ),
    ).not.toThrow();
  });

  it("rejects a private-instructor reference in an image", () => {
    expect(() =>
      assertPublicMarkdownReferences("![key](private-instructor/answer-key.md)"),
    ).toThrow(AssetReferenceError);
  });

  it("rejects a private-instructor reference in a link", () => {
    expect(() =>
      assertPublicMarkdownReferences("Here is the [key](private-instructor/exam.md)."),
    ).toThrow(AssetReferenceError);
  });

  it("rejects a traversal reference into the private layer", () => {
    expect(() =>
      assertPublicMarkdownReferences("![k](../private-instructor/key.md)"),
    ).toThrow();
  });

  it("rejects when a private reference hides among valid public ones", () => {
    const md =
      "![ok](materials/a.ketcher.svg)\n\ntext\n\n![leak](private-instructor/k.md)\n";
    expect(() => assertPublicMarkdownReferences(md)).toThrow(AssetReferenceError);
  });

  it("allows a title-annotated public reference", () => {
    expect(() =>
      assertPublicMarkdownReferences('![s](materials/x.ketcher.svg "A structure")'),
    ).not.toThrow();
  });
});

describe("classifyReference", () => {
  it("classifies a repo-relative path as live", () => {
    expect(classifyReference("materials/structures/benzene.ketcher.svg")).toBe(
      "live",
    );
  });

  it("classifies a 40-hex raw permalink as pinned", () => {
    const sha = "a".repeat(40);
    const url = `https://raw.githubusercontent.com/owner/repo/${sha}/materials/x.ketcher.svg`;
    expect(classifyReference(url)).toBe("pinned");
  });

  it("classifies a branch raw URL as live", () => {
    const url =
      "https://raw.githubusercontent.com/owner/repo/main/materials/x.ketcher.svg";
    expect(classifyReference(url)).toBe("live");
  });

  it("classifies any other absolute URL as external", () => {
    expect(classifyReference("https://example.com/x.svg")).toBe("external");
  });
});

describe("permalink builders", () => {
  it("builds a live (branch) raw URL", () => {
    expect(
      livePermalink("materials/structures/benzene.ketcher.svg", {
        owner: "alice",
        repo: "chem",
        branch: "main",
      }),
    ).toBe(
      "https://raw.githubusercontent.com/alice/chem/main/materials/structures/benzene.ketcher.svg",
    );
  });

  it("builds a pinned (sha) raw URL", () => {
    const sha = "b".repeat(40);
    expect(
      pinnedPermalink("materials/structures/benzene.ketcher.svg", {
        owner: "alice",
        repo: "chem",
        sha,
      }),
    ).toBe(
      `https://raw.githubusercontent.com/alice/chem/${sha}/materials/structures/benzene.ketcher.svg`,
    );
  });

  it("a built pinned permalink classifies as pinned (round-trip)", () => {
    const sha = "c".repeat(40);
    const url = pinnedPermalink("materials/x.ketcher.svg", {
      owner: "o",
      repo: "r",
      sha,
    });
    expect(classifyReference(url)).toBe("pinned");
  });
});
