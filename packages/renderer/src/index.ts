import { md } from "orz-markdown";

/** Version stamped into build metadata for diagnostics (never used to pin). */
export function rendererVersion(): string {
  return `orz-markdown@1.0.0`;
}

/** Render orz-markdown source to HTML (preview, student pages, artifacts). */
export function renderMarkdown(source: string): string {
  return md.render(source);
}

export * from "./document";
export * from "./mdhtml";
export * from "./slides";
export * from "./site";
export * from "./course-site";
