/**
 * What the Publish page says about the course website, from the latest
 * committed run (publish_runs.status / results.site, written by the worker).
 */
export type SiteView =
  | { kind: "none" }
  | { kind: "building" }
  | { kind: "live"; url: string; note: string | null }
  | { kind: "updated" }
  | { kind: "failed"; error: string; problems: string[] };

export function siteView(run: { status: string; results: unknown } | undefined): SiteView {
  if (!run) return { kind: "none" };
  const site = ((run.results ?? {}) as { site?: Record<string, unknown> }).site ?? {};
  if (run.status === "committed") return { kind: "building" };
  if (run.status === "site-failed") {
    const problems = Array.isArray(site["problems"]) ? site["problems"].filter((x): x is string => typeof x === "string").slice(0, 20) : [];
    return { kind: "failed", error: typeof site["error"] === "string" ? site["error"] : "the build failed", problems };
  }
  // Only a GitHub Pages address is shown as a link (the worker writes it; never a value from elsewhere).
  const url = typeof site["url"] === "string" && /^https:\/\/[a-z0-9-]+\.github\.io\//i.test(site["url"]) ? site["url"] : null;
  if (run.status === "site-built" && url) return { kind: "live", url, note: typeof site["pagesNote"] === "string" ? site["pagesNote"] : null };
  return { kind: "updated" };
}
