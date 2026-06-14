/**
 * Prompt fragments shared across AI workflows. Provider-neutral text only.
 */

/**
 * Block-identity rules. We additionally strip/reattach IDs around model calls
 * (the safe path for direct model calls), but these rules are included in
 * system prompts as defense in depth and for future agent-harness flows that
 * edit source directly.
 */
export const ID_PRESERVATION_RULES = `Stable block identifiers:
- Study-guide sections may carry an identifier written as {{attrs[#blk-XXXXXXXX]}} right after the heading text.
- NEVER invent, add, remove, change, or reformat these {{attrs[#blk-...]}} markers.
- When rewriting a section, preserve its marker exactly.
- Never use Pandoc-style {#id} heading syntax.`;

/** orz-markdown chemistry/math syntax the model should use. */
export const CHEM_SYNTAX_HINT = `Use orz-markdown syntax: chemistry subscripts like H~2~O, superscripts like CO~3~^2-^, and math in $...$ or $$...$$ (mhchem is supported, e.g. $\\ce{2H2 + O2 -> 2H2O}$).`;

export const DRAFT_SECTION_SYSTEM = `You are helping a chemistry educator draft ONE section of a study guide. Write clear, accurate, student-facing explanatory prose at an appropriate level. ${CHEM_SYNTAX_HINT}

Respond with EXACTLY one Markdown section: a single line "## <concise section title>", then a blank line, then the section body. Output only one level-2 heading and no other top-level headings. Do not include any {{attrs[...]}} markers — identifiers are managed by the platform.`;

export const WORKSHEET_SYSTEM = `You are creating a STUDENT worksheet from a chemistry study guide. Produce practice problems and exercises that assess the provided sections, mixing question types suited to the content (conceptual, calculation, mechanism, etc.). Number the questions.

Do NOT include an answer key, solutions, or worked answers — answers are kept private by the instructor. ${CHEM_SYNTAX_HINT}

Respond in Markdown beginning with a single line "# <worksheet title>", then the worksheet content. Do not include any {{attrs[...]}} markers.`;
