# Demo content — "Mendelian Inheritance" (Biology)

A small worked sample for trying Alembic in **biology**. One module, three
sections. It deliberately leans on tables and ratios rather than equations —
showing the platform is not only for formula-heavy subjects. Companion to the
chemistry sample in [DemoContent.md](../DemoContent.md).

- **Title:** `Mendelian Inheritance`
- **License:** `CC-BY-4.0`

---

## Study guide (paste one section per block)

### Section 1 — Genes, alleles, and dominance

```
A **gene** is an instruction for a trait; its alternative versions are
**alleles**. An organism carries two alleles per gene — one from each parent.

- If the two alleles are the same, the organism is **homozygous** (e.g. *AA* or
  *aa*).
- If they differ, it is **heterozygous** (*Aa*).

A **dominant** allele (written uppercase, *A*) masks a **recessive** one
(lowercase, *a*). So *AA* and *Aa* show the dominant trait; only *aa* shows the
recessive one. The alleles present are the **genotype**; the trait you observe
is the **phenotype**.
```

### Section 2 — The monohybrid cross and the 3:1 ratio

```
Cross two heterozygotes, *Aa × Aa*. A **Punnett square** lists each parent's
possible gametes and combines them:

|       | **A** | **a** |
|-------|-------|-------|
| **A** | AA    | Aa    |
| **a** | Aa    | aa    |

The four equally likely offspring are **1 AA : 2 Aa : 1 aa** by genotype — which
collapses to a **3 : 1 dominant-to-recessive ratio** by phenotype, because *AA*
and *Aa* look alike. This 3:1 result is Mendel's classic finding.
```

### Section 3 — Why it works: segregation

```
The 3:1 ratio falls out of Mendel's **law of segregation**: the two alleles of a
gene separate during gamete formation, so each gamete carries exactly one. A
heterozygote *Aa* therefore makes *A* gametes and *a* gametes in equal numbers —
and random pairing at fertilization produces the square above.

Probability shortcut: P(recessive phenotype from *Aa × Aa*) = P(*a* from
mother) × P(*a* from father) = ½ × ½ = ¼ — the same 1-in-4 the square shows.
```

> Notation cheat-sheet: tables render from pipe syntax (the Punnett square
> above); italics `*Aa*` for genotypes; inline math `$\tfrac{1}{4}$` if you
> prefer typeset fractions.

---

## Concept map + objectives (the planning layer)

Open **Plan** and add these concepts, links, and objectives.

**Concepts & prerequisites:**

- `Alleles` → combine into → `Genotype`
- `Dominance` → maps genotype to → `Phenotype`
- `Law of segregation` → predicts → `Monohybrid cross`
- `Monohybrid cross` → yields → `3:1 ratio`

**Per-topic learning objectives:**

| Topic | Objective (students will be able to…) |
|---|---|
| Alleles & dominance | distinguish genotype from phenotype; classify *AA/Aa/aa* |
| Monohybrid cross | build a Punnett square and read off genotype/phenotype ratios |
| Segregation | explain the 3:1 ratio from allele segregation and probability |

---

## AI prompts to try

- **Draft a section:** *"Introduce incomplete dominance using snapdragon flower
  color, and contrast it with the simple dominance in Section 1."*
- **Generate a worksheet:** tick Sections 2–3 → *Generate worksheet*. Expect a
  cross to set up and ratios to predict.

---

## Private instructor material (never reaches the public repo)

**Answer key (private):**

```
Q: In pea plants, purple flowers (P) are dominant to white (p). Cross Pp × pp.
   What fraction of offspring are white?
A: Punnett square gives 2 Pp : 2 pp → 1/2 purple, 1/2 white. So 50% white.
   (A test cross against a homozygous recessive reveals the unknown genotype.)
```

After publishing, confirm it never leaked:
`gh api repos/<you>/mendelian-inheritance-oer/git/trees/main?recursive=1 | grep -i private` → empty.
