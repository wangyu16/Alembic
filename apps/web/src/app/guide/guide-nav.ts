/**
 * The guide's information architecture — one source of truth for the sidebar,
 * the home card hub, and per-page prev/next. Two groups: Understand (the mental
 * model) and Do (task walkthroughs). Do pages are Phase B; they appear in the
 * structure as "soon" so the shape of the guide is visible and honest.
 */

export type GuideStatus = "live" | "soon";

export interface GuidePage {
  slug: string; // "" for the guide home
  href: string;
  title: string;
  /** One-line summary for the card hub + sidebar tooltip. */
  blurb: string;
  status: GuideStatus;
}

export interface GuideGroup {
  key: string;
  label: string;
  /** A short line under the group heading on the home hub. */
  caption: string;
  pages: GuidePage[];
}

export const GUIDE_GROUPS: GuideGroup[] = [
  {
    key: "understand",
    label: "Understand",
    caption: "The ideas Alembic is built on — read these once and the rest is obvious.",
    pages: [
      {
        slug: "ideas",
        href: "/guide/ideas",
        title: "Core ideas",
        blurb: "What Alembic is, in five plain ideas — and why your work stays yours.",
        status: "live",
      },
      {
        slug: "anatomy",
        href: "/guide/anatomy",
        title: "Anatomy of a package",
        blurb: "Everything a course package holds, and what each part is for.",
        status: "live",
      },
      {
        slug: "structure",
        href: "/guide/structure",
        title: "Documents & collections",
        blurb: "The blueprint you plan, the course materials assembled from it, and the three collections.",
        status: "live",
      },
      {
        slug: "permalinks",
        href: "/guide/permalinks",
        title: "Citing, versions & links",
        blurb: "Stable links that survive edits, inserting a figure, and snapshots you can cite.",
        status: "live",
      },
    ],
  },
  {
    key: "do",
    label: "Do",
    caption: "Step-by-step walkthroughs for each part of the workflow.",
    pages: [
      {
        slug: "start",
        href: "/guide/start",
        title: "Getting started",
        blurb: "Your first package: create, write, preview, publish.",
        status: "soon",
      },
      {
        slug: "authoring",
        href: "/guide/authoring",
        title: "Creating & editing",
        blurb: "The in-file editors, AI help, inserting figures, and the download → replace round-trip.",
        status: "soon",
      },
      {
        slug: "offline",
        href: "/guide/offline",
        title: "Work offline & upload",
        blurb: "Edit a document offline, or build a whole package and upload it as a .zip.",
        status: "soon",
      },
      {
        slug: "publish",
        href: "/guide/publish",
        title: "Publishing",
        blurb: "What publishing does, your course website, and “this term.”",
        status: "soon",
      },
      {
        slug: "share",
        href: "/guide/share",
        title: "Share & adapt",
        blurb: "Discover others' work, adapt it for your students, and suggest changes back.",
        status: "soon",
      },
    ],
  },
];

/** Flattened, in-reading-order list of the LIVE pages — for prev/next. */
export const GUIDE_ORDER: GuidePage[] = GUIDE_GROUPS.flatMap((g) =>
  g.pages.filter((p) => p.status === "live"),
);

/** The prev/next neighbours of a live page, by slug. */
export function guideNeighbours(slug: string): {
  prev: GuidePage | null;
  next: GuidePage | null;
} {
  const i = GUIDE_ORDER.findIndex((p) => p.slug === slug);
  if (i === -1) return { prev: null, next: null };
  return {
    prev: i > 0 ? GUIDE_ORDER[i - 1] : null,
    next: i < GUIDE_ORDER.length - 1 ? GUIDE_ORDER[i + 1] : null,
  };
}
