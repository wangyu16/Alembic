import type { AIProvider } from "./provider";
import { EDIT_FILE_SYSTEM } from "./prompts";

export interface EditFileInput {
  /** The current full file content (carrier source / markdown). */
  source: string;
  /** Plain-language instruction, e.g. "make the tone more concise". */
  instruction: string;
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
  const { text } = await provider.generateText({
    system: EDIT_FILE_SYSTEM,
    prompt: `Instruction: ${input.instruction}\n\n----- FILE -----\n${input.source}`,
    temperature: 0.2,
  });
  return { proposed: text.trim() };
}
