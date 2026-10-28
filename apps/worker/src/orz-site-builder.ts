/**
 * orz-site on the worker (A12): the site core with the installed carriers.
 * Loaded at run time from the worker's own node_modules (the carriers read
 * their shells from disk, so they are not bundled). Network includes are
 * never fetched here: a course's site is built from its public files only.
 */
import type { SiteBuilder } from "./site-build-loop";

export async function orzSiteBuilder(): Promise<SiteBuilder> {
  const site = await import("orz-site/node");
  const { carriers } = await site.loadCarriers();
  const versions = await site.installedVersions();
  return {
    async defaultConfig() {
      return { ...site.defaultConfig(), carriers: versions };
    },
    async build(files, config, baseUrl) {
      const r = await site.buildSite(files, config, { carriers, baseUrl, offline: true });
      return {
        ok: r.ok,
        files: r.files,
        errors: r.report.errors.map((f) => `${f.path ? `${f.path}${f.line ? `:${f.line}` : ""}: ` : ""}${f.message}`),
        warnings: r.report.warnings.length,
      };
    },
  };
}
