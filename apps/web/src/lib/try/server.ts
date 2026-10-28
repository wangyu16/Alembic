import "server-only";
/**
 * Try mode's server side (C7): the pipeline's dependencies on this server.
 * Model calls go through the AI gateway with a key minted for this run's
 * job, so every call is metered and capped by the demo budget.
 */
import Anthropic from "@anthropic-ai/sdk";
import type { OrzKit } from "@/lib/orz-editor/kit";
import type { TryDeps } from "./pipeline";
import { EXAMPLES } from "./examples";
import { wikipediaSources } from "./wikipedia";

export const TRY_MODEL = "claude-haiku-5-5";

let kits: { md: OrzKit; slides: OrzKit } | null = null;
async function loadKits() {
  kits ??= {
    md: (await import("orz-mdhtml-browser")) as unknown as OrzKit,
    slides: (await import("orz-slides-browser")) as unknown as OrzKit,
  };
  return kits;
}

export async function tryDeps(gatewayUrl: string, key: string): Promise<TryDeps> {
  const k = await loadKits();
  const client = new Anthropic({ apiKey: key, baseURL: gatewayUrl, maxRetries: 1, timeout: 120_000 });
  const textOf = (m: Anthropic.Message) => m.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  return {
    async write(system, user, maxTokens) {
      const m = await client.messages.create({ model: TRY_MODEL, max_tokens: maxTokens, system, messages: [{ role: "user", content: user }] });
      if (m.stop_reason === "refusal") throw new Error("refused");
      return textOf(m);
    },
    async topicOk(topic) {
      const m = await client.messages.create({
        model: TRY_MODEL,
        max_tokens: 5,
        system: "You screen topics for a classroom course demo. Answer only YES or NO. Say NO for sexual content, graphic violence, hate, harassment, self-harm, or instructions for weapons, drugs or crime; otherwise YES (any academic or everyday subject is fine).",
        messages: [{ role: "user", content: `Topic: ${topic}` }],
      });
      return /^\s*yes/i.test(textOf(m));
    },
    sources: (topic) => wikipediaSources(topic),
    check(kind, text) {
      const info = (kind === "slides" ? k.slides : k.md).readDocument(text) as { lints?: Array<{ level: string; code: string }> };
      return (info.lints ?? []).filter((l) => l.level === "error").map((l) => l.code);
    },
    example: (part) => EXAMPLES[part],
  };
}
