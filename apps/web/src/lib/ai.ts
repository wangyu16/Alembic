import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  GeminiProvider,
  GatewayProvider,
  DEFAULT_ROUTING,
  modelForTask,
  type AIProvider,
  type GenerateOptions,
  type GenerateResult,
  type ModelRouting,
} from "@alembic/ai-assist";
import { can } from "./entitlements";

/** Per-user cap on model calls within the window (dev-generous). */
const RATE_LIMIT = 30;
const WINDOW_SECONDS = 60;

export class RateLimitError extends Error {
  constructor() {
    super("You've made a lot of AI requests in a short time. Please wait a moment and try again.");
    this.name = "RateLimitError";
  }
}

export class BudgetExceededError extends Error {
  constructor() {
    super("This account has reached its AI usage budget for now. Please try again later.");
    this.name = "BudgetExceededError";
  }
}

export class AINotConfiguredError extends Error {
  constructor() {
    super("AI is not configured on this deployment (set a gateway or GEMINI_API_KEY).");
    this.name = "AINotConfiguredError";
  }
}

export class AINotEntitledError extends Error {
  constructor() {
    super("AI assist isn't available on your account.");
    this.name = "AINotEntitledError";
  }
}

/**
 * Choose the AI provider from env — provider-swappable (CLAUDE.md rule 6).
 * Prefer an OpenAI-compatible gateway (Portkey/OpenRouter/…) when configured;
 * otherwise the dev-phase Gemini provider. Returns null if neither is set.
 */
function selectProvider(): { provider: AIProvider; routing: ModelRouting } | null {
  const gwUrl = process.env["AI_GATEWAY_URL"];
  const gwKey = process.env["AI_GATEWAY_API_KEY"];
  const routing = buildRouting();
  if (gwUrl && gwKey) {
    return {
      provider: new GatewayProvider({
        baseUrl: gwUrl,
        apiKey: gwKey,
        model: routing.default,
        name: "gateway",
        // Portkey routes to the underlying provider via a virtual-key header;
        // OpenRouter accepts HTTP-Referer/X-Title. Both arrive via this JSON env.
        headers: gatewayHeaders(),
      }),
      routing,
    };
  }
  if (process.env["GEMINI_API_KEY"]) {
    return { provider: new GeminiProvider(), routing };
  }
  return null;
}

/**
 * Build the task→model routing from env, falling back to DEFAULT_ROUTING's
 * placeholders. The cheap/strong split (the point of routing) is overridable
 * without code: AI_MODEL_FAST covers high-frequency low-stakes tasks, while
 * AI_MODEL_STRONG covers content generation + the Tier-B coherence agent. This
 * also lets a deployment collapse to a single model (set all three the same) —
 * useful for light gateway testing where only one provider model is wired.
 */
function buildRouting(): ModelRouting {
  const def = process.env["AI_MODEL_DEFAULT"] ?? DEFAULT_ROUTING.default;
  const fast = process.env["AI_MODEL_FAST"];
  const strong = process.env["AI_MODEL_STRONG"];
  const byTask: Record<string, string> = { ...DEFAULT_ROUTING.byTask };
  if (fast) {
    byTask["a11y-fix"] = fast;
    byTask["formatting-tidy"] = fast;
  }
  if (strong) {
    byTask["draft-section"] = strong;
    byTask["worksheet"] = strong;
    byTask["import-blocks"] = strong;
    byTask["coherence-agent"] = strong;
  }
  return { default: def, byTask };
}

/** Optional extra gateway headers (JSON object in AI_GATEWAY_HEADERS). */
function gatewayHeaders(): Record<string, string> | undefined {
  const raw = process.env["AI_GATEWAY_HEADERS"];
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object") {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof v === "string") out[k] = v;
      }
      return Object.keys(out).length ? out : undefined;
    }
  } catch {
    console.warn("[ai] AI_GATEWAY_HEADERS is not valid JSON; ignoring it.");
  }
  return undefined;
}

