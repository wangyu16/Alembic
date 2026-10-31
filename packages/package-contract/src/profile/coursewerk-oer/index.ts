/**
 * The Coursewerk OER profile (FD-09, FD-10): Coursewerk's definitions of a
 * course, mirrored for Alembic's core. Coursewerk owns every rule here;
 * those it hasn't published yet are marked INTERIM and wait for its
 * confirmation (family drift D-126). Pure.
 */
import type { PackageSpace } from "../../spaces";
import type { ContentProfile, PathClass, UnitPart } from "../types";

/** The Coursewerk content definitions this mirror follows (format-contracts/deliverables.md; v3 interim rules on top). */
export const COURSEWERK_CONTENT_VERSION = "0.11.0+alembic-v3-interim";

/** One line, safe inside the document header and a heading. */
const oneLine = (t: string) => t.replace(/\}\}/g, "} }").replace(/[\r\n]+/g, " ").trim().slice(0, 200) || "Untitled chapter";

const header = (title: string, uid: string) => `{{nyml\nkind: document\nformat: 1\ntitle: ${title}\nuid: ${uid}\n}}\n`;

/** A chapter's study guide as it starts. */
export function firstStudyGuide(chapterTitle: string, uid: string): string {
  const title = chapterTitle.replace(/\}\}/g, "} }").replace(/[\r\n]+/g, " ");
  return `${header(title, uid)}\n# ${title}\n\nStart writing here.\n`;
}

// INTERIM (D-126 item 5): starter structures follow the shape of Coursewerk's parts; Coursewerk to confirm.
const PARTS: readonly UnitPart[] = [
  {
    id: "concepts", label: "Concept map", published: false, plan: true,
    path: (s) => `concepts/${s}.md`,
    starter: (title, uid) => {
      const t = oneLine(title);
      return `${header(`Concept Map: ${t}`, uid)}
# Concept Map: ${t}

## Source and Scope

What this chapter is based on (your notes, a textbook chapter), who it is for, and what it covers.

## Chapter Summary

The chapter's story in a paragraph: what students learn, and in what order.

## Prerequisites and Later Payoff

What students need first, and where this chapter is used later.

## Section-Level Concept Map and Objectives

### 1. First section

- **Objective 1a:** what students will be able to do.

## Common Student Bottlenecks

Where students usually get stuck, and why.
`;
    },
  },
  {
    id: "study-guide", label: "Study guide", published: true, plan: false,
    path: (s) => `study-guide/${s}.md`,
    starter: (title, uid) => firstStudyGuide(oneLine(title), uid),
  },
  {
    // INTERIM (D-126 item 1): `.slides.md` with an FC-18 header; Coursewerk still writes `slides/<slug>.md` with a deck block.
    id: "slides", label: "Slides", published: true, plan: false,
    path: (s) => `slides/${s}.slides.md`,
    starter: (title, uid) => {
      const t = oneLine(title);
      return `{{nyml\nkind: document\ncarrier: slides\nuid: ${uid}\ntitle: ${t}\nratio: 16:9\ntheme: paper\n}}

<!-- slide template=title -->
# ${t}

<!-- slide -->
## What we'll cover

- First point
- Second point
`;
    },
  },
  {
    id: "assessment-support", label: "Assessment guide", published: false, plan: true,
    path: (s) => `assessment-support/${s}.md`,
    starter: (title, uid) => {
      const t = oneLine(title);
      return `${header(`Assessment Guide: ${t}`, uid)}
# Assessment Guide: ${t}

## Source and Format

Which concept map this follows, and the kinds of questions used (multiple choice, short answer, workout).

## General Assessment Priorities

- What every question set for this chapter should check.

## Objective 1a: What students will be able to do

### Target understanding

What a student who has met this objective understands.

### Question guides

- A question that checks it, and what a good answer shows.
`;
    },
  },
  {
    id: "practice", label: "Practice", published: true, plan: false,
    path: (s) => `practice/${s}.md`,
    starter: (title, uid) => {
      const t = oneLine(title);
      return `${header(`Practice: ${t}`, uid)}
# Practice: ${t}

:::: tabs
::: tab Q 1
*multiple-choice* Write the question here.

A. First option\\
B. Second option\\
C. Third option\\
D. Fourth option
:::
::: tab Answer
**A.** Why this is the answer.
:::
::::
`;
    },
  },
];

