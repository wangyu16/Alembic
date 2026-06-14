import { buildMdHtml } from "@alembic/renderer";
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

/** Build a `.md.html` download Response and the source hash for provenance. */
export function mdHtmlResponse(input: {
  title: string;
  markdown: string;
}): { response: Response; sourceHash: string } {
  const sourceHash = hashContent(input.markdown);
  const html = buildMdHtml({
    title: input.title,
    markdown: input.markdown,
    sourceHash,
  });
  const filename = `${slugForFile(input.title)}.md.html`;
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
