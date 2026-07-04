import { describe, it, expect } from "vitest";
import {
  BUILTIN_KINDS,
  CarrierError,
  detectFormatVersion,
  embedSource,
  extractSource,
  getKind,
  getKindByExtension,
  hasCarrier,
  listKinds,
  MEDIA_KINDS,
  PAGED_KIND,
  registerKind,
  type CarrierKind,
} from "./index";

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>`;
const HTML = `<!doctype html><html><head><title>t</title></head><body><h1>hi</h1></body></html>`;

/** Build an orz-family self-contained file's island exactly as the upstream
 * runtimes do: escape ONLY `</script>` → `<\/script>`, leave other `</` raw. */
function orzSelfFile(id: string, type: string, source: string): string {
  const body = source.replace(/<\/script>/gi, "<\\/script>");
  return `<!doctype html><html><body><main>doc</main>` +
    `<script type="${type}" id="${id}">${body}</script></body></html>`;
}

describe("round-trip embed → extract", () => {
  it("recovers an SVG (ketcher) carrier byte-identical", () => {
    const source = `{"mol":"benzene","atoms":[1,2,3]}`;
    const file = embedSource({
      kind: "ketcher",
      format: 1,
      payload: "svg",
      rendered: SVG,
      source,
    });
    const out = extractSource(file);
    expect(out.source).toBe(source);
    expect(out.kind).toBe("ketcher");
    expect(out.format).toBe(1);
  });

  it("recovers an HTML (md) carrier byte-identical", () => {
    const source = `# Title\n\nSome **markdown** body.`;
    const file = embedSource({
      kind: "md",
      format: 1,
      payload: "html",
      rendered: HTML,
      source,
    });
    const out = extractSource(file);
    expect(out.source).toBe(source);
    expect(out.kind).toBe("md");
    expect(out.format).toBe(1);
  });
});

describe("island placement", () => {
  it("injects <metadata> as the first child of <svg>", () => {
    const file = embedSource({
      kind: "plot",
      format: 1,
      payload: "svg",
      rendered: SVG,
      source: "data",
    });
    const svgOpen = /<svg\b[^>]*>/i.exec(file)!;
    const afterOpen = file.slice(svgOpen.index + svgOpen[0].length);
    expect(afterOpen.startsWith(`<metadata id="orz-carrier"`)).toBe(true);
  });

  it("injects the <script> before </body>", () => {
    const file = embedSource({
      kind: "md",
      format: 1,
      payload: "html",
      rendered: HTML,
      source: "data",
    });
    const scriptIdx = file.indexOf(`<script type="application/orz-carrier+json"`);
    const bodyIdx = file.indexOf("</body>");
    expect(scriptIdx).toBeGreaterThan(-1);
    expect(scriptIdx).toBeLessThan(bodyIdx);
  });

  it("appends the <script> if there is no </body>", () => {
    const file = embedSource({
      kind: "slides",
      format: 1,
      payload: "html",
      rendered: `<div>no body tag</div>`,
      source: "x",
    });
    expect(file.endsWith(`</script>`)).toBe(true);
    expect(extractSource(file).source).toBe("x");
  });
});

describe("adversarial source", () => {
  it("SVG source containing ]]> stays valid and round-trips", () => {
    const source = `before ]]> middle ]]> after`;
    const file = embedSource({
      kind: "ketcher",
      format: 1,
      payload: "svg",
      rendered: SVG,
      source,
    });
    // No unescaped "]]>" should appear except as a legitimate CDATA close that
    // is immediately reopened (the split pattern).
    expect(file).toContain("]]]]><![CDATA[>");
    expect(extractSource(file).source).toBe(source);
  });

  it("HTML source containing </script> is escaped and round-trips", () => {
    const source = `<script>alert(1)</script> and </body> too`;
    const file = embedSource({
      kind: "md",
      format: 1,
      payload: "html",
      rendered: HTML,
      source,
    });
    // The carrier <script> must be the only literal </script> in the file (the
    // one we appended). The source's </script> is escaped to <\/script>.
    const literalCloses = file.split("</script>").length - 1;
    expect(literalCloses).toBe(1);
    expect(file).toContain("<\\/script>");
    expect(extractSource(file).source).toBe(source);
  });
});

