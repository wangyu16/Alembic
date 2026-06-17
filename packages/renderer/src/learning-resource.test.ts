import { describe, expect, it } from "vitest";
import { learningResource, learningResourceJsonLd } from "./learning-resource";

describe("learningResource", () => {
  it("builds a schema.org LearningResource with the license URL", () => {
    const ld = learningResource({
      name: "Thermodynamics",
      description: "An intro course.",
      license: "CC-BY-SA-4.0",
      discipline: "chemistry",
      educationalLevel: "undergraduate",
      url: "https://example.github.io/thermo/",
    });
    expect(ld["@type"]).toBe("LearningResource");
    expect(ld["name"]).toBe("Thermodynamics");
    expect(ld["license"]).toBe("https://creativecommons.org/licenses/by-sa/4.0/");
    expect(ld["about"]).toBe("chemistry");
    expect(ld["educationalLevel"]).toBe("undergraduate");
    expect(ld["isAccessibleForFree"]).toBe(true);
  });

  it("adds accessibility hints only when the audit passed", () => {
    const pass = learningResource({ name: "X", license: "CC-BY-4.0", accessibility: "pass" });
    expect(pass["accessibilityFeature"]).toContain("alternativeText");
    const warn = learningResource({ name: "X", license: "CC-BY-4.0", accessibility: "warn" });
    expect(warn["accessibilityFeature"]).toBeUndefined();
  });

  it("omits optional fields when absent", () => {
    const ld = learningResource({ name: "Y", license: "CC0-1.0" });
    expect(ld["description"]).toBeUndefined();
    expect(ld["license"]).toBe("https://creativecommons.org/publicdomain/zero/1.0/");
  });

  it("emits a valid <script type=application/ld+json> block with escaped <", () => {
    const html = learningResourceJsonLd({ name: "A <script> trick", license: "CC-BY-4.0" });
    expect(html.startsWith('<script type="application/ld+json">')).toBe(true);
    expect(html.trimEnd().endsWith("</script>")).toBe(true);
    // the inner JSON must not contain a raw "<" that could break out of the script
    const inner = html.replace(/^<script[^>]*>/, "").replace(/<\/script>\s*$/, "");
    expect(inner).not.toMatch(/<script/i);
    expect(inner).toContain("\\u003c");
    expect(JSON.parse(inner.replace(/\\u003c/g, "<"))["name"]).toBe("A <script> trick");
  });
});
