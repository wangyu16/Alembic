/**
 * ADVERSARIAL SWEEP (T41) — the Replace door and the workspace's slot
 * vocabulary, attacked rather than demonstrated.
 *
 * `resolveReplaceTarget` decides WHERE educator-picked bytes are written. It is
 * therefore a door in the sense of CLAUDE.md rule 1: whatever it returns is
 * handed to `writeThrough` as a path. Two properties must hold for every input,
 * including hostile ones:
 *
 *  1. **No private placement.** The resolved path must never be one the public
 *     repo would reject — and a private path must never be dressed up as a slot.
 *  2. **No slot drift.** The five chapter documents are declared by the contract
 *     slot table; the UI's own `ChapterDoc` vocabulary must map onto it exactly,
 *     and a NEW slot must be covered by this file automatically.
 *
 * Pure: contract + pure web helpers, no IO, no React.
 */

import { describe, expect, it } from "vitest";
import {
  CHAPTER_SLOTS,
  CHAPTER_SLOT_SPECS,
  assertPathAllowedInRepo,
  slotForPath,
  slotPath,
  type ChapterSlot,
} from "@alembic/package-contract";
import { placementNote, resolveReplaceTarget } from "./slot-upsert";
import {
  CHAPTER_DOCS,
  DOC_SLOT,
  SLOT_DOC,
  chapterDocPath,
  docForSlot,
  slotForDoc,
} from "../app/workspace/[packageId]/edit/nav";

const SLUG = "02-energy";

/* -------------------------------------------------------------------------- *
 * Slot drift — driven by the contract table, so a new slot is auto-covered
 * -------------------------------------------------------------------------- */

describe("SLOT DRIFT — the Replace door round-trips every declared slot", () => {
  it("the loop is not vacuous", () => {
    expect(CHAPTER_SLOTS.length).toBeGreaterThanOrEqual(5);
    expect(CHAPTER_DOCS.length).toBe(CHAPTER_SLOTS.length);
  });

  it.each(CHAPTER_SLOTS)(
    "[%s] the canonical path resolves back to an upsert into the same slot",
    (slot) => {
      const path = slotPath(slot, SLUG);
      const target = resolveReplaceTarget(path);
      expect(target).toEqual({
        path,
        mode: "upsert",
        slot,
        chapterSlug: SLUG,
        renamed: false,
      });
    },
  );

  it.each(CHAPTER_SLOTS)(
    "[%s] a differently-NAMED pick still lands on the canonical path and is reported as renamed",
    (slot) => {
      const path = slotPath(slot, SLUG);
      const target = resolveReplaceTarget(path, "my-own-file-name.md");
      expect(target.path).toBe(path);
      expect(target.mode).toBe("upsert");
      expect(target.renamed).toBe(true);
      expect(
        placementNote({ target, created: false, chapterTitle: "Energy" }),
      ).toContain(CHAPTER_SLOT_SPECS[slot].label.toLowerCase());
    },
  );

  it.each(CHAPTER_SLOTS)(
    "[%s] a leading slash / backslash / duplicated separators still resolve to the SAME canonical path",
    (slot) => {
      const canonical = slotPath(slot, SLUG);
      const spec = CHAPTER_SLOT_SPECS[slot];
      for (const variant of [
        `/${canonical}`,
        `///${canonical}`,
        canonical.replace("/", "\\"),
        `${spec.dir}\\${SLUG}${spec.extension}`,
      ]) {
        expect(resolveReplaceTarget(variant).path, variant).toBe(canonical);
        expect(resolveReplaceTarget(variant).mode, variant).toBe("upsert");
      }
    },
  );

  it.each(CHAPTER_SLOTS)(
    "[%s] the resolved path is legal in the public repo and ILLEGAL in the private one",
    (slot) => {
      const path = resolveReplaceTarget(slotPath(slot, SLUG)).path;
      expect(() => assertPathAllowedInRepo(path, "public")).not.toThrow();
      expect(() => assertPathAllowedInRepo(path, "private")).toThrow();
    },
  );

  it("the UI's ChapterDoc vocabulary is a bijection with the contract slot table", () => {
    for (const doc of CHAPTER_DOCS) expect(docForSlot(slotForDoc(doc))).toBe(doc);
    for (const slot of CHAPTER_SLOTS) expect(slotForDoc(docForSlot(slot))).toBe(slot);
    expect(new Set(Object.values(DOC_SLOT)).size).toBe(CHAPTER_SLOTS.length);
    expect(new Set(Object.values(SLOT_DOC)).size).toBe(CHAPTER_DOCS.length);
  });

  it("chapterDocPath and slotPath agree for every document (no second path builder)", () => {
    for (const doc of CHAPTER_DOCS) {
      expect(chapterDocPath(doc, SLUG)).toBe(slotPath(DOC_SLOT[doc], SLUG));
    }
  });

  it("chapterDocPath fails closed on a malformed chapter slug", () => {
    for (const doc of CHAPTER_DOCS) {
      expect(() => chapterDocPath(doc, "../escape")).toThrow();
      expect(() => chapterDocPath(doc, "Not A Slug")).toThrow();
      expect(() => chapterDocPath(doc, "")).toThrow();
    }
  });
});

/* -------------------------------------------------------------------------- *
 * The door must never manufacture a private placement
 * -------------------------------------------------------------------------- */

const PRIVATE_ATTEMPTS = [
  "private-instructor/notes/key.md",
  "private-instructor/exams/final.md",
  "private/answers.md",
  "private/exams/final.md",
  "/private-instructor/notes/key.md",
  "private-instructor\\notes\\key.md",
  "study-guide/../private-instructor/key.md",
  "../private-instructor/key.md",
];

