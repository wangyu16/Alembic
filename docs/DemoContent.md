# Demo content — "Acid–Base Equilibria" (worked sample)

A complete, copy-paste teaching package for trying Alembic end to end. It
matches the [Quickstart](Quickstart.md) and exercises every v0.1 feature:
chemistry/math notation, AI draft, worksheet generation, the concept map +
objectives ("hidden" planning layer), the public/private boundary, and publish.

Use it as your own first package, or hand it to a pilot educator who'd rather
not bring their own topic.

> **More sample packages** (other STEM subjects, showing the platform isn't
> chemistry-only):
> - [Physics — "Motion in One Dimension"](demo/DemoContent-Physics.md) (equations, vectors, a worked free-fall example)
> - [Biology — "Mendelian Inheritance"](demo/DemoContent-Biology.md) (Punnett-square tables and ratios, no equations needed)

- **Title:** `Acid–Base Equilibria`
- **License:** `CC-BY-4.0`

---

## Study guide (paste one section per block)

### Section 1 — What is an acid?

```
Two definitions get us most of the way. A **Brønsted–Lowry acid** donates a
proton ($\text{H}^+$); a base accepts one. So in water:

$\ce{HCl + H2O -> H3O+ + Cl-}$

Here $\ce{HCl}$ is the acid (it gives up a proton) and water is the base. The
hydronium ion $\ce{H3O+}$ is how a "free" proton actually exists in solution —
there is no bare $\text{H}^+$ floating around.
```

### Section 2 — Strong vs. weak acids

```
A **strong acid** ionizes essentially completely:

$\ce{HCl -> H+ + Cl-}$  (one-way arrow)

A **weak acid** reaches an *equilibrium* — most molecules stay intact:

$\ce{CH3COOH <=> H+ + CH3COO-}$

The position of that equilibrium is captured by the acid dissociation constant:

$$K_a = \frac{[\text{H}^+][\text{A}^-]}{[\text{HA}]}$$

A larger $K_a$ (or smaller $\mathrm{p}K_a$) means a stronger acid.
```

### Section 3 — The pH scale

```
pH measures hydronium concentration on a log scale:

$$\mathrm{pH} = -\log_{10}[\text{H}_3\text{O}^+]$$

In pure water at 25 °C, $[\text{H}_3\text{O}^+] = 1.0\times10^{-7}\,\text{M}$, so
$\mathrm{pH} = 7$ (neutral). The carbonate ion $\ce{CO3^2-}$ and bicarbonate
$\ce{HCO3-}$ buffer many natural systems near this range.

A change of one pH unit is a **tenfold** change in $[\text{H}_3\text{O}^+]$ —
this is the point students most often miss.
```

### Section 4 — Buffers

```
A **buffer** resists pH change because it holds a weak acid *and* its conjugate
base together. The Henderson–Hasselbalch equation tells you the pH:

$$\mathrm{pH} = \mathrm{p}K_a + \log_{10}\frac{[\text{A}^-]}{[\text{HA}]}$$

Blood is buffered by the $\ce{H2CO3}/\ce{HCO3-}$ system near pH 7.4; the
bicarbonate $\ce{HCO3-}$ soaks up added acid, the carbonic acid $\ce{H2CO3}$
soaks up added base.
```

> Notation cheat-sheet (renders automatically): subscripts `H~2~O` → H₂O,
> superscripts `CO~3~^2-^` → CO₃²⁻, inline math `$...$`, display math `$$...$$`,
> equations `$\ce{2H2 + O2 -> 2H2O}$`.

---

## Concept map + objectives (the planning layer)

Open **Plan** (the concept/topic index). Add these concepts and the links
between them, then attach objectives. This is the "hidden" structure that keeps
a growing course coherent — and the M9.6 AI draft reads it.

**Concepts & prerequisites:**

- `Proton transfer` → enables → `Acid strength`
- `Acid strength` (Kₐ / pKₐ) → enables → `pH scale`
- `pH scale` → enables → `Buffers`
- `Conjugate acid–base pairs` → supports → `Buffers`

**Per-topic learning objectives:**

| Topic | Objective (students will be able to…) |
|---|---|
| What is an acid | identify the Brønsted–Lowry acid and base in a reaction |
| Strong vs. weak | explain why a weak acid reaches equilibrium and write its $K_a$ |
| pH scale | compute pH from $[\text{H}_3\text{O}^+]$ and reason about tenfold steps |
| Buffers | use Henderson–Hasselbalch to predict a buffer's pH |

---

## AI prompts to try (Tier A)

- **Draft a section:** *"Explain Le Chatelier's principle using the acetic-acid
  equilibrium from Section 2, with one everyday example."* Review → **Add to
  study guide** or discard.
- **Generate a worksheet:** tick Sections 2–4 → *Generate worksheet*. Expect
  short-answer + a couple of calculation problems on $K_a$, pH, and buffers.

---

## Private instructor material (never reaches the public repo)

Add these as **private / instructor** content to demonstrate the two-repo
boundary — they must stay out of the published student page and its history.

**Instructor note (private):**

```
Common misconception to pre-empt: students read "strong acid" as "concentrated"
or "dangerous." Strength is about *degree of ionization*, not concentration —
a dilute strong acid and a concentrated weak acid can have the same pH. Address
this before introducing Ka.
```

**Answer key (private — answer to a worksheet item):**

```
Q: A 0.10 M acetic acid solution has Ka = 1.8e-5. Find the pH.
A: x = sqrt(Ka * C) = sqrt(1.8e-5 * 0.10) = 1.34e-3 M = [H3O+].
   pH = -log(1.34e-3) ≈ 2.87.
```

After publishing, verify these never leaked:

```
gh api repos/<you>/acid-base-equilibria-oer/git/trees/main?recursive=1 | grep -i private
```

(should return nothing — see the invariant check in [PilotReadiness.md](PilotReadiness.md) Part B.)

---

## Full-loop checklist (mirrors the pilot task)

1. Create package `Acid–Base Equilibria` (CC-BY-4.0).
2. Paste Sections 1–4; **Save**; check **Preview** renders the equations.
3. Add the concept map + objectives in **Plan**.
4. Try one AI draft and one worksheet.
5. Add the private instructor note + answer key.
6. **Download .md.html**; reopen it.
7. **Connect publishing → Publish to GitHub → Publish website**; open the live link.
8. **List on Discover.**
9. Confirm no `private-instructor` path in the public repo history.
