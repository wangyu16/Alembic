/** G3 round-2 adversary probes (answer-key words()). Each `it` fails today. */
import { describe, expect, it } from "vitest";
import { copyChecks } from "./copy-check";

const KEY = "The equilibrium constant equals the product concentration squared divided by the reactant concentration at twenty five degrees";
const answerKey = copyChecks([{ path: "private/instructor/key.md", text: `# Key\n\n${KEY}\n` }], [])[0]!;

describe("G3r2: answer text the check still can't see (H4 nearby)", () => {
  it("an answer in an HTML attribute (title/alt), visible in the raw public file, is found", async () => {
    for (const text of [`Hover: <abbr title="${KEY}">answer</abbr>`, `<img src="x.png" alt="${KEY}">`]) {
      const f = await answerKey.run("chapter:atoms", [{ path: "study-guide/atoms.md", text }]);
      expect(f.length, text.slice(0, 20)).toBeGreaterThan(0); // FAILS: the whole tag, attributes included, is stripped
    }
  });
  it("zero-width or soft-hyphen characters don't split words to dodge the check", async () => {
    const text = KEY.split(" ").map((w) => w.slice(0, 2) + "­" + w.slice(2)).join(" ");
    const f = await answerKey.run("chapter:atoms", [{ path: "study-guide/atoms.md", text }]);
    expect(f.length).toBeGreaterThan(0); // FAILS
  });
});

describe("G3r2: code fences now compared (owner call)", () => {
  it.skip("[owner decision O23 pending] starter code shared by the practice file and the key's worked solution does not block the chapter", async () => {
    const starter = "```python\nimport numpy as np\nimport matplotlib.pyplot as plt\n\ndef kinetic_energy(mass, velocity):\n    \"\"\"Return the kinetic energy in joules.\"\"\"\n```";
    const key = copyChecks([{ path: "private/instructor/key.md", text: "# Solutions\n```python\nimport numpy as np\nimport matplotlib.pyplot as plt\n\ndef kinetic_energy(mass, velocity):\n    \"\"\"Return the kinetic energy in joules.\"\"\"\n    return 0.5 * mass * velocity ** 2\n```" }], [])[0]!;
    const f = await key.run("chapter:atoms", [{ path: "practice/atoms.md", text: `# Exercise\nComplete:\n${starter}\n` }]);
    expect(f).toEqual([]); // FAILS: always-block, no override
  });
});
