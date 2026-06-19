---
name: carrier-format-basics
description: How Alembic/orz "dual-extension" carrier files embed editable source inside a renderable file so they round-trip across apps (export → edit elsewhere → re-import) losslessly. Read this before authoring any .md.html / .slides.html / .md.pdf / .ketcher.svg / .plot.svg file. Covers the embedded-source island, the kind/format markers, escaping, format versioning, and the round-trip conformance test.
---

# Carrier format basics

A **carrier** is a single file whose visible payload is a standard renderable
format (HTML, SVG, or PDF) **and** which embeds its own editable **source** plus
two markers, so any app can open it, edit the source, and write it back without
loss. This is what makes a `.md.html` exported from Alembic editable in another
app and re-importable.

## The two markers (every carrier)

- `kind` — which editor owns the file: `md`, `slides`, `ketcher`, `plot`, `pdf`, …
- `format` — an integer **format version**. Extraction is gated on it, so a
  newer writer never silently corrupts an older reader. Start at `1`; bump only
  with a documented change to the embedding.

## The two envelopes

### HTML carriers (`.md.html`, `.slides.html`)
The source is a single non-executable `<script>` injected **immediately before
the last `</body>`** (appended if there is no `</body>`):

```html
<script type="application/orz-carrier+json" id="orz-carrier"
        data-orz-kind="md" data-orz-format="1">…SOURCE…</script>
```

- The `type` is non-executable so the browser never runs the source.
- **Escape `</` as `<\/`** throughout the source on embed; restore on extract.
  This keeps a literal `</script>` (or any `</…`) from breaking out of the
  element and surviving copy/paste.

### SVG carriers (`.ketcher.svg`, `.plot.svg`)
The source is a `<metadata id="orz-carrier">` element that is the **first child
of the root `<svg>`**, wrapping a CDATA section:

```xml
<metadata id="orz-carrier" data-orz-kind="ketcher" data-orz-format="1"><![CDATA[…SOURCE…]]></metadata>
```

- **Escape `]]>` by splitting the CDATA** (`]]>` → `]]]]><![CDATA[>`) on embed;
  rejoin on extract. This keeps the SVG well-formed for any source bytes.

### PDF carriers (`.md.pdf`) — planned
Same idea (a renderable PDF with the source attached, e.g. an embedded file /
metadata stream + the `kind`/`format` markers). Implemented in the worker tier;
follow this skill's round-trip rule when it ships.

## Block identity (`.md.html` specifically)
Markdown carriers carry **block IDs** in the source as native attrs markers:
`## Heading{{attrs[#blk-XXXXXXXX]}}`. These IDs are **immutable** — preserve
them verbatim when editing. Dropping or duplicating a marker breaks traceability
to slides/worksheets/adaptations. Authoring tools must keep each section's
marker exactly as received and only mint a new id for a genuinely new section.

## The round-trip conformance test (the whole point)
A file conforms iff:

1. **extract → re-embed is byte-identical** for the source (the markers survive
   the escapes above), and
2. for `.md.html`, **re-import preserves every block ID**.

"Conforms to the skill" must mean exactly "passes Alembic's `validate()` /
`extractSource()` round-trip." If you can extract the source, edit it, re-embed,
and get the same source back out, the file will re-import into Alembic with zero
friction. See the per-kind skills (`authoring-md-html`, `authoring-ketcher-svg`,
`authoring-plot-svg`, `authoring-slides-html`, `authoring-md-pdf`) for the
source schema of each `kind`.