/** Per-user token budget (M16). Enforced only when AI_TOKEN_BUDGET is set. */
function budgetConfig(): { cap: number; windowSeconds: number } | null {
  const cap = Number(process.env["AI_TOKEN_BUDGET"]);
  if (!Number.isFinite(cap) || cap <= 0) return null;
  const windowSeconds = Number(process.env["AI_BUDGET_WINDOW_SECONDS"]) || 2_592_000; // 30d
  return { cap, windowSeconds };
}

/**
 * Wraps a provider with per-user rate limiting, an optional token budget,
 * per-task model routing, and governance logging. The underlying call is
 * rate-/budget-checked beforehand and recorded afterward in `ai_invocations`
 * (platform-side, governance-controlled — never in a repo). API keys live only
 * here on the server and never reach the client.
 */
class GovernedProvider implements AIProvider {
  readonly name: string;
  constructor(
    private readonly inner: AIProvider,
    private readonly supabase: SupabaseClient,
    private readonly ctx: { userId: string; packageId: string; kind: string },
    private readonly routing: ModelRouting,
  ) {
    this.name = inner.name;
  }

  async generateText(options: GenerateOptions): Promise<GenerateResult> {
    // Rate limit and budget both fail OPEN: if the check itself errors we allow
    // the request rather than block all AI, but surface the failure to logs.
    const { data: count, error: countError } = await this.supabase.rpc(
      "recent_ai_invocation_count",
      { window_seconds: WINDOW_SECONDS },
    );
    if (countError) {
      console.warn(`[ai] rate-limit check failed, allowing request: ${countError.message}`);
    } else if (typeof count === "number" && count >= RATE_LIMIT) {
      throw new RateLimitError();
    }

    const budget = budgetConfig();
    if (budget) {
      const { data: used, error: budgetError } = await this.supabase.rpc(
        "recent_ai_token_usage",
        { window_seconds: budget.windowSeconds },
      );
      if (budgetError) {
        console.warn(`[ai] budget check failed, allowing request: ${budgetError.message}`);
      } else if (typeof used === "number" && used >= budget.cap) {
        throw new BudgetExceededError();
      }
    }

    // Per-task model routing: pick the configured model for this task kind
    // unless the caller pinned one explicitly.
    const routed: GenerateOptions = {
      ...options,
      model: options.model ?? modelForTask(this.ctx.kind, this.routing),
    };

    const result = await this.inner.generateText(routed);

    // Governance logging is best-effort (must not break the educator's request)
    // but NOT silent: a failed write is a data-governance gap.
    const { error: logError } = await this.supabase.from("ai_invocations").insert({
      user_id: this.ctx.userId,
      package_id: this.ctx.packageId,
      kind: this.ctx.kind,
      provider: this.inner.name,
      model: result.model,
      prompt: routed.prompt,
      output: result.text,
      input_tokens: result.usage?.inputTokens ?? null,
      output_tokens: result.usage?.outputTokens ?? null,
    });
    if (logError) {
      console.error(`[ai] governance log insert failed: ${logError.message}`);
    }

    return result;
  }
}

/** Build a governed AI provider for one workflow invocation. */
export function governedProvider(
  supabase: SupabaseClient,
  ctx: { userId: string; packageId: string; kind: string },
): AIProvider {
  // Enforce the `ai` entitlement at the single seam (G8): every AI entry point
  // funnels through here, so the declared capability is now actually checked.
  // Signed-in users get `ai` today; plan-based gating lands in the resolver
  // with no change here. A userId means an authenticated identity.
  if (!can({ kind: "user", userId: ctx.userId }, "ai")) {
    throw new AINotEntitledError();
  }
  const selected = selectProvider();
  if (!selected) throw new AINotConfiguredError();
  return new GovernedProvider(selected.provider, supabase, ctx, selected.routing);
}
