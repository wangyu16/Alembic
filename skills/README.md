# Carrier authoring skills

Portable Agent Skills that state how to author each Alembic/orz **dual-extension
carrier** so files round-trip across apps losslessly (export from Alembic → edit
in another tool → re-import). One skill per carrier kind, plus shared basics.
They are the human/AI-readable half of the "validator == skill" principle in
[docs/specs/carriers-and-assets.md §7](../docs/specs/carriers-and-assets.md):
*conforming to a skill must mean exactly passing Alembic's `extractSource()`
round-trip + `validate()`.*

- [carrier-format-basics](carrier-format-basics/SKILL.md) — the embedded-source
  island, `kind`/`format` markers, escaping, format versioning, block-ID
  preservation, the round-trip conformance test. **Read first.**
- [authoring-md-html](authoring-md-html/SKILL.md) — `.md.html` (study guide / handout)
- [authoring-slides-html](authoring-slides-html/SKILL.md) — `.slides.html` (slide deck)
- [authoring-md-pdf](authoring-md-pdf/SKILL.md) — `.md.pdf` (printable, planned)
- [authoring-ketcher-svg](authoring-ketcher-svg/SKILL.md) — `.ketcher.svg` (chemical structure)
- [authoring-plot-svg](authoring-plot-svg/SKILL.md) — `.plot.svg` (data plot)

New carrier kinds get a skill the same way they get a kind-registry line —
additive. The per-kind facts (extension, payload, current format) should track
the registry in `@alembic/carriers`.
