import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  GeminiProvider,
  type AIProvider,
  type GenerateOptions,
  type GenerateResult,
} from "@alembic/ai-assist";

/** Per-user cap on model calls within the window (dev-generous). */
const RATE_LIMIT = 30;
const WINDOW_SECONDS = 60;

export class RateLimitError extends Error {
  constructor() {
    super("You've made a lot of AI requests in a short time. Please wait a moment and try again.");
    this.name = "RateLimitError";
  }
}

export class AINotConfiguredError extends Error {
  constructor() {
    super("AI is not configured on this deployment (missing GEMINI_API_KEY).");
    this.name = "AINotConfiguredError";
  }
}

/**
 * Wraps a provider with per-user rate limiting and governance logging. Every
 * underlying model call is rate-checked beforehand and recorded afterward in
 * `ai_invocations` (platform-side, governance-controlled — never in a repo).
 * The API key lives only here on the server and never reaches the client.
 */
class GovernedProvider implements AIProvider {
  readonly name: string;
  constructor(
    private readonly inner: AIProvider,
    private readonly supabase: SupabaseClient,
    private readonly ctx: { userId: string; packageId: string; kind: string },
  ) {
    this.name = inner.name;
  }

  async generateText(options: GenerateOptions): Promise<GenerateResult> {
    const { data: count } = await this.supabase.rpc(
      "recent_ai_invocation_count",
      { window_seconds: WINDOW_SECONDS },
    );
    if (typeof count === "number" && count >= RATE_LIMIT) {
      throw new RateLimitError();
    }

    const result = await this.inner.generateText(options);

    await this.supabase.from("ai_invocations").insert({
      user_id: this.ctx.userId,
      package_id: this.ctx.packageId,
      kind: this.ctx.kind,
      provider: this.inner.name,
      model: result.model,
      prompt: options.prompt,
      output: result.text,
      input_tokens: result.usage?.inputTokens ?? null,
      output_tokens: result.usage?.outputTokens ?? null,
    });

    return result;
  }
}

/** Build a governed AI provider for one workflow invocation. */
export function governedProvider(
  supabase: SupabaseClient,
  ctx: { userId: string; packageId: string; kind: string },
): AIProvider {
  if (!process.env["GEMINI_API_KEY"]) throw new AINotConfiguredError();
  return new GovernedProvider(new GeminiProvider(), supabase, ctx);
}
