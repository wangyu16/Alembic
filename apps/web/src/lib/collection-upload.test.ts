import { describe, expect, it } from "vitest";
import { isBinaryPath, uploadVerdict } from "./collection-upload";

const MB = 1024 * 1024;

describe("isBinaryPath — text vs binary", () => {
  it("treats the plain text extensions as text", () => {
    for (const p of [
      "notes.md",
      "readme.markdown",
      "log.txt",
      "data.csv",
      "meta.json",
      "page.html",
      "logo.svg",
    ]) {
      expect(isBinaryPath(p)).toBe(false);
    }
  });

  it("treats the compound self-contained docs as text", () => {
    for (const p of [
      "chapter.md.html",
      "deck.slides.html",
      "handout.paged.html",
      "benzene.ketcher.svg",
      "trend.plot.svg",
    ]) {
      expect(isBinaryPath(p)).toBe(false);
    }
  });

  it("treats an SVG as text (not binary)", () => {
    expect(isBinaryPath("figure.svg")).toBe(false);
    expect(isBinaryPath("board.excalidraw.svg")).toBe(false);
  });

  it("treats a PNG (and other binaries) as binary", () => {
    for (const p of [
      "photo.png",
      "photo.jpg",
      "photo.jpeg",
      "anim.gif",
      "pic.webp",
      "pic.avif",
      "report.pdf",
      "song.mp3",
      "clip.mp4",
      "clip.webm",
      "clip.mov",
      "sound.wav",
      "bundle.zip",
      "paper.docx",
      "sheet.xlsx",
      "deck.pptx",
    ]) {
      expect(isBinaryPath(p)).toBe(true);
    }
  });

  it("is case-insensitive and ignores directory dots", () => {
    expect(isBinaryPath("PHOTO.PNG")).toBe(true);
    expect(isBinaryPath("NOTES.MD")).toBe(false);
    expect(isBinaryPath("assets/v1.2/notes.md")).toBe(false);
    expect(isBinaryPath("assets/v1.2/photo.png")).toBe(true);
  });

  it("treats an unknown / extensionless file as binary", () => {
    expect(isBinaryPath("mystery.xyz")).toBe(true);
    expect(isBinaryPath("noext")).toBe(true);
  });
});

describe("uploadVerdict — storage gate", () => {
  it("blocks a binary upload on a trial (unpublished) package", () => {
    const v = uploadVerdict({ isBinary: true, isPublished: false, sizeBytes: 1 });
    expect(v.ok).toBe(false);
    expect(v.error).toMatch(/Publish this course to GitHub first/);
  });

  it("accepts a binary upload once the package is published", () => {
    const v = uploadVerdict({ isBinary: true, isPublished: true, sizeBytes: 1 });
    expect(v.ok).toBe(true);
    expect(v.error).toBeUndefined();
  });

  it("accepts a text upload on a trial package", () => {
    const v = uploadVerdict({ isBinary: false, isPublished: false, sizeBytes: 1 });
    expect(v.ok).toBe(true);
  });
});

describe("uploadVerdict — size policy", () => {
  it("passes without warning under 50 MB", () => {
    const v = uploadVerdict({ isBinary: false, isPublished: true, sizeBytes: 10 * MB });
    expect(v.ok).toBe(true);
    expect(v.warning).toBeUndefined();
  });

  it("warns but allows over 50 MB", () => {
    const v = uploadVerdict({ isBinary: true, isPublished: true, sizeBytes: 60 * MB });
    expect(v.ok).toBe(true);
    expect(v.warning).toMatch(/slow to clone/);
  });

  it("blocks over 100 MB", () => {
    const v = uploadVerdict({ isBinary: true, isPublished: true, sizeBytes: 101 * MB });
    expect(v.ok).toBe(false);
    expect(v.error).toMatch(/larger than 100 MB/);
  });

  it("boundary: exactly 50 MB does not warn; exactly 100 MB does not block", () => {
    expect(uploadVerdict({ isBinary: true, isPublished: true, sizeBytes: 50 * MB }).warning).toBeUndefined();
    expect(uploadVerdict({ isBinary: true, isPublished: true, sizeBytes: 100 * MB }).ok).toBe(true);
  });
});
