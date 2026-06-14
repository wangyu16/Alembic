import { describe, expect, it } from "vitest";
import {
  formatBlock,
  parseStudyGuide,
  serializeStudyGuide,
  type StudyGuideBlock,
} from "./block-source";

describe("parseStudyGuide", () => {
  it("splits H2-bounded blocks and extracts IDs", () => {
    const source = `# Thermochemistry

intro line

## Energy and Heat{{attrs[#blk-aaaaaaaa]}}

Heat flows.

## Enthalpy{{attrs[#blk-bbbbbbbb]}}

$\\Delta H$ is enthalpy.
`;
    const { preamble, blocks } = parseStudyGuide(source);
    expect(preamble).toBe("# Thermochemistry\n\nintro line");
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toEqual({
      id: "blk-aaaaaaaa",
      title: "Energy and Heat",
      body: "Heat flows.",
    });
    expect(blocks[1]?.id).toBe("blk-bbbbbbbb");
    expect(blocks[1]?.title).toBe("Enthalpy");
  });

  it("treats a heading without a marker as id: null", () => {
    const { blocks } = parseStudyGuide("## New Section\n\nbody");
    expect(blocks[0]?.id).toBeNull();
    expect(blocks[0]?.title).toBe("New Section");
  });

  it("keeps H3 sub-headings inside the section body", () => {
    const { blocks } = parseStudyGuide(
      "## Parent{{attrs[#blk-cccccccc]}}\n\n### Child\n\ntext",
    );
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.body).toBe("### Child\n\ntext");
  });

  it("does not split on ## inside a fenced code block", () => {
    const source = `## Real Heading{{attrs[#blk-dddddddd]}}

\`\`\`
## not a heading
\`\`\`

after
`;
    const { blocks } = parseStudyGuide(source);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.body).toContain("## not a heading");
  });

  it("ignores a malformed ID marker (treats block as unidentified)", () => {
    const { blocks } = parseStudyGuide("## Bad{{attrs[#blk-XYZ]}}\n\nbody");
    expect(blocks[0]?.id).toBeNull();
  });
});

describe("serializeStudyGuide / formatBlock", () => {
  const blocks: StudyGuideBlock[] = [
    { id: "blk-aaaaaaaa", title: "Energy", body: "Heat flows." },
    { id: "blk-bbbbbbbb", title: "Enthalpy", body: "$\\Delta H$" },
  ];

  it("formats a block with the canonical marker", () => {
    expect(formatBlock(blocks[0]!)).toBe(
      "## Energy{{attrs[#blk-aaaaaaaa]}}\n\nHeat flows.",
    );
  });

  it("omits the marker for an unidentified block", () => {
    expect(formatBlock({ id: null, title: "Draft", body: "x" })).toBe(
      "## Draft\n\nx",
    );
  });

  it("round-trips: parse → serialize → parse is stable", () => {
    const source = serializeStudyGuide("# Title", blocks);
    const reparsed = parseStudyGuide(source);
    const reserialized = serializeStudyGuide(reparsed.preamble, reparsed.blocks);
    expect(reserialized).toBe(source);
    expect(reparsed.blocks).toEqual(blocks);
  });

  it("preserves IDs across an edit to title and body", () => {
    const source = serializeStudyGuide("", blocks);
    const { blocks: parsed } = parseStudyGuide(source);
    parsed[0]!.title = "Energy and Heat (revised)";
    parsed[0]!.body = "Completely rewritten.";
    const out = parseStudyGuide(serializeStudyGuide("", parsed));
    expect(out.blocks[0]?.id).toBe("blk-aaaaaaaa");
  });
});
