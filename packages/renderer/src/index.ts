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

export * from "./theme-css";
export * from "./learning-resource";
export * from "./document";
export * from "./mdhtml";
export * from "./slides";
export * from "./site";
export * from "./course-site";