describe("TWO-REPO — the Replace door cannot be talked into a private placement", () => {
  it.each(PRIVATE_ATTEMPTS)(
    "%s is never classified as a slot and never becomes an upsert",
    (path) => {
      expect(slotForPath(path)).toBeNull();
      const target = resolveReplaceTarget(path);
      expect(target.mode).toBe("replace-only");
      expect(target.slot).toBeNull();
      expect(target.chapterSlug).toBeNull();
      // The door does not RE-HOME the path either — it stays what it was, so the
      // downstream write-through gate is the one that rejects it (fail closed at
      // one place, not silently relocated to a public slot).
      expect(target.path.replace(/\\/g, "/").replace(/^\/+/, "")).toBe(
        path.replace(/\\/g, "/").replace(/^\/+/, ""),
      );
    },
  );

  it.each(PRIVATE_ATTEMPTS)(
    "%s is rejected by the public-repo contract check the write path then applies",
    (path) => {
      const resolved = resolveReplaceTarget(path).path;
      expect(() => assertPathAllowedInRepo(resolved, "public")).toThrow();
    },
  );

  it("a private path dressed with a slot-looking filename is still not a slot", () => {
    // `private-instructor/02-energy.md` has the slot's FILE shape but the wrong
    // directory; directory is what decides.
    const target = resolveReplaceTarget("private-instructor/02-energy.md");
    expect(target.mode).toBe("replace-only");
    expect(() => assertPathAllowedInRepo(target.path, "public")).toThrow();
  });

  it("a slot directory with a NESTED path is not a slot (no directory-prefix trust)", () => {
    for (const slot of CHAPTER_SLOTS) {
      const spec = CHAPTER_SLOT_SPECS[slot];
      const nested = `${spec.dir}/sub/${SLUG}${spec.extension}`;
      expect(slotForPath(nested)).toBeNull();
      expect(resolveReplaceTarget(nested).mode).toBe("replace-only");
    }
  });

  it("a generated surface (.md.html / .slides.html) never upserts into a source slot", () => {
    for (const slot of CHAPTER_SLOTS) {
      const spec = CHAPTER_SLOT_SPECS[slot];
      for (const ext of [".md.html", ".slides.html", ".paged.html"]) {
        const p = `${spec.dir}/${SLUG}${ext}`;
        expect(slotForPath(p), p).toBeNull();
        expect(resolveReplaceTarget(p).mode, p).toBe("replace-only");
      }
    }
  });

  it("non-slot public files keep replace-only semantics (Replace is not a create-anything door)", () => {
    for (const p of [
      "materials/diagram.png",
      "alembic.json",
      "LICENSE",
      "current/2026-spring/quiz.pdf",
      "objectives/02-energy.json",
    ]) {
      const t = resolveReplaceTarget(p);
      expect(t.mode, p).toBe("replace-only");
      expect(placementNote({ target: t, created: true })).toBeNull();
    }
  });
});

/* -------------------------------------------------------------------------- *
 * placementNote — never leaks paths or developer vocabulary
 * -------------------------------------------------------------------------- */

describe("placementNote — educator language only, no paths, no Git words", () => {
  const FORBIDDEN = [
    "commit",
    "repo",
    "repository",
    "git",
    "branch",
    "sha",
    "slot",
    "upsert",
    "path",
    "/",
  ];

  it.each(CHAPTER_SLOTS)("[%s] says where it went without naming a file path", (slot) => {
    const target = resolveReplaceTarget(slotPath(slot, SLUG), "whatever-i-called-it.md");
    for (const chapterTitle of ["Energy & Work", null, "   "]) {
      const note = placementNote({ target, created: true, chapterTitle });
      expect(note, `${slot}/${chapterTitle}`).not.toBeNull();
      const lower = note!.toLowerCase();
      for (const word of FORBIDDEN) {
        expect(lower, `${slot}: note leaked "${word}" → ${note}`).not.toContain(word);
      }
    }
  });

  it("stays silent when nothing surprising happened (same name, file already there)", () => {
    for (const slot of CHAPTER_SLOTS) {
      const canonical = slotPath(slot, SLUG);
      const picked = canonical.split("/").pop()!;
      const target = resolveReplaceTarget(canonical, picked);
      expect(placementNote({ target, created: false, chapterTitle: "Energy" })).toBeNull();
    }
  });

  it("falls back to the chapter's name when no title is known, and never to a path", () => {
    const target = resolveReplaceTarget(slotPath("slides", SLUG), "deck.md");
    const note = placementNote({ target, created: true, chapterTitle: null })!;
    expect(note).toContain(SLUG);
    expect(note).not.toContain("slides/");
  });
});

/* -------------------------------------------------------------------------- *
 * Scale — the door is a pure function, so 1200 calls must stay exact
 * -------------------------------------------------------------------------- */

describe("SCALE — resolving a whole large package's worth of paths stays exact", () => {
  it("1200 chapter-document paths each resolve to their own canonical slot", () => {
    const seen = new Set<string>();
    let n = 0;
    for (let i = 0; i < 240; i++) {
      const slug = `ch-${String(i).padStart(4, "0")}`;
      for (const slot of CHAPTER_SLOTS) {
        const canonical = slotPath(slot as ChapterSlot, slug);
        const t = resolveReplaceTarget(canonical);
        expect(t.path).toBe(canonical);
        expect(t.slot).toBe(slot);
        expect(t.chapterSlug).toBe(slug);
        seen.add(canonical);
        n++;
      }
    }
    expect(n).toBe(240 * CHAPTER_SLOTS.length);
    expect(seen.size).toBe(n); // no two slots collide on one path
  });
});
