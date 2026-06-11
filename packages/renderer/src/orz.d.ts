declare module "orz-markdown" {
  import type MarkdownIt from "markdown-it";
  export const md: MarkdownIt;
  export function register(...args: unknown[]): unknown;
  export function prepareSources(...args: unknown[]): unknown;
  const orz: { md: MarkdownIt };
  export default orz;
}
