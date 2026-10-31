/**
 * The guide's information architecture — one source of truth for the sidebar,
 * the home card hub, and per-page prev/next. Two layers (owner's brief,
 * 2026-10-29): "Start here" (the first hour, and a fast path for people who
 * already know their course) and "Everything in detail" (one page per area).
 * Every page describes only what works today; designed-but-not-built features
 * live on "Coming later".
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
    key: "start",
    label: "Start here",
    caption: "New to Alembic? Take the first hour. Already know your course? Take the fast path.",
    pages: [
      {
        slug: "start",
        href: "/guide/start",
        title: "Quick start: your first hour",
        blurb: "Sign in, make a course, write a study guide and slides, and publish a course website.",
        status: "live",
      },
      {
        slug: "fast-path",
        href: "/guide/fast-path",
        title: "Fast path for experienced users",
        blurb: "Your whole table of contents in one step, every part started, ready, published.",
        status: "live",
      },
    ],
  },
  {
    key: "detail",
    label: "Everything in detail",
    caption: "One page per part of the work. Read them in any order.",
    pages: [
      {
        slug: "courses",
        href: "/guide/courses",
        title: "Courses and chapters",
        blurb: "Making a course, the five parts of a chapter, adding chapters, and the course page.",
        status: "live",
      },
      {
        slug: "writing",
        href: "/guide/writing",
        title: "Writing and saving",
        blurb: "The editor, its three views, and exactly when your words reach the course.",
        status: "live",
      },
      {
        slug: "together",
        href: "/guide/together",
        title: "Working together",
        blurb: "Owner, deputy and co-author; inviting people; writing in the same document.",
        status: "live",
      },
      {
        slug: "publish",
        href: "/guide/publish",
        title: "Publishing and your website",
        blurb: "When a chapter is ready, approving the course plan, Publish, and your course website.",
        status: "live",
      },
      {
        slug: "download",
        href: "/guide/download",
        title: "Download and present",
        blurb: "Take a document with you as one file, and show your slides in class.",
        status: "live",
      },
      {
        slug: "formats",
        href: "/guide/formats",
        title: "Writing formats",
        blurb: "Headings, tables, math, chemistry, boxes, tabs, questions and slides — with examples.",
        status: "live",
      },
      {
        slug: "try",
        href: "/guide/try",
        title: "Try it without an account",
        blurb: "A sample chapter on any topic in about a minute. Nothing is kept.",
        status: "live",
      },
      {
        slug: "coming-later",
        href: "/guide/coming-later",
        title: "Coming later",
        blurb: "What is planned but not here yet, and what to do in the meantime.",
        status: "live",
      },
      {
        slug: "help",
        href: "/guide/help",
        title: "Help and contact",
        blurb: "Write to us, workshops, and answers to common questions.",
        status: "live",
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
