import { describe, it, expect } from "vitest";
import type { QuestionItem, AnswerKey } from "@alembic/package-contract";
import {
  buildQti12,
  buildCommonCartridge,
  zipStore,
  crc32,
  exportCommonCartridge,
  type ExportEntry,
} from "./lms-export";

function mcqEntry(): ExportEntry {
  const item: QuestionItem = {
    id: "qi-mcq000001",
    templateId: "qt-template1",
    objectiveIds: [],
    // Stem with characters that MUST be XML-escaped.
    stem: "Is 1 < 2 & true?",
    choices: ["yes", "no", "maybe"],
  };
  const key: AnswerKey = {
    itemId: "qi-mcq000001",
    answer: "yes",
    rationale: "because 1 is less than 2",
  };
  return { item, key };
}

function openEntry(): ExportEntry {
  const item: QuestionItem = {
    id: "qi-open000001",
    templateId: "qt-template1",
    objectiveIds: [],
    stem: "Explain entropy.",
    choices: [],
  };
  const key: AnswerKey = {
    itemId: "qi-open000001",
    answer: "Entropy is a measure of disorder.",
    rationale: "",
  };
  return { item, key };
}

describe("buildQti12 (MCQ)", () => {
  const xml = buildQti12({ title: "Quiz 1", items: [mcqEntry()] });

  it("includes the stem, escaped", () => {
    expect(xml).toContain("Is 1 &lt; 2 &amp; true?");
    // The raw, unescaped form must not appear.
    expect(xml).not.toContain("Is 1 < 2 & true?");
  });

  it("lists every choice", () => {
    expect(xml).toContain(">yes<");
    expect(xml).toContain(">no<");
    expect(xml).toContain(">maybe<");
  });

  it("marks the choice equal to the answer as correct with a positive score", () => {
    // "yes" is index 0 -> ident C0
    expect(xml).toContain('<varequal respident="RESPONSE_0">C0</varequal>');
    expect(xml).toContain('<setvar action="Set" varname="SCORE">100</setvar>');
  });

  it("falls back to the first choice when no choice matches the answer", () => {
    const entry = mcqEntry();
    entry.key.answer = "nonexistent";
    const x = buildQti12({ title: "Q", items: [entry] });
    expect(x).toContain('<varequal respident="RESPONSE_0">C0</varequal>');
    // Answer still surfaced in feedback.
    expect(x).toContain("nonexistent");
  });
});

describe("buildQti12 (open response)", () => {
  const xml = buildQti12({ title: "Quiz 2", items: [openEntry()] });

  it("renders a response_str", () => {
    expect(xml).toContain("<response_str");
  });

  it("includes the model answer in feedback", () => {
    expect(xml).toContain("Entropy is a measure of disorder.");
  });
});

describe("buildCommonCartridge", () => {
  const files = buildCommonCartridge({ title: "My <Quiz>", items: [mcqEntry()] });

  it("returns a manifest that references the QTI file plus the QTI file", () => {
    const manifest = files.find((f) => f.path === "imsmanifest.xml");
    const qti = files.find((f) => f.path === "assessment_qti.xml");
    expect(manifest).toBeDefined();
    expect(qti).toBeDefined();
    expect(manifest!.content).toContain('href="assessment_qti.xml"');
    expect(manifest!.content).toContain(
      'type="imsqti_xmlv1p2/imscc_xmlv1p1/assessment"',
    );
  });

  it("escapes the title", () => {
    const manifest = files.find((f) => f.path === "imsmanifest.xml")!;
    expect(manifest.content).toContain("My &lt;Quiz&gt;");
  });
});

describe("crc32", () => {
  const e = new TextEncoder();
  it("is 0 for the empty input", () => {
    expect(crc32(e.encode(""))).toBe(0x00000000);
  });
  it('matches the known value for "hello"', () => {
    expect(crc32(e.encode("hello"))).toBe(0x3610a686);
  });
});

describe("zipStore", () => {
  const files = [
    { path: "imsmanifest.xml", content: "<manifest/>" },
    { path: "assessment_qti.xml", content: "<questestinterop/>" },
  ];
  const zip = zipStore(files);

  it("starts with the local-file-header signature PK\\x03\\x04", () => {
    expect([zip[0], zip[1], zip[2], zip[3]]).toEqual([0x50, 0x4b, 0x03, 0x04]);
  });

  it("contains the end-of-central-directory signature PK\\x05\\x06", () => {
    let found = false;
    for (let i = 0; i + 3 < zip.length; i++) {
      if (
        zip[i] === 0x50 &&
        zip[i + 1] === 0x4b &&
        zip[i + 2] === 0x05 &&
        zip[i + 3] === 0x06
      ) {
        found = true;
        break;
      }
    }
    expect(found).toBe(true);
  });

  it("contains each file's path bytes", () => {
    const decoder = new TextDecoder();
    const text = decoder.decode(zip);
    expect(text).toContain("imsmanifest.xml");
    expect(text).toContain("assessment_qti.xml");
  });

  it("records a central-directory entry count equal to the number of files", () => {
    // Locate the EOCD signature and read the total-entries field (offset +10).
    let eocd = -1;
    for (let i = 0; i + 3 < zip.length; i++) {
      if (
        zip[i] === 0x50 &&
        zip[i + 1] === 0x4b &&
        zip[i + 2] === 0x05 &&
        zip[i + 3] === 0x06
      ) {
        eocd = i;
        break;
      }
    }
    expect(eocd).toBeGreaterThanOrEqual(0);
    const totalEntries = zip[eocd + 10]! | (zip[eocd + 11]! << 8);
    expect(totalEntries).toBe(files.length);
  });
});

describe("exportCommonCartridge", () => {
  it("returns a non-empty zip beginning with the zip signature", () => {
    const zip = exportCommonCartridge({ title: "Quiz", items: [mcqEntry()] });
    expect(zip.length).toBeGreaterThan(0);
    expect([zip[0], zip[1], zip[2], zip[3]]).toEqual([0x50, 0x4b, 0x03, 0x04]);
  });
});
