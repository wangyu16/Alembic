import { describe, expect, it } from "vitest";
import {
  BUILTIN_FILE_TYPES,
  CREATABLE_FILE_TYPES,
  DEFAULT_HANDLING_CLASS,
  FileTypeDefSchema,
  HANDLING_CLASSES,
  classForPath,
  fileTypeForPath,
  isInsertable,
  type FileTypeDef,
} from "./file-types";

describe("classForPath — built-in resolution", () => {
  it("maps the self-contained documents to `document`, never insertable", () => {
    for (const p of ["ch.md.html", "deck.slides.html", "print.paged.html", "raw.html"]) {
      expect(classForPath(p)).toBe("document");
    }
  });

  it("maps images / media / source to the right insertable class", () => {
    expect(classForPath("fig.svg")).toBe("insertable-image");
    expect(classForPath("photo.PNG")).toBe("insertable-image"); // case-insensitive
    expect(classForPath("clip.mp4")).toBe("insertable-media");
    expect(classForPath("audio.mp3")).toBe("insertable-media");
    expect(classForPath("notes.md")).toBe("insertable-source");
    expect(classForPath("data.csv")).toBe("insertable-source");
  });

  it("maps office/archive files to opaque-download", () => {
    for (const p of ["h.pdf", "a.zip", "d.docx", "s.xlsx"]) {
      expect(classForPath(p)).toBe("opaque-download");
    }
  });

  it("falls to opaque-download for an unknown extension — never rejects", () => {
    expect(classForPath("mystery.xyz")).toBe(DEFAULT_HANDLING_CLASS);
    expect(classForPath("noext")).toBe("opaque-download");
    expect(DEFAULT_HANDLING_CLASS).toBe("opaque-download");
  });
});

describe("classForPath — LONGEST suffix wins (compound extensions)", () => {
  it(".md.html resolves as a document, not markdown source", () => {
    // The single most important disambiguation: a study guide is a document,
    // even though it ends in the same `.md` a source file uses.
    expect(classForPath("chapter.md.html")).toBe("document");
    expect(fileTypeForPath("chapter.md.html")?.extension).toBe(".md.html");
    // and a bare .md is still source
    expect(classForPath("chapter.md")).toBe("insertable-source");
  });

  it(".ketcher.svg / .plot.svg keep their specific labels over the generic .svg", () => {
    expect(fileTypeForPath("benzene.ketcher.svg")?.label).toBe("Chemical structure");
    expect(fileTypeForPath("trend.plot.svg")?.label).toBe("Plot");
    expect(fileTypeForPath("logo.svg")?.label).toBe("Vector image");
    // all three are still the same class
    for (const p of ["benzene.ketcher.svg", "trend.plot.svg", "logo.svg"]) {
      expect(classForPath(p)).toBe("insertable-image");
    }
  });

  it("classifies roadmap compound formats via their base extension (pre-CF6)", () => {
    // No dedicated entry yet; they ride their base until their editor ships.
    expect(classForPath("board.excalidraw.svg")).toBe("insertable-image");
    expect(classForPath("mol.mol.html")).toBe("document");
    expect(classForPath("wave.sim.html")).toBe("document");
  });

  it("uses the basename only — a dotted directory doesn't fool it", () => {
    expect(classForPath("assets/v1.2/notes.md")).toBe("insertable-source");
  });
});

describe("per-package additions", () => {
  const extra: FileTypeDef[] = [
    { extension: ".geogebra", label: "GeoGebra applet", class: "opaque-download" },
    { extension: ".svg", label: "My SVG", class: "opaque-download" }, // override built-in
  ];

  it("recognizes an educator-added type", () => {
    expect(classForPath("triangle.geogebra", extra)).toBe("opaque-download");
    expect(fileTypeForPath("triangle.geogebra", extra)?.label).toBe("GeoGebra applet");
  });

  it("lets a package override a built-in at equal specificity", () => {
    // The manifest entry for .svg wins over the built-in .svg.
    expect(fileTypeForPath("x.svg", extra)?.label).toBe("My SVG");
    expect(classForPath("x.svg", extra)).toBe("opaque-download");
  });

  it("does NOT let a shorter override beat a longer built-in", () => {
    // .ketcher.svg (built-in, longer) still wins over the .svg override.
    expect(fileTypeForPath("benzene.ketcher.svg", extra)?.label).toBe("Chemical structure");
  });
});

describe("registry shape + helpers", () => {
  it("every built-in maps to a valid handling class", () => {
    for (const t of BUILTIN_FILE_TYPES) {
      expect(HANDLING_CLASSES).toContain(t.class);
      expect(t.extension.startsWith(".")).toBe(true);
    }
  });

  it("isInsertable is true only for the insertable-* classes", () => {
    expect(isInsertable("insertable-image")).toBe(true);
    expect(isInsertable("insertable-media")).toBe(true);
    expect(isInsertable("insertable-source")).toBe(true);
    expect(isInsertable("document")).toBe(false);
    expect(isInsertable("opaque-download")).toBe(false);
  });

  it("CREATABLE_FILE_TYPES is exactly the creatable built-ins", () => {
    expect(CREATABLE_FILE_TYPES.length).toBeGreaterThan(0);
    expect(CREATABLE_FILE_TYPES.every((t) => t.creatable)).toBe(true);
    // documents + .md + the two structured SVGs are creatable; raw images are not
    expect(CREATABLE_FILE_TYPES.some((t) => t.extension === ".md.html")).toBe(true);
    expect(CREATABLE_FILE_TYPES.some((t) => t.extension === ".png")).toBe(false);
  });

  it("the manifest schema rejects a bad extension or unknown class", () => {
    expect(() => FileTypeDefSchema.parse({ extension: ".foo", label: "Foo", class: "opaque-download" })).not.toThrow();
    expect(() => FileTypeDefSchema.parse({ extension: "foo", label: "Foo", class: "opaque-download" })).toThrow();
    expect(() => FileTypeDefSchema.parse({ extension: ".foo", label: "Foo", class: "made-up" })).toThrow();
  });
});
