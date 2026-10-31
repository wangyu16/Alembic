/** G3 adversary probes (answer-key / copying plug-ins, R27). Each `it` fails today. */
import { describe, expect, it } from "vitest";
import { copyChecks } from "./copy-check";

const KEY = "The equilibrium constant equals the product concentration squared divided by the reactant concentration at twenty five degrees";
const priv = [{ path: "private/instructor/key.md", text: `# Key\n\n${KEY}\n` }];
const answerKey = copyChecks(priv, [])[0]!;

describe("G3 probe: answer-key text that the check can't see", () => {
  it("an answer key pasted inside an HTML comment (visible in the public repo's raw Markdown) is found", async () => {
    const f = await answerKey.run("chapter:atoms", [{ path: "study-guide/atoms.md", text: `# Atoms\n\n<!-- ${KEY} -->\n` }]);
    expect(f.map((x) => x.severity)).toContain("always"); // FAILS: comments are stripped as tags
  });
  it("an answer key inside a code fence is found", async () => {
    const f = await answerKey.run("chapter:atoms", [{ path: "practice/atoms.md", text: "```\n" + KEY + "\n```\n" }]);
    expect(f.map((x) => x.severity)).toContain("always"); // FAILS: fences are dropped from both sides
  });
  it("an answer key in a projectable file with an unlisted extension is found", async () => {
    for (const path of ["study-guide/chapters/atoms/key.tex", "practice/chapters/atoms/key.yml", "study-guide/chapters/atoms/key.qmd", "study-guide/chapters/atoms/key.htm"]) {
      const f = await answerKey.run("chapter:atoms", [{ path, text: KEY }]);
      expect(f.length, path).toBeGreaterThan(0); // FAILS: only md|txt|html|svg|json|csv are checked
    }
  });
});
