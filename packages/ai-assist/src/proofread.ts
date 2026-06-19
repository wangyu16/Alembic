import type { AIProvider } from "./provider";
import { SPELLING_GRAMMAR_SYSTEM } from "./prompts";

export interface ProofreadInput {
  /** The markdown to copy-edit (a section body or assembled chapter). */
  text: string;
}

/**
 * Spelling/grammar/punctuation copy-edit of study-guide markdown — meaning,
 * terminology, math, chemistry notation, and block markers preserved verbatim.
 * Provider-injected; the caller enqueues the result as a Tier-2 reviewed edit
 * (never auto-applied). Returns the corrected text and whether anything changed.
 */
export async function proofread(
  provider: AIProvider,
  input: ProofreadInput,
): Promise<{ corrected: string; changed: boolean }> {
  const { text } = await provider.generateText({
    system: SPELLING_GRAMMAR_SYSTEM,
    prompt: input.text,
    temperature: 0,
  });
  const corrected = text.trim();
  return { corrected, changed: corrected !== input.text.trim() };
}
