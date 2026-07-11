import { md } from "orz-markdown";

/** Version stamped into build metadata for diagnostics (never used to pin). */
import pkg from "../package.json";

/** The engine + version stamped into generated artifacts and shown in the
    footer — derived from this package's dependency declaration so a bump of
    orz-markdown updates it everywhere. */
export function rendererVersion(): string {
  const range = (pkg.dependencies as Record<string, string>)["orz-markdown"] ?? "unknown";
  return `orz-markdown@${range.replace(/^[\^~]/, "")}`;
}

/** Render orz-markdown source to HTML (preview, student pages, artifacts). */
export function renderMarkdown(source: string): string {
  return md.render(source);
}

// The async URL-include pre-pass (`{{md-include https://…}}`), re-exported so
// hosts resolve web transclusions before the synchronous render. See
// orz-markdown/prepare-sources.
export { prepareSources } from "orz-markdown";
export type { PrepareSourcesOptions } from "orz-markdown";

export * from "./theme-css";
export * from "./learning-resource";
export * from "./document";
export * from "./mdhtml";
export * from "./slides";
export * from "./site";
export * from "./course-site";
// The shared document-metadata type, re-exported so the web app can build a
// DocMeta without depending on orz-markdown directly.
export type { DocMeta } from "orz-markdown/doc-meta";
