/**
 * Choose the AI provider and task routing from the environment — the one
 * place outside workflow code that knows which providers exist (CLAUDE.md
 * rule 6). Used by the web app (`lib/ai.ts`) and the worker (contact triage).
 *
 * An OpenAI-compatible gateway (LiteLLM/OpenRouter/Portkey/…) when
 * AI_GATEWAY_URL + AI_GATEWAY_API_KEY are set; otherwise the dev-phase Gemini
 * provider when GEMINI_API_KEY is set; otherwise null (AI not configured).
 */
import { GatewayProvider } from "./gateway";
import { GeminiProvider } from "./gemini";
import type { AIProvider } from "./provider";
import { DEFAULT_ROUTING, type ModelRouting } from "./routing";

export type AIEnv = Record<string, string | undefined>;

/** Task kinds AI_MODEL_FAST covers (high-frequency, low-stakes). */
const FAST_TASKS = ["a11y-fix", "formatting-tidy", "contact-triage"];
/** Task kinds AI_MODEL_STRONG covers (content generation, coherence). */
const STRONG_TASKS = ["draft-section", "worksheet", "import-blocks", "coherence-agent"];

/**
 * Task→model routing from env, falling back to DEFAULT_ROUTING. AI_MODEL_FAST
 * covers high-frequency low-stakes tasks, AI_MODEL_STRONG content generation
 * + the coherence agent; AI_MODEL_DEFAULT the rest.
 */
export function routingFromEnv(env: AIEnv): ModelRouting {
  const def = env["AI_MODEL_DEFAULT"] || DEFAULT_ROUTING.default;
  const fast = env["AI_MODEL_FAST"];
  const strong = env["AI_MODEL_STRONG"];
  const byTask: Record<string, string> = { ...DEFAULT_ROUTING.byTask };
  if (fast) for (const t of FAST_TASKS) byTask[t] = fast;
  if (strong) for (const t of STRONG_TASKS) byTask[t] = strong;
  return { default: def, byTask };
}

/** Optional extra gateway headers (a JSON object in AI_GATEWAY_HEADERS). */
export function gatewayHeadersFromEnv(env: AIEnv): Record<string, string> | undefined {
  const raw = env["AI_GATEWAY_HEADERS"];
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

export function providerFromEnv(env: AIEnv): { provider: AIProvider; routing: ModelRouting } | null {
  const gwUrl = env["AI_GATEWAY_URL"];
  const gwKey = env["AI_GATEWAY_API_KEY"];
  const routing = routingFromEnv(env);
  if (gwUrl && gwKey) {
    return {
      provider: new GatewayProvider({ baseUrl: gwUrl, apiKey: gwKey, model: routing.default, name: "gateway", headers: gatewayHeadersFromEnv(env) }),
      routing,
    };
  }
  const gemini = env["GEMINI_API_KEY"];
  if (gemini) return { provider: new GeminiProvider({ apiKey: gemini }), routing };
  return null;
}
