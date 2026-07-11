declare module "orz-markdown" {
  import type MarkdownIt from "markdown-it";
  export const md: MarkdownIt;
  export function register(...args: unknown[]): unknown;
  /** Options for `prepareSources` (orz-markdown ≥ 1.5.0). */
  export interface PrepareSourcesOptions {
    fetcher?: (url: string) => Promise<string | null>;
    allowedHosts?: string[];
    maxDepth?: number;
  }
  /** Async pre-pass that inlines `{{md-include https://…}}` URL includes. */
  export function prepareSources(src: string, opts?: PrepareSourcesOptions): Promise<string>;
  const orz: { md: MarkdownIt };
  export default orz;
}