describe("detectFormatVersion / hasCarrier", () => {
  it("returns 1 for a current carrier", () => {
    const file = embedSource({
      kind: "plot",
      format: 1,
      payload: "svg",
      rendered: SVG,
      source: "d",
    });
    expect(detectFormatVersion(file)).toBe(1);
    expect(hasCarrier(file)).toBe(true);
  });

  it("returns 0 for a legacy orz-chart-meta SVG", () => {
    const legacy = `<svg xmlns="http://www.w3.org/2000/svg"><metadata id="orz-chart-meta"><![CDATA[{"chart":"line"}]]></metadata><g/></svg>`;
    expect(detectFormatVersion(legacy)).toBe(0);
    expect(hasCarrier(legacy)).toBe(true);
  });

  it("returns null for plain SVG / HTML with no island", () => {
    expect(detectFormatVersion(SVG)).toBeNull();
    expect(detectFormatVersion(HTML)).toBeNull();
    expect(hasCarrier(SVG)).toBe(false);
  });
});

describe("legacy format-0 extraction", () => {
  // Fixture: an old orz-plot extension SVG using <metadata id="orz-chart-meta">.
  // These predate the kind/format markers and MUST remain extractable forever.
  const legacy = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 4"><metadata id="orz-chart-meta"><![CDATA[{"chart":"line","data":[1,2,3]}]]></metadata><path d="M0 0"/></svg>`;

  it("recovers the source, defaulting kind=plot, format=0", () => {
    const out = extractSource(legacy);
    expect(out.source).toBe(`{"chart":"line","data":[1,2,3]}`);
    expect(out.kind).toBe("plot");
    expect(out.format).toBe(0);
  });

  // Old .md.html used <script id="md-source"> (escaping only </script>).
  it("recovers a legacy md-source .md.html as kind=md", () => {
    const file =
      '<!doctype html><html><body><h1>x</h1>' +
      '<script type="text/markdown" id="md-source" data-orz-format="1">' +
      "# Title\n\nHas a tag: <\\/script> here.\n</script></body></html>";
    expect(detectFormatVersion(file)).toBe(1);
    const out = extractSource(file);
    expect(out.kind).toBe("md");
    expect(out.source).toContain("# Title");
    expect(out.source).toContain("</script>");
  });

  it("reads an unmarked legacy md-source island as format 0", () => {
    const file = '<html><body><script type="text/markdown" id="md-source"># Note</script></body></html>';
    expect(detectFormatVersion(file)).toBe(0);
    expect(extractSource(file).kind).toBe("md");
  });
});

describe("registry", () => {
  it("resolves by longest extension suffix", () => {
    const k = getKindByExtension("materials/plots/x.plot.svg");
    expect(k?.id).toBe("plot");
  });

  it("getKind returns built-ins", () => {
    expect(getKind("ketcher")?.extension).toBe(".ketcher.svg");
    expect(getKind("nope")).toBeUndefined();
  });

  it("listKinds includes all built-ins", () => {
    const ids = listKinds().map((k) => k.id);
    expect(ids).toEqual(expect.arrayContaining(["ketcher", "plot", "md", "slides"]));
  });

  it("BUILTIN_KINDS has the four expected kinds", () => {
    expect(BUILTIN_KINDS.map((k) => k.id)).toEqual(["ketcher", "plot", "md", "slides"]);
  });

  it("registerKind adds a new kind resolvable by extension", () => {
    const circuit: CarrierKind = {
      id: "circuit",
      role: "asset",
      extension: ".circuit.svg",
      payload: "svg",
      formatVersion: 1,
    };
    registerKind(circuit);
    expect(getKind("circuit")).toEqual(circuit);
    expect(getKindByExtension("a/b.circuit.svg")?.id).toBe("circuit");
  });
});

describe("error handling", () => {
  it("extractSource throws CarrierError when no island is present", () => {
    expect(() => extractSource(SVG)).toThrow(CarrierError);
    expect(() => extractSource(HTML)).toThrow(CarrierError);
  });
});

