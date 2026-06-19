---
name: authoring-slides-html
description: How to author a .slides.html carrier — a self-contained slide deck whose visible payload is the rendered HTML slides and whose embedded source is the editable slide markdown, so it round-trips with Alembic. Use when creating/editing a slide deck outside Alembic and re-importing it.
---

# Authoring a `.slides.html` carrier

Read [carrier-format-basics](../carrier-format-basics/SKILL.md) first.

- **kind:** `slides` · **payload:** HTML · **format:** `1` · **role:** document
- **Extension:** `.slides.html` · **Layer:** `materials/slides/`

## What it is
A complete HTML slide deck (the rendered, presentable view) with the **slide
source** embedded in the `orz-carrier` `<script>` island (before `</body>`).

## Source schema (the embedded `<script>` body)
Slide **markdown**: slides separated by a top-level rule (`---` on its own line);
each slide is concise — a title (`# ` or `## `) plus bullet points, not prose.
Keep one idea per slide and a clean per-slide layout.

```markdown
# Acids and bases
- Acid: H+ donor
- Base: H+ acceptor

---

# Strength
- $K_a$ measures acid strength
- Strong acids dissociate fully
```

## Rules
1. **Escape `</` as `<\/`** inside the script body (basics §HTML).
2. Set `data-orz-kind="slides"` and `data-orz-format="1"`.
3. The rendered HTML should present the same slides the source describes.
4. A public deck references only **public** files (`materials/…`).

## Generation + ownership
Slides are typically **generated from the course content**, then owned and
edited (drift from the source is tracked). You may also edit the deck offline and
re-import, or — if you prefer PowerPoint — upload a `.pptx` (an owned, opaque,
"kept-divergent" artifact, gated to published packages; not a carrier).

## Round-trip
Extract the slide source → edit → re-embed is byte-identical. Validate via
extract → re-embed equality.
