import { describe, expect, it } from "vitest";
import { fileKind, isTextBytes, mediaProblems, svgProblems } from "./files";

const enc = (t: string) => new TextEncoder().encode(t);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

describe("files that aren't text (contract v3 §11.4)", () => {
  it("[K1.11] a path's kind comes from the profile's figure list; editor-made SVGs are text; anything else is refused", () => {
    expect(fileKind("assets/gases/barometer.png")).toBe("png");
    expect(fileKind("assets/a.JPG")).toBe("jpeg");
    expect(fileKind("assets/a.svg")).toBe("svg");
    expect(fileKind("assets/mol.ketcher.svg")).toBe("text");
    expect(fileKind("study-guide/gases.md")).toBe("text");
    expect(fileKind("assets/run.exe")).toBeNull();
    expect(fileKind("assets/page.pdf")).toBeNull();
  });
  it("[K1.11] bytes must be what they claim: a renamed file is refused", () => {
    expect(mediaProblems("png", PNG)).toEqual([]);
    expect(mediaProblems("jpeg", PNG)).toEqual(["it isn't a JPEG picture"]);
    expect(mediaProblems("png", enc("<svg/>"))).toEqual(["it isn't a PNG picture"]);
    expect(isTextBytes(PNG)).toBe(false);
    expect(isTextBytes(enc("Gases — PV = nRT"))).toBe(true);
  });
  it("[K1.11] an SVG with a script, an event handler, embedded content, a script link or an outside reference is refused; a plain one passes", () => {
    expect(svgProblems('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle r="4"/></svg>')).toEqual([]);
    expect(svgProblems('<?xml version="1.0"?><!-- a figure --><svg><path d="M0 0"/></svg>')).toEqual([]);
    for (const bad of [
      "<svg><script>alert(1)</script></svg>",
      '<svg onload="alert(1)"></svg>',
      "<svg><foreignObject><div/></foreignObject></svg>",
      '<svg><a href="javascript:alert(1)"><text>x</text></a></svg>',
      '<svg><image href="data:text/html;base64,PHNjcmlwdD4="/></svg>',
      '<svg><image href="https://evil.example/x.png"/></svg>',
      '<svg><rect style="fill:url(//evil.example/x)"/></svg>',
      '<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg>&x;</svg>',
      "<html><body>not a picture</body></html>",
    ]) expect(svgProblems(bad), bad).not.toEqual([]);
  });
});
