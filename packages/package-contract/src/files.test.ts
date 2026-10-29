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
    expect(fileKind("metadata/refs.bib")).toBe("text");
    // Round 2 audit: types a browser runs scripts in are not course files.
    for (const p of ["assets/a/x.xhtml", "assets/a/x.htm", "assets/a/x.html", "assets/a/x.xml", "assets/a/x.xsl", "assets/a/x.js"]) expect(fileKind(p), p).toBeNull();
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
    // What drawing tools write: the standard document type, an embedded raster picture.
    expect(svgProblems('<?xml version="1.0"?>\n<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">\n<svg xmlns:xlink="http://www.w3.org/1999/xlink"><image xlink:href="data:image/png;base64,iVBORw0KGgo="/></svg>')).toEqual([]);
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
      // Round 1 audit H1: namespace prefixes, a comment hiding a tag, encoded and animated links, outside styles.
      '<svg><x:script xmlns:x="http://www.w3.org/2000/svg">alert(1)</x:script></svg>',
      '<svg><h:script xmlns:h="http://www.w3.org/1999/xhtml">alert(1)</h:script></svg>',
      "<svg><![CDATA[<!--]]><script>alert(1)</script><!-- -->]]></svg>",
      '<svg><a href="&#106;avascript:alert(1)"><text>x</text></a></svg>',
      '<svg><a href="java&#9;script:alert(1)"><text>x</text></a></svg>',
      '<svg><a><animate attributeName="href" values="javascript:alert(1)"/><text>x</text></a></svg>',
      '<svg><a><set attributeName="href" to="javascript:alert(1)"/></a></svg>',
      '<svg><style>@import "https://evil.example/x.css";</style></svg>',
      '<svg><image href="https:\\\\evil.example/x.png"/></svg>',
      '<svg><a xlink:href = " javascript:alert(1)"><text>x</text></a></svg>',
      '<svg><rect style="background:url(&#104;ttps://evil.example/x)"/></svg>',
      // Round 2 audit: non-ASCII prefixes, processing instructions, CSS escapes and url() in presentation attributes.
      '<svg><é:script xmlns:é="http://www.w3.org/2000/svg">alert(1)</é:script></svg>',
      '<svg><ñ:iframe xmlns:ñ="http://www.w3.org/1999/xhtml" src="javascript:alert(1)"/></svg>',
      '<?xml-stylesheet type="text/css" href="https://evil.example/x.css"?><svg/>',
      '<svg><?xml-stylesheet href="https://evil.example/x.xsl"?></svg>',
      '<svg><style>@\\69mport "https://evil.example/x.css"</style></svg>',
      '<svg><style>rect{fill:u\\72l("https://evil.example/x")}</style></svg>',
      '<svg><style>rect{background:image-set("https://evil.example/x" 1x)}</style></svg>',
      '<svg><rect fill="url(https://evil.example/p.svg#g)"/></svg>',
      '<svg><style><![CDATA[@\\000069mport "https://evil.example/x"]]></style></svg>',
      '<svg><g',
      // Round 4 audit HIGH-A: a ">" inside a DOCTYPE id moved where the check thought a comment began.
      '<!DOCTYPE svg SYSTEM "x><!--"><svg xmlns="http://www.w3.org/2000/svg"><script>alert(document.domain)</script><!-- --><svg/></svg>',
      '<!DOCTYPE svg SYSTEM "x><!--[<!ENTITY e \'<script>alert(1)</script>\'>]"><svg>&e;<!-- --><svg/></svg>',
      '<!DOCTYPE svg PUBLIC "a>" "b"><svg/>',
      '<?xml version="1.0?><!--"?><svg><script>alert(1)</script><!-- --><svg/></svg>',
      // Round 3 audit: encoded url( in presentation attributes, long character references, nested styles.
      '<svg><rect fill="u&#114;l(https://evil.example/x.svg#g)"/></svg>',
      '<svg><rect filter="url&#40;https://evil.example/f)"/></svg>',
      '<svg><a href="&#00000000104;ttps://evil.example/"><text>x</text></a></svg>',
      '<svg><use href="&#x0000000064;ata:image/svg+xml,&lt;svg/&gt;"/></svg>',
      '<svg><use href="&#000000000106;avascript:alert(1)"/></svg>',
      '<svg><style>@imp&#00000000111;rt "https://evil.example/x.css"</style></svg>',
      '<svg><style><style></style>@import "https://evil.example/x.css";</style></svg>',
    ]) expect(svgProblems(bad), bad).not.toEqual([]);
  });
  it("[K1.11] the SVG check runs in linear time: crafted input can't stall the worker (round 2 audit)", () => {
    for (const bad of ["<a".repeat(200_000), '<a "'.repeat(100_000), "<svg " + "a=".repeat(200_000), "<svg>" + "<!--".repeat(100_000), " ".repeat(1000) + "<?xml?>".repeat(60_000)]) {
      const t0 = performance.now();
      svgProblems(bad);
      expect(performance.now() - t0, `${bad.length} chars`).toBeLessThan(1500);
    }
  });
});

