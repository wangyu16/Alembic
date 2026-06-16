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
  registerKind,
  type CarrierKind,
} from "./index";

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>`;
const HTML = `<!doctype html><html><head><title>t</title></head><body><h1>hi</h1></body></html>`;

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
