import "server-only";
import { licenseLabel, licenseUrl, type PackageManifest } from "@alembic/package-contract";
import type { DocMeta } from "@alembic/renderer";

/**
 * Build the document metadata that Alembic injects into every generated
 * `.md.html` / `.slides.html` / `.paged.html`, so a downloaded or published file
 * is self-describing — it carries its license, author and a link home even when
 * it travels alone (docs/specs/document-metadata.md, M5).
 *
 * The manifest is the single source of truth for the license; this is the one
 * place that translates it into a `DocMeta`. We never write the license into the
 * committed markdown (that would drift on edit/adapt) — it is injected fresh on
 * every generate.
 */
export function docMetaForPackage(
  manifest: Pick<PackageManifest, "license" | "courseContext" | "description">,
  opts: { title?: string; description?: string; source?: string; uid?: string },
): DocMeta {
  const meta: DocMeta = {
    license: {
      spdx: manifest.license,
      name: licenseLabel(manifest.license),
      url: licenseUrl(manifest.license),
    },
  };
  if (opts.title) meta.title = opts.title;
  const author = manifest.courseContext?.instructor?.trim();
  if (author) meta.author = author;
  const description = opts.description ?? manifest.description;
  if (description?.trim()) meta.description = description.trim();
  if (opts.source) meta.source = opts.source;
  // Durable document identity (U2): when the caller mints a stable id, embed it
  // in the file's #orz-meta island. It survives in-file edits and travels with
  // the file, so the registry recognizes a re-uploaded copy as the same
  // document (permalink stays put) — see extractEmbeddedUid / registerFile.
  if (opts.uid) meta.uid = opts.uid;
  return meta;
}
