---
name: authoring-plot-svg
description: How to author a .plot.svg carrier — a data plot whose visible payload is an SVG and whose embedded source is the editable Plotly spec, so it round-trips with Alembic and the plot editor. Use when creating/editing a chart/plot asset outside Alembic.
---

# Authoring a `.plot.svg` carrier

Read [carrier-format-basics](../carrier-format-basics/SKILL.md) first.

- **kind:** `plot` · **payload:** SVG · **format:** `1` · **role:** asset
- **Extension:** `.plot.svg` · **Layer:** `materials/plots/`

## What it is
A standard **SVG** rendering of the chart with the **Plotly spec** embedded in
the `orz-carrier` `<metadata>` island (first child of `<svg>`, CDATA-wrapped).

## Source schema (the CDATA body)
A **Plotly figure spec** as JSON: `{ "data": [ …traces… ], "layout": { … } }`.
This is the editable source the plot editor re-opens.

```xml
<svg xmlns="http://www.w3.org/2000/svg" …>
  <metadata id="orz-carrier" data-orz-kind="plot" data-orz-format="1"><![CDATA[{"data":[…],"layout":{…}}]]></metadata>
  …rendered chart…
</svg>
```

## Rules
1. `<metadata id="orz-carrier">` is the **first child** of `<svg>`.
2. **Escape `]]>`** in the JSON by splitting the CDATA (basics §SVG).
3. Set `data-orz-kind="plot"` and `data-orz-format="1"`.
4. The visible SVG should match the spec (export the SVG from the same spec).
5. Provide **alt text** when referencing it.

## Round-trip
Extract the Plotly spec to re-open/edit the chart; re-embed is byte-identical.
Validate via extract → re-embed equality.
