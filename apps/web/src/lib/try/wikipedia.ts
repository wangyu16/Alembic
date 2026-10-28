/**
 * Wikipedia as try mode's only outside source (design §12.5): a search, then
 * plain-text extracts of the top articles. Every URL passes the fetch policy
 * (Wikipedia only). The chapter ends with their CC BY-SA attribution.
 */
import { checkFetchUrl } from "@alembic/package-contract";

export interface WikiSource { title: string; url: string; extract: string }

const POLICY = { allow: ["en.wikipedia.org"], deny: ["orz.how"], maxQueryBytes: 512 };

async function get(url: string): Promise<unknown> {
  const ok = checkFetchUrl(url, POLICY);
  if (!ok.ok) throw new Error(`fetch refused: ${ok.reason}`);
  const r = await fetch(url, { headers: { "user-agent": "Alembic try mode (https://alembic.orz.how)" }, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`Wikipedia returned ${r.status}`);
  return r.json();
}

export async function wikipediaSources(topic: string, n = 2, chars = 3500): Promise<WikiSource[]> {
  const q = encodeURIComponent(topic.slice(0, 120));
  const s = (await get(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${q}&srlimit=${n}&format=json`)) as {
    query?: { search?: Array<{ title: string }> };
  };
  const titles = (s.query?.search ?? []).map((x) => x.title).slice(0, n);
  if (titles.length === 0) return [];
  const t = encodeURIComponent(titles.join("|"));
  const e = (await get(`https://en.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&exchars=${chars}&titles=${t}&format=json`)) as {
    query?: { pages?: Record<string, { title: string; extract?: string }> };
  };
  return Object.values(e.query?.pages ?? {})
    .filter((p) => p.extract)
    .map((p) => ({ title: p.title, url: `https://en.wikipedia.org/wiki/${encodeURIComponent(p.title.replace(/ /g, "_"))}`, extract: p.extract! }));
}

export function sourcesSection(sources: WikiSource[]): string {
  if (sources.length === 0) return "";
  return `\n## Sources\n\n${sources.map((s) => `- [${s.title}](${s.url}), Wikipedia, licensed CC BY-SA 4.0.`).join("\n")}\n\nThis demo also uses the model's own knowledge. It uses no textbooks or uploads, and it is not checked as a real course would be.\n`;
}
