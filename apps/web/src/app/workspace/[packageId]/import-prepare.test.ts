/**
 * `prepareStudyGuide` is the half of `saveStudyGuide` that must happen BEFORE
 * the write path runs (T13): mint, validate, serialize — no store touched.
 * Rule 7 (block IDs immutable, never reused) is what these cases guard.
 */

import { describe, expect, it } from "vitest";
import { parseStudyGuide } from "@alembic/package-contract";
import { BlockIdIntegrityError } from "@alembic/package-ops";
import { prepareStudyGuide } from "./import-prepare";

describe("prepareStudyGuide", () => {
  it("preserves existing block IDs and mints only the missing ones", () => {
    const { blocks, content } = prepareStudyGuide({
      preamble: "# Thermochemistry",
      blocks: [
        { id: "blk-aaaaaaaaaaaa", title: "Enthalpy", body: "Kept." },
        { id: null, title: "Hess's law", body: "Imported section." },
      ],
    });

    expect(blocks[0]!.id).toBe("blk-aaaaaaaaaaaa");
    expect(blocks[1]!.id).toMatch(/^blk-[a-z0-9]{12}$/);
    // The serialized bytes are the ones the write path commits AND projects,
    // so they must round-trip to the same blocks.
    const reparsed = parseStudyGuide(content);
    expect(reparsed.blocks.map((b) => b.id)).toEqual(blocks.map((b) => b.id));
    expect(reparsed.blocks.map((b) => b.title)).toEqual(["Enthalpy", "Hess's law"]);
  });

  it("rejects duplicated block IDs instead of repairing them", () => {
    expect(() =>
      prepareStudyGuide({
        preamble: "",
        blocks: [
          { id: "blk-aaaaaaaaaaaa", title: "One", body: "" },
          { id: "blk-aaaaaaaaaaaa", title: "Two", body: "" },
        ],
      }),
    ).toThrow(BlockIdIntegrityError);
  });

  it("rejects a malformed block ID", () => {
    expect(() =>
      prepareStudyGuide({
        preamble: "",
        blocks: [{ id: "not-a-block-id", title: "One", body: "" }],
      }),
    ).toThrow(BlockIdIntegrityError);
  });

  it("touches no store — it is pure preparation", () => {
    const first = prepareStudyGuide({
      preamble: "# T",
      blocks: [{ id: "blk-bbbbbbbbbbbb", title: "A", body: "x" }],
    });
    const second = prepareStudyGuide({
      preamble: "# T",
      blocks: [{ id: "blk-bbbbbbbbbbbb", title: "A", body: "x" }],
    });
    expect(second.content).toBe(first.content);
  });
});
