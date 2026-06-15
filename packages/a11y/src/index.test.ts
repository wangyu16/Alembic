import { describe, expect, it } from "vitest";
import { auditFragments, auditHtml } from "./index";

describe("img-alt", () => {
  it("flags an image with no alt as an error", () => {
    const report = auditHtml('<img src="diagram.png">');
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]?.rule).toBe("img-alt");
    expect(report.findings[0]?.severity).toBe("error");
    expect(report.status).toBe("fail");
  });

  it("accepts an image with a real description", () => {
    const report = auditHtml('<img src="t.png" alt="A titration curve">');
    expect(report.findings).toHaveLength(0);
    expect(report.status).toBe("pass");
  });

  it("skips an explicitly decorative image (empty alt + role=presentation)", () => {
    const report = auditHtml('<img src="line.png" alt="" role="presentation">');
    expect(report.findings).toHaveLength(0);
  });

  it("skips an explicitly decorative image (empty alt + aria-hidden)", () => {
    const report = auditHtml('<img src="line.png" alt="" aria-hidden="true">');
    expect(report.findings).toHaveLength(0);
  });

  it("warns on a bare empty alt with nothing else", () => {
    const report = auditHtml('<img src="x.png" alt="">');
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]?.rule).toBe("img-alt");
    expect(report.findings[0]?.severity).toBe("warning");
    expect(report.status).toBe("warn");
  });

  it("puts the image filename in context", () => {
    const report = auditHtml('<img src="/assets/figures/diagram.png">');
    expect(report.findings[0]?.context).toBe("diagram.png");
  });

  it("treats whitespace-only alt as an error (likely a mistake)", () => {
    const report = auditHtml('<img src="x.png" alt="   ">');
    expect(report.findings[0]?.severity).toBe("error");
  });
});

describe("heading-order", () => {
  it("flags a skip from h2 to h4", () => {
    const report = auditHtml("<h2>Kinetics</h2><h4>Rate laws</h4>");
    const ho = report.findings.filter((f) => f.rule === "heading-order");
    expect(ho).toHaveLength(1);
    expect(ho[0]?.severity).toBe("warning");
    expect(ho[0]?.context).toBe("Rate laws");
  });

  it("accepts a clean h2 -> h3 -> h2 sequence", () => {
    const report = auditHtml("<h2>A</h2><h3>A.1</h3><h2>B</h2>");
    expect(report.findings.filter((f) => f.rule === "heading-order")).toHaveLength(0);
  });

  it("does not flag a document that starts at h2", () => {
    const report = auditHtml("<h2>First section</h2><p>text</p>");
    expect(report.findings.filter((f) => f.rule === "heading-order")).toHaveLength(0);
    expect(report.status).toBe("pass");
  });

  it("does not flag going back up (h3 -> h2)", () => {
    const report = auditHtml("<h2>A</h2><h3>A.1</h3><h2>B</h2><h3>B.1</h3>");
    expect(report.findings.filter((f) => f.rule === "heading-order")).toHaveLength(0);
  });
});

describe("empty-heading", () => {
  it("flags an empty h2 as an error", () => {
    const report = auditHtml("<h2></h2>");
    const eh = report.findings.filter((f) => f.rule === "empty-heading");
    expect(eh).toHaveLength(1);
    expect(eh[0]?.severity).toBe("error");
  });

  it("flags a whitespace-only h3 as an error", () => {
    const report = auditHtml("<h3> </h3>");
    const eh = report.findings.filter((f) => f.rule === "empty-heading");
    expect(eh).toHaveLength(1);
    expect(eh[0]?.severity).toBe("error");
  });

  it("does not flag a heading that has nested markup but real text", () => {
    const report = auditHtml("<h2><strong>Equilibrium</strong></h2>");
    expect(report.findings.filter((f) => f.rule === "empty-heading")).toHaveLength(0);
  });
});

describe("link-text", () => {
  it('flags "click here"', () => {
    const report = auditHtml('<a href="/x">click here</a>');
    const lt = report.findings.filter((f) => f.rule === "link-text");
    expect(lt).toHaveLength(1);
    expect(lt[0]?.severity).toBe("warning");
  });

  it("flags a bare URL as link text", () => {
    const report = auditHtml('<a href="https://x.org">https://x.org/page</a>');
    expect(report.findings.filter((f) => f.rule === "link-text")).toHaveLength(1);
  });

  it("flags a www. bare URL", () => {
    const report = auditHtml('<a href="x">www.example.com</a>');
    expect(report.findings.filter((f) => f.rule === "link-text")).toHaveLength(1);
  });

  it("accepts descriptive link text", () => {
    const report = auditHtml('<a href="/p">the periodic table reference</a>');
    expect(report.findings.filter((f) => f.rule === "link-text")).toHaveLength(0);
  });

  it("is case-insensitive and trims", () => {
    const report = auditHtml('<a href="/x">  Read More  </a>');
    expect(report.findings.filter((f) => f.rule === "link-text")).toHaveLength(1);
  });
});

