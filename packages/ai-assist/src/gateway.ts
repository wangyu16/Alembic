import type { AIProvider, GenerateOptions, GenerateResult } from "./provider";

/**
 * Configuration for an OpenAI-compatible chat-completions gateway.
 *
 * Works with OpenRouter, Portkey, OpenAI itself, or any endpoint that speaks
 * the OpenAI `/chat/completions` shape. The gateway is just another
 * {@link AIProvider}; workflow code never knows which one it's talking to.
 */
export interface GatewayConfig {
  /** Base URL, e.g. "https://openrouter.ai/api/v1" or a Portkey gateway URL. */
  baseUrl: string;
  apiKey: string;
  /** Default model id when a call doesn't specify one. */
  model: string;
  /** Optional display name; defaults to "gateway". */
  name?: string;
  /** Optional extra headers (e.g. Portkey/OpenRouter routing headers). */
  headers?: Record<string, string>;
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
  model?: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string };
}

export class GatewayProvider implements AIProvider {
  readonly name: string;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly defaultModel: string;
  private readonly extraHeaders: Record<string, string>;

  constructor(config: GatewayConfig) {
    if (!config.baseUrl) {
      throw new Error("GatewayProvider requires a baseUrl");
    }
    if (!config.apiKey) {
      throw new Error("GatewayProvider requires an apiKey");
    }
    if (!config.model) {
      throw new Error("GatewayProvider requires a default model");
    }
    // Strip a single trailing slash so `${baseUrl}/chat/completions` is clean.
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.apiKey = config.apiKey;
    this.defaultModel = config.model;
    this.name = config.name ?? "gateway";
    this.extraHeaders = config.headers ?? {};
  }

  async generateText(options: GenerateOptions): Promise<GenerateResult> {
    const model = options.model ?? this.defaultModel;

    const messages: Array<{ role: string; content: string }> = [];
    if (options.system) {
      messages.push({ role: "system", content: options.system });
    }
    messages.push({ role: "user", content: options.prompt });

    const body: Record<string, unknown> = { model, messages };
    if (options.temperature !== undefined) {
      body["temperature"] = options.temperature;
    }
    if (options.maxOutputTokens !== undefined) {
      body["max_tokens"] = options.maxOutputTokens;
    }

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
        ...this.extraHeaders,
      },
      body: JSON.stringify(body),
    });

    let data: ChatCompletionResponse | undefined;
    try {
      data = (await response.json()) as ChatCompletionResponse;
    } catch {
      data = undefined;
    }

    if (!response.ok) {
      const detail = data?.error?.message;
      throw new Error(
        `Gateway request failed (${response.status} ${response.statusText})` +
          (detail ? `: ${detail}` : ""),
      );
    }

    const usage: GenerateResult["usage"] = {};
    if (data?.usage?.prompt_tokens !== undefined) {
      usage.inputTokens = data.usage.prompt_tokens;
    }
    if (data?.usage?.completion_tokens !== undefined) {
      usage.outputTokens = data.usage.completion_tokens;
    }

    return {
      text: (data?.choices?.[0]?.message?.content ?? "").trim(),
      model: data?.model ?? model,
      ...(usage.inputTokens !== undefined || usage.outputTokens !== undefined
        ? { usage }
        : {}),
    };
  }
}
