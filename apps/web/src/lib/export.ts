import { buildMdHtml, type RenderTheme } from "@alembic/renderer";
import { hashContent } from "@alembic/package-contract";

export function slugForFile(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "document"
  );
}

/**
 * Compact UTC timestamp `YYYYMMDD-HHMMSS`. Appended to download filenames so
 * each export is uniquely named: browsers de-duplicate by inserting " (1)"
 * before the LAST dot (`name.md.html` -> `name.md (1).html`), which would
 * break the `.md.html` dual-extension suffix. A unique name avoids that path.
 */
function fileStamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `-${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`
  );
}

/** Build a `.md.html` download Response and the source hash for provenance. */
export function mdHtmlResponse(input: {
  title: string;
  markdown: string;
  now?: Date;
  theme?: RenderTheme;
}): { response: Response; sourceHash: string } {
  const sourceHash = hashContent(input.markdown);
  const html = buildMdHtml({
    title: input.title,
    markdown: input.markdown,
    sourceHash,
    theme: input.theme ?? "dark",
  });
  const filename = `${slugForFile(input.title)}-${fileStamp(input.now ?? new Date())}.md.html`;
  return {
    sourceHash,
    response: new Response(html, {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "content-disposition": `attachment; filename="${filename}"`,
      },
    }),
  };
}
