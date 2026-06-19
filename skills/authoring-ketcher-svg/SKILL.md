---
name: authoring-ketcher-svg
description: How to author a .ketcher.svg carrier — a chemical structure drawing whose visible payload is an SVG and whose embedded source is the editable KetJSON, so it round-trips with Alembic and the Ketcher editor. Use when creating/editing a chemical structure asset outside Alembic.
---

# Authoring a `.ketcher.svg` carrier

Read [carrier-format-basics](../carrier-format-basics/SKILL.md) first.

- **kind:** `ketcher` · **payload:** SVG · **format:** `1` · **role:** asset
- **Extension:** `.ketcher.svg` · **Layer:** `materials/structures/`

## What it is
A standard **SVG** rendering of the molecule (so it displays anywhere) with the
**KetJSON** source embedded in the `orz-carrier` `<metadata>` island (first child
of `<svg>`, CDATA-wrapped).

## Source schema (the CDATA body)
The **KetJSON** document Ketcher emits (`getKet()`): a JSON object describing
atoms, bonds, and S-groups. Treat it as opaque editor state — produce it from
Ketcher (or a compatible tool), don't hand-write it.

```xml
<svg xmlns="http://www.w3.org/2000/svg" …>
  <metadata id="orz-carrier" data-orz-kind="ketcher" data-orz-format="1"><![CDATA[{"root":{…KetJSON…}}]]></metadata>
  …rendered structure…
</svg>
```

## Rules
1. The `<metadata id="orz-carrier">` element must be the **first child** of the
   root `<svg>`.
2. **Escape `]]>`** in the KetJSON by splitting the CDATA (basics §SVG).
3. Set `data-orz-kind="ketcher"` and `data-orz-format="1"`.
4. The visible SVG should faithfully render the KetJSON, so the file is useful
   even where the source isn't read.
5. Provide **alt text** when referencing it (accessibility); Alembic can derive
   it from the structure source.

## Round-trip
Alembic/Ketcher extract the KetJSON to re-open and edit the molecule; re-embed
yields a byte-identical KetJSON. Validate via extract → re-embed equality.
