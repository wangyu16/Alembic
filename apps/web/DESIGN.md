# Design

Visual system for the Alembic web app (`apps/web`). Tokens live in
`src/app/globals.css`; Tailwind 4 consumes them via `@theme inline`.

## Theme

Two themes, cookie-selected (`alembic-theme` → `<html data-theme>`), designed
to harmonize with orz-markdown's rendered output (dark-elegant / light-neat-1).
Dark is the default. Rendered document previews keep their own (cool, bookish)
palette; the app chrome frames them with a warm copper accent — workshop
around the paper.

## Color

Cool blue-black neutrals + **one decoration color: copper**, the material of
the alembic still. Copper is reserved for interaction and selection: primary
buttons, links, focus rings, active nav items, text selection. Semantic
colors (danger/warn/ok) are unchanged and never used decoratively. The orz
family logo (leaf green seal) stays as-is — it is a family mark, not an app
accent.

| Token | Dark | Light | Notes |
|---|---|---|---|
| `--canvas` | `#0c0e16` | `#fbfbfd` | page ground |
| `--surface` | `#12151f` | `#ffffff` | panels |
| `--elevated` | `#1a1e2c` | `#f3f4f8` | fields, hovers |
| `--edge` / `--edge-soft` | `#272b3d` / `#1c2030` | `#dee1ea` / `#eaecf2` | borders |
| `--ink` | `#e6eaf3` | `#1b2030` | primary text |
| `--muted` | `#9aa3b8` | `#5a6276` | secondary text (7.6:1 / 6.1:1) |
| `--accent` | `#d99a6c` | `#a4551e` | copper — 8.1:1 on dark canvas, 5.4:1 on white |
| `--accent-hover` | `#e5ad84` | `#8a4a1c` | lighter in dark, darker in light |
| `--accent-ink` | `#1c1108` | `#ffffff` | text on copper (7.8:1 / 5.4:1) |
| `--accent-soft` | copper @ 14% | copper @ 10% | selection, soft fills |

Contrast ratios above are computed WCAG ratios, not eyeballed. When changing
any pair, re-verify ≥4.5:1 for text and ≥3:1 for UI outlines.

## Typography

- **Sans (UI, body):** Geist — labels, controls, prose.
- **Serif (display):** Source Serif 4 — page titles, editor headings, the
  wordmark. Serif + sans pair on a contrast axis; never a second sans.
- **Mono:** Geist Mono — markdown sources, code, IDs.
- Product register: fixed rem scale, tight ratio. Hero on the landing page is
  `text-4xl` at mobile, `text-5xl` from `sm:` up. No fluid clamp headings in
  app screens.

## Layout & Responsiveness

- App pages: centered `max-w-3xl`–`max-w-6xl` columns. Editors: full-height
  shells (`h-[calc(100vh-3.5rem)]`).
- Breakpoints: mobile-first; `sm:` 640, `md:` 768, `lg:` 1024. Editing
  surfaces go single-column below `lg:`; navigation panes become overlay
  drawers below `md:` (studio shell) with the same toggle buttons.
- Site header: one nav-item list renders twice — inline links from `sm:` up,
  a CSS-only `<details>` "Menu" dropdown below (both auth states). New nav
  items go in the list once and appear in both presentations.
- Never a fixed pane width without a mobile fallback; dropdowns clamp to
  `max-w-[calc(100vw-2rem)]`.
- Touch targets: `@media (pointer: coarse)` bumps `.btn`/`.btn-sm` padding.

## Components

`globals.css` component layer: `.panel`, `.field`, `.btn` (+ `-primary`,
`-ghost`, `-danger`, `-sm`), `.chip`, `.link`. Every interactive state exists:
hover, focus-visible (copper ring), disabled (0.5 opacity). Transitions
140 ms; `prefers-reduced-motion` kills them. No modals where inline works;
the studio panes and Ask-AI are inline/collapsible by design.

## Motion

State-conveying only, 140–250 ms. No page-load choreography, no decorative
animation.
