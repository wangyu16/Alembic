import type { AIProvider } from "./provider";
import { EDIT_FILE_SYSTEM } from "./prompts";

export interface EditFileInput {
  /** The current full file content (carrier source / markdown). */
  source: string;
  /** Plain-language instruction, e.g. "make the tone more concise". */
  instruction: string;
  /**
   * Optional platform focus preamble composed ahead of the edit framing — used
   * to inject the `@alembic/ai-operations` `PLATFORM_SCOPE` guardrail so the
   * operation stays task-scoped.
   */
  focus?: string;
}

/**
 * Revise one file's content per an educator instruction — the host
 * implementation of the editor module's `requestAI`. Returns the full proposed
 * content for the host to diff and the educator to approve (a Tier-2
 * editor-ai-edit; never auto-applied). Preserves block markers + notation.
 */
export async function editFile(
  provider: AIProvider,
  input: EditFileInput,
): Promise<{ proposed: string }> {
  const system = input.focus
    ? `${input.focus}\n\n${EDIT_FILE_SYSTEM}`
    : EDIT_FILE_SYSTEM;
  const { text } = await provider.generateText({
    system,
    prompt: `Instruction: ${input.instruction}\n\n----- FILE -----\n${input.source}`,
    temperature: 0.2,
  });
  return { proposed: text.trim() };
}