describe("contract v2: paged kind", () => {
  it("is registered and resolvable by extension", () => {
    expect(PAGED_KIND.id).toBe("paged");
    expect(getKind("paged")?.extension).toBe(".paged.html");
    expect(getKindByExtension("study-guide/acids.paged.html")?.id).toBe("paged");
  });

  it("does not shadow the md (.md.html) kind", () => {
    expect(getKindByExtension("study-guide/acids.md.html")?.id).toBe("md");
  });

  it("round-trips as an HTML carrier like md/slides", () => {
    const file = embedSource({
      kind: "paged",
      format: 1,
      payload: "html",
      rendered: HTML,
      source: "# Print layout",
    });
    const out = extractSource(file);
    expect(out.kind).toBe("paged");
    expect(out.source).toBe("# Print layout");
  });
});

describe("contract v2: plain-media fallback kinds", () => {
  it("resolves plain media extensions to binary asset kinds", () => {
    for (const [file, id] of [
      ["assets/figures/titration.png", "png"],
      ["assets/photo.JPG", "jpg"],
      ["assets/audio/lecture.mp3", "mp3"],
      ["assets/handout.pdf", "pdf"],
    ] as const) {
      const kind = getKindByExtension(file);
      expect(kind?.id).toBe(id);
      expect(kind?.role).toBe("asset");
      expect(kind?.payload).toBe("binary");
      expect(kind?.formatVersion).toBe(0);
    }
  });

  // The load-bearing longest-suffix case: dual-extension carriers must keep
  // winning over the plain ".svg" media kind.
  it("carriers still win longest-suffix over the plain .svg media kind", () => {
    expect(getKindByExtension("assets/mol.ketcher.svg")?.id).toBe("ketcher");
    expect(getKindByExtension("assets/fig.plot.svg")?.id).toBe("plot");
    expect(getKindByExtension("assets/logo.svg")?.id).toBe("svg");
  });

  it("BUILTIN_KINDS is unchanged; listKinds includes the v2 additions", () => {
    expect(BUILTIN_KINDS.map((k) => k.id)).toEqual(["ketcher", "plot", "md", "slides"]);
    const ids = listKinds().map((k) => k.id);
    expect(ids).toEqual(expect.arrayContaining(["paged", ...MEDIA_KINDS.map((k) => k.id)]));
  });

  it("embedSource on a binary kind throws a clear CarrierError", () => {
    expect(() =>
      embedSource({ kind: "png", format: 0, payload: "binary", rendered: "", source: "x" }),
    ).toThrow(CarrierError);
    expect(() =>
      embedSource({ kind: "png", format: 0, payload: "binary", rendered: "", source: "x" }),
    ).toThrow(/plain-media/);
  });

  it("extractSource on plain media bytes throws CarrierError (no island)", () => {
    expect(() => extractSource("\x89PNG\r\n\x1a\n…binary bytes…")).toThrow(CarrierError);
  });
});

describe("orz-family self-contained file islands (orz-src / orz-deck)", () => {
  it("extracts markdown source from an orz-src island (kind md)", () => {
    const source = "# Title\n\nBody with **bold**.\n";
    const file = orzSelfFile("orz-src", "text/markdown", source);
    const out = extractSource(file);
    expect(out.kind).toBe("md");
    expect(out.format).toBe(0);
    expect(out.source).toBe(source);
    expect(hasCarrier(file)).toBe(true);
    expect(detectFormatVersion(file)).toBe(0);
  });

  it("extracts deck source from an orz-deck island (kind slides)", () => {
    const source = "# Slide 1\n\n---\n\n# Slide 2\n";
    const file = orzSelfFile("orz-deck", "text/orz-slides", source);
    const out = extractSource(file);
    expect(out.kind).toBe("slides");
    expect(out.source).toBe(source);
  });

  it("recovers </script> while leaving other </ raw (script-only escaping)", () => {
    const source = "A </script> here, a </div> there, code `</p>`.\n";
    const file = orzSelfFile("orz-src", "text/markdown", source);
    // The stored island escaped only </script>.
    expect(file).toContain("<\\/script>");
    expect(file).toContain("</div>");
    expect(extractSource(file).source).toBe(source);
  });

  it("does NOT corrupt a literal backslash-slash in the source", () => {
    // A regex like /<\// in a code block: the bytes < \ / must survive.
    const source = "Regex: `/<\\//g` matches a close tag.\n";
    const file = orzSelfFile("orz-src", "text/markdown", source);
    expect(extractSource(file).source).toBe(source);
  });
});