const FOLDERS: Readonly<Record<string, PackageSpace>> = {
  "study-guide": "study-guide",
  slides: "slides",
  practice: "practice",
  concepts: "concepts",
  "assessment-support": "assessment-support",
  assets: "assets",
  current: "current",
  metadata: "metadata",
  provenance: "provenance",
  private: "private",
};

export const coursewerkOerProfile: ContentProfile = {
  id: "coursewerk-oer",
  version: COURSEWERK_CONTENT_VERSION,
  // INTERIM (D-126 item 7): `orz-site.json` is a v3 addition.
  rootFiles: ["alembic.json", "README.md", "LICENSE", "CITATION.cff", ".gitignore", "orz-site.json"],
  folders: FOLDERS,
  serverOnlyFiles: ["private/README.md"],
  // INTERIM (D-126 item 3): Coursewerk's `private/` is free-form.
  privateSubfolders: ["instructor", "sources", "coursewerk", "legacy"],
  recordsFolders: ["private/coursewerk", "provenance/coursewerk"],
  // `concepts/course.md` is the course-wide concept map.
  reservedUnitSlugs: ["course"],
  unitParts: PARTS,
  requiredParts: ["study-guide"],
  // INTERIM (D-126): a document's figures go under assets/<document name>/; Coursewerk to confirm.
  figureFolder(docPath: string): string {
    // A private document's figures stay private (round 1 audit H2): never in the published assets folder.
    const priv = docPath.startsWith("private/");
    const stem = (docPath.split("/").pop() ?? "document").replace(/\.(slides|paged)?\.?md$/i, "").replace(/\.md$/i, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "document";
    return priv ? `private/instructor/figures/${stem}` : `assets/${stem}`;
  },
  // INTERIM (contract v3 §11.4): the figure kinds; Coursewerk to confirm.
  media: { png: "png", jpg: "jpeg", jpeg: "jpeg", gif: "gif", webp: "webp", svg: "svg" },
  licences: {
    // INTERIM (D-126 item 4): Coursewerk's public-OER profile allows the open licences only.
    allowed: ["CC-BY-4.0", "CC-BY-SA-4.0", "CC-BY-NC-4.0", "CC-BY-NC-SA-4.0", "CC0-1.0", "ALL-RIGHTS-RESERVED"],
    open: ["CC-BY-4.0", "CC-BY-SA-4.0", "CC-BY-NC-4.0", "CC-BY-NC-SA-4.0", "CC0-1.0"],
  },
  pathClass(path: string, space: PackageSpace): PathClass {
    if (path === "alembic.json") return "settings";
    if (path.startsWith("private/coursewerk/") || path.startsWith("provenance/coursewerk/")) return "records";
    if (path === "concepts/course.md") return "plan";
    if (!path.includes("/")) return "project-file";
    switch (space) {
      case "concepts":
      case "assessment-support":
        return "plan";
      case "private":
        return path.startsWith("private/instructor/") ? "private-editable" : "private-protected";
      case "study-guide":
      case "slides":
      case "practice":
      case "assets":
      case "current":
        return "material";
      case "metadata":
      case "provenance":
        return "project-file";
    }
  },
  unitProblems(units, files) {
    const required = PARTS.filter((p) => this.requiredParts.includes(p.id));
    const out: string[] = [];
    for (const u of units) for (const p of required) if (!files.has(p.path(u.slug))) out.push(`Chapter “${u.title}” has no ${p.label.toLowerCase()}.`);
    return out;
  },
};