describe("table-header", () => {
  it("flags a table with td but no th", () => {
    const report = auditHtml(
      "<table><tr><td>1</td><td>2</td></tr></table>",
    );
    const th = report.findings.filter((f) => f.rule === "table-header");
    expect(th).toHaveLength(1);
    expect(th[0]?.severity).toBe("warning");
  });

  it("accepts a table that has th", () => {
    const report = auditHtml(
      "<table><tr><th>H</th></tr><tr><td>1</td></tr></table>",
    );
    expect(report.findings.filter((f) => f.rule === "table-header")).toHaveLength(0);
  });
});

describe("report shape", () => {
  it("a clean fragment passes with no findings", () => {
    const report = auditHtml(
      '<h2>Intro</h2><p>Some prose.</p><img src="t.png" alt="A diagram"><a href="/p">the syllabus</a>',
    );
    expect(report.findings).toEqual([]);
    expect(report.status).toBe("pass");
    expect(report.errorCount).toBe(0);
    expect(report.warningCount).toBe(0);
  });

  it("computes counts and status with mixed severities", () => {
    const report = auditHtml('<img src="x.png"><a href="/y">here</a>');
    expect(report.errorCount).toBe(1); // img with no alt
    expect(report.warningCount).toBe(1); // vague link
    expect(report.status).toBe("fail"); // any error => fail
  });
});

describe("auditFragments", () => {
  it("computes heading order ACROSS fragments (h2 in A, h4 in B)", () => {
    const report = auditFragments([
      { label: "Equilibrium", html: "<h2>Equilibrium</h2>" },
      { label: "Le Chatelier", html: "<h4>Shifts</h4>" },
    ]);
    const ho = report.findings.filter((f) => f.rule === "heading-order");
    expect(ho).toHaveLength(1);
    expect(ho[0]?.severity).toBe("warning");
  });

  it("does not flag heading order when fragments step down cleanly", () => {
    const report = auditFragments([
      { label: "A", html: "<h2>A</h2>" },
      { label: "B", html: "<h3>B</h3>" },
    ]);
    expect(report.findings.filter((f) => f.rule === "heading-order")).toHaveLength(0);
  });

  it("prefixes the fragment label into img/link contexts", () => {
    const report = auditFragments([
      { label: "Equilibrium", html: '<img src="rxn.png">' },
      { label: "Kinetics", html: '<a href="/x">click here</a>' },
    ]);
    const img = report.findings.find((f) => f.rule === "img-alt");
    const link = report.findings.find((f) => f.rule === "link-text");
    expect(img?.context).toBe("In “Equilibrium”: rxn.png");
    expect(link?.context).toBe("In “Kinetics”: click here");
  });

  it("does not prefix when the fragment label is empty", () => {
    const report = auditFragments([{ label: "", html: '<img src="x.png">' }]);
    expect(report.findings[0]?.context).toBe("x.png");
  });

  it("aggregates status across fragments", () => {
    const report = auditFragments([
      { label: "Clean", html: "<h2>Ok</h2><p>fine</p>" },
      { label: "Bad", html: '<img src="x.png">' },
    ]);
    expect(report.status).toBe("fail");
    expect(report.errorCount).toBe(1);
  });
});

describe("adversarial HTML", () => {
  it("handles uppercase tags and unquoted attributes (<IMG SRC=x>)", () => {
    const report = auditHtml("<IMG SRC=x>");
    expect(report.findings.filter((f) => f.rule === "img-alt")).toHaveLength(1);
    expect(report.findings[0]?.severity).toBe("error");
  });

  it("handles single quotes and odd attribute order", () => {
    const report = auditHtml("<img alt='' role='presentation' src='line.png'>");
    expect(report.findings).toHaveLength(0);
  });

  it("handles attributes in odd order for a real alt", () => {
    const report = auditHtml("<img alt='A flask' src='flask.png' width='40'>");
    expect(report.findings).toHaveLength(0);
  });

  it("handles a self-closing img tag", () => {
    const report = auditHtml('<img src="x.png" alt="A diagram" />');
    expect(report.findings).toHaveLength(0);
  });

  it("decodes entities in heading/link text", () => {
    const report = auditHtml('<a href="/x">&amp;</a>');
    // "&" is not a vague phrase, so no link-text finding.
    expect(report.findings.filter((f) => f.rule === "link-text")).toHaveLength(0);
  });
});
