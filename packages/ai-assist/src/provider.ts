/**
 * Provider-swappable AI interface.
 *
 * Workflow code depends only on this interface. The development phase uses
 * Gemini; the funded study may switch providers (e.g., Claude) without
 * changing any workflow code. Keep this surface small and provider-neutral.
 */

export interface GenerateOptions {
  /** System / steering instructions (ID-preservation rules live here). */
  system?: string;
  prompt: string;
  /** Provider-specific model name; each provider declares its default. */
  model?: string;
  maxOutputTokens?: number;
  temperature?: number;
}

export interface GenerateResult {
  text: string;
  model: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
  };
}

export interface AIProvider {
  readonly name: string;
  generateText(options: GenerateOptions): Promise<GenerateResult>;
}
