/**
 * Ready-made example parts, used when the demo budget is resting, a topic is
 * refused, or a part fails its check twice (design §12.5). A full generated
 * sample replaces these once made; until then, short valid documents.
 */
import type { PartId } from "./guides";

const head = (title: string) => `{{nyml\nkind: document\nformat: 1\ntitle: ${title}\n}}\n\n`;

export const EXAMPLES: Record<PartId, { path: string; text: string }> = {
  concepts: { path: "concepts/photosynthesis.md", text: `${head("Concept map: Photosynthesis")}# Concept map: Photosynthesis\n\nHow plants turn light into chemical energy.\n\n{{mermaid\ngraph TD\n  L[Light] -->|absorbed by| C[Chlorophyll]\n  C -->|drives| R[Light reactions]\n  R -->|make| A[ATP and NADPH]\n  A -->|power| K[Calvin cycle]\n  K -->|fixes| G[Glucose]\n}}\n\n## Concepts\n\n1. **Light absorption**: chlorophyll captures light.\n2. **Light reactions**: water is split; ATP and NADPH are made.\n3. **Calvin cycle**: CO₂ is fixed into sugar.\n` },
  assessment: { path: "assessment-support/photosynthesis.md", text: `${head("Assessment guide: Photosynthesis")}# Assessment guide: Photosynthesis\n\n**Table 1.** Objectives and assessment.\n\n| Objective | Evidence of learning | How it is assessed |\n|---|---|---|\n| Explain the light reactions | Describes where ATP and NADPH come from | Short answer |\n| Write the overall equation | Balanced equation | Quiz item |\n| Compare the two stages | Table of inputs and outputs | Worksheet |\n` },
  "study-guide": { path: "study-guide/photosynthesis.md", text: `${head("Study guide: Photosynthesis")}# Photosynthesis\n\nPlants capture light and store its energy in sugar.\n\n$$\n6\\,\\ce{CO2} + 6\\,\\ce{H2O} \\xrightarrow{\\text{light}} \\ce{C6H12O6} + 6\\,\\ce{O2}\n$$\n\n::: info\n**Key idea:** light energy becomes chemical energy.\n:::\n\n## Summary\n\n- Light reactions make ATP and NADPH.\n- The Calvin cycle fixes carbon.\n` },
  slides: { path: "slides/photosynthesis.slides.md", text: `${head("Slides: Photosynthesis")}<!-- slide template=title -->\n# Photosynthesis\n## How plants store sunlight\nA ready-made example\n\n<!-- slide -->\n## Two stages\n\n- Light reactions\n- Calvin cycle\n\n<!-- slide template=closing -->\n# Questions?\n` },
  practice: { path: "practice/photosynthesis.md", text: `${head("Practice: Photosynthesis")}# Practice: Photosynthesis\n\n## Question 1\n\nWhere do the light reactions take place?\n\n::: spoiler Answer\nIn the thylakoid membranes of the chloroplast.\n:::\n` },
};
