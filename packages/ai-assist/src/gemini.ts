import { GoogleGenAI } from "@google/genai";
import type { AIProvider, GenerateOptions, GenerateResult } from "./provider";

export const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";

export interface GeminiProviderConfig {
  /** Defaults to process.env.GEMINI_API_KEY. */
  apiKey?: string;
  defaultModel?: string;
}

export class GeminiProvider implements AIProvider {
  readonly name = "gemini";
  private readonly client: GoogleGenAI;
  private readonly defaultModel: string;

  constructor(config: GeminiProviderConfig = {}) {
    const apiKey = config.apiKey ?? process.env["GEMINI_API_KEY"];
    if (!apiKey) {
      throw new Error(
        "GeminiProvider requires an API key (config.apiKey or GEMINI_API_KEY)",
      );
    }
    this.client = new GoogleGenAI({ apiKey });
    this.defaultModel = config.defaultModel ?? DEFAULT_GEMINI_MODEL;
  }

  async generateText(options: GenerateOptions): Promise<GenerateResult> {
    const model = options.model ?? this.defaultModel;
    const response = await this.client.models.generateContent({
      model,
      contents: options.prompt,
      config: {
        ...(options.system ? { systemInstruction: options.system } : {}),
        ...(options.maxOutputTokens
          ? { maxOutputTokens: options.maxOutputTokens }
          : {}),
        ...(options.temperature !== undefined
          ? { temperature: options.temperature }
          : {}),
      },
    });
    return {
      text: response.text ?? "",
      model,
      usage: {
        inputTokens: response.usageMetadata?.promptTokenCount,
        outputTokens: response.usageMetadata?.candidatesTokenCount,
      },
    };
  }
}
