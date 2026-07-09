import { describe, expect, it } from "vitest";
import { renderDocument, renderPlainDocument } from "./document";

describe("renderDocument — heading injection", () => {
  it("injects the given heading as an h1 above the content", () => {
    const html = renderDocument("Preview", "## Section 1\n\nBody.", "dark", "Module 01");
    expect(html).toContain("<h1>Module 01</h1>");
    // The h1 comes before the rendered body.
    expect(html.indexOf("<h1>Module 01</h1>")).toBeLessThan(html.indexOf("Section 1"));
  });

  it("skips the injected heading when the source already opens with its own h1", () => {
    const html = renderDocument(
      "Preview",
      "# Module 01\n\n## Section 1\n\nBody.",
      "dark",
      "Module 01",
    );
    // Exactly one h1 in the output — the source's own, not a duplicate.
    expect(html.match(/<h1[ >]/g)).toHaveLength(1);
  });

  it("still injects when the source's leading '#' is deeper (## / ###, not a real h1)", () => {
    const html = renderDocument("Preview", "## Section 1\n\nBody.", "dark", "Module 01");
    expect(html.match(/<h1[ >]/g)).toHaveLength(1);
    expect(html).toContain("<h1>Module 01</h1>");
  });

  it("renders no h1 at all when no heading is given", () => {
    const html = renderDocument("Preview", "## Section 1\n\nBody.", "dark");
    expect(html).not.toContain("<h1>");
  });
});

describe("renderPlainDocument — heading injection", () => {
  it("skips the injected heading when the source already opens with its own h1", () => {
    const html = renderPlainDocument("Preview", "# Module 01\n\nBody.", "Module 01");
    expect(html.match(/<h1[ >]/g)).toHaveLength(1);
  });

  it("injects the heading when the source has no leading h1", () => {
    const html = renderPlainDocument("Preview", "Just prose.", "Module 01");
    expect(html.match(/<h1[ >]/g)).toHaveLength(1);
    expect(html).toContain("<h1>Module 01</h1>");
  });
});
