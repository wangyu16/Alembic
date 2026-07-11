/**
 * Concept illustrations for the guide — line diagrams in the house idiom:
 * muted base strokes inherit `currentColor` from the parent; the one meaningful
 * detail is copper (`var(--accent)`). Stroke 1.5, round caps, flat (no fills but
 * soft copper washes). Each is a self-describing figure: `role="img"` + a
 * `<title>`/`<desc>` so it reads to assistive tech, and it scales with its
 * container (`w-full h-auto`). Larger cousins of the 48px vignettes on the guide
 * home.
 */

const S = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

const frame = "w-full h-auto text-muted";
const copper = "text-[var(--accent)]";

function Figure({
  title,
  desc,
  viewBox,
  children,
}: {
  title: string;
  desc: string;
  viewBox: string;
  children: React.ReactNode;
}) {
  return (
    <svg viewBox={viewBox} role="img" aria-label={title} className={frame}>
      <title>{title}</title>
      <desc>{desc}</desc>
      {children}
    </svg>
  );
}

/** A package = one public half + one private half, physically separated. */
export function PackageFigure() {
  return (
    <Figure
      viewBox="0 0 260 150"
      title="A course package: a public half and a private half"
      desc="One package holds two sides. The public side carries student-facing materials; the private side, marked with a lock, holds answer keys and instructor notes. A wall between them means private content can never cross into the public side."
    >
      {/* bracket: one package over both halves */}
      <g {...S} aria-hidden>
        <path d="M18 26c-6 0-6 4-6 9M242 26c6 0 6 4 6 9" opacity="0.5" />
        <path d="M12 35v14M248 35v14" opacity="0.5" />
      </g>
      {/* public half */}
      <g {...S} aria-hidden>
        <rect x="22" y="46" width="94" height="86" rx="6" />
        <path d="M36 66h66M36 80h66M36 94h44" />
        <rect x="36" y="106" width="26" height="16" rx="2" />
      </g>
      {/* dividing wall */}
      <g {...S} aria-hidden>
        <path d="M130 40v98" strokeDasharray="2 6" opacity="0.6" />
      </g>
      {/* private half */}
      <g {...S} aria-hidden>
        <rect x="144" y="46" width="94" height="86" rx="6" />
        <path d="M158 80h66M158 94h48M158 108h58" opacity="0.55" />
      </g>
      {/* copper lock on the private half */}
      <g {...S} className={copper} aria-hidden>
        <rect x="176" y="58" width="30" height="22" rx="3" />
        <path d="M184 58v-5a7 7 0 0 1 14 0v5" />
        <circle cx="191" cy="69" r="2.4" />
      </g>
    </Figure>
  );
}

/** The study guide is the spine; slides / practice / concept map derive from it. */
export function SpineFigure() {
  return (
    <Figure
      viewBox="0 0 260 150"
      title="The study guide is the spine; other documents derive from it"
      desc="A central study guide, drawn in copper, feeds three derived documents — slides, practice, and a concept map — each linked back to it so a change in the guide flags what is out of date."
    >
      {/* derived documents */}
      <g {...S} aria-hidden>
        <rect x="188" y="14" width="56" height="34" rx="4" />
        <path d="M198 24h30M198 31h30M198 38h20" />
        <rect x="188" y="58" width="56" height="34" rx="4" />
        <path d="M198 68h30M198 75h30M198 82h20" />
        <rect x="188" y="102" width="56" height="34" rx="4" />
        <path d="M198 112h30M198 119h30M198 126h20" />
      </g>
      {/* traceable links back to the spine (dashed) */}
      <g {...S} aria-hidden opacity="0.55">
        <path d="M74 60c40-16 74-24 110-27" strokeDasharray="2 5" />
        <path d="M74 75h110" strokeDasharray="2 5" />
        <path d="M74 90c40 16 74 24 110 27" strokeDasharray="2 5" />
      </g>
      {/* the spine: study guide, copper */}
      <g {...S} className={copper} aria-hidden>
        <rect x="26" y="30" width="48" height="90" rx="5" />
        <path d="M50 30v90" opacity="0.5" />
        <path d="M34 44h9M34 54h9M34 64h9M34 74h9M34 84h9" />
      </g>
    </Figure>
  );
}

/** Three collections: shared Assets, the Current term, and Private materials. */
export function CollectionsFigure() {
  return (
    <Figure
      viewBox="0 0 270 140"
      title="Three collections: Assets, Current, and Private"
      desc="Assets holds reusable figures and files. Current holds this term's announcements and assignments. Private, marked with a lock, holds instructor-only materials."
    >
      {/* Assets bin */}
      <g {...S} aria-hidden>
        <path d="M20 52h64v56a6 6 0 0 1-6 6H26a6 6 0 0 1-6-6z" />
        <path d="M20 52l8-14h48l8 14" />
        <rect x="40" y="70" width="18" height="16" rx="2" />
        <path d="M46 70v-4a3 3 0 0 1 6 0v4" opacity="0.6" />
      </g>
      {/* Current bin */}
      <g {...S} aria-hidden>
        <path d="M103 52h64v56a6 6 0 0 1-6 6h-52a6 6 0 0 1-6-6z" />
        <path d="M103 52l8-14h48l8 14" />
        <path d="M119 72h32M119 82h32M119 92h20" />
      </g>
      {/* Private bin with copper lock */}
      <g {...S} aria-hidden>
        <path d="M186 52h64v56a6 6 0 0 1-6 6h-52a6 6 0 0 1-6-6z" />
        <path d="M186 52l8-14h48l8 14" />
      </g>
      <g {...S} className={copper} aria-hidden>
        <rect x="205" y="74" width="26" height="20" rx="3" />
        <path d="M212 74v-4a6 6 0 0 1 12 0v4" />
        <circle cx="218" cy="84" r="2.2" />
      </g>
    </Figure>
  );
}

/** A permalink: a stable copper anchor that survives rename and move. */
export function PermalinkFigure() {
  return (
    <Figure
      viewBox="0 0 260 140"
      title="A permalink stays fixed while the document moves"
      desc="A document carries a stable copper link. When the document is renamed or moved to another place in the course, the link keeps pointing to it — so a citation never breaks."
    >
      {/* original doc (ghosted) */}
      <g {...S} aria-hidden opacity="0.4">
        <rect x="24" y="26" width="58" height="76" rx="5" />
        <path d="M36 44h34M36 54h34M36 64h22" />
      </g>
      {/* move arrow */}
      <g {...S} aria-hidden opacity="0.6">
        <path d="M92 66h58" strokeDasharray="2 5" />
        <path d="M150 66l-7-5M150 66l-7 5" />
      </g>
      {/* moved / renamed doc */}
      <g {...S} aria-hidden>
        <rect x="160" y="38" width="58" height="76" rx="5" />
        <path d="M172 56h34M172 66h34M172 76h22" />
      </g>
      {/* the copper link, unchanged, tethering both */}
      <g {...S} className={copper} aria-hidden>
        <path d="M60 100l14 18" strokeDasharray="0" opacity="0.5" />
        <path d="M196 112l-14 6" opacity="0.5" />
        <g transform="translate(112 104)">
          <rect x="-18" y="-9" width="20" height="18" rx="9" />
          <rect x="-2" y="-9" width="20" height="18" rx="9" />
          <path d="M-6 0h12" />
        </g>
      </g>
    </Figure>
  );
}

/** A self-contained document with its editor built into the file. */
export function SelfContainedFigure() {
  return (
    <Figure
      viewBox="0 0 220 150"
      title="Each document carries its own editor"
      desc="A single file opens in any browser to read, and a copper pencil inside it means the editor travels with the file — download it and it stays editable, with nothing to install."
    >
      <g {...S} aria-hidden>
        <rect x="40" y="18" width="120" height="118" rx="7" />
        <path d="M40 40h120" opacity="0.6" />
        <circle cx="52" cy="29" r="2" opacity="0.6" />
        <circle cx="60" cy="29" r="2" opacity="0.6" />
        <path d="M58 58h84M58 72h84M58 86h60M58 100h84M58 114h46" opacity="0.7" />
      </g>
      {/* copper pencil, inside the file */}
      <g {...S} className={copper} aria-hidden>
        <path d="M150 92l14 14-30 30-16 3 3-16 29-31z" transform="translate(-4 -6) scale(0.85)" />
      </g>
    </Figure>
  );
}

/** Publish: your materials become a website on infrastructure you own. */
export function PublishFigure() {
  return (
    <Figure
      viewBox="0 0 260 140"
      title="Publishing builds a course website that is yours to keep"
      desc="Your package on the left becomes a public course website on the right, hosted under your own account — a copper arrow marks the deliberate step of publishing."
    >
      <g {...S} aria-hidden>
        <rect x="22" y="34" width="70" height="72" rx="5" />
        <path d="M34 50h46M34 60h46M34 70h30" />
        <rect x="34" y="82" width="20" height="14" rx="2" />
      </g>
      {/* browser window */}
      <g {...S} aria-hidden>
        <rect x="162" y="30" width="82" height="80" rx="5" />
        <path d="M162 44h82" />
        <circle cx="171" cy="37" r="1.8" opacity="0.6" />
        <circle cx="178" cy="37" r="1.8" opacity="0.6" />
        <path d="M176 60h54M176 72h54M176 84h34" opacity="0.75" />
      </g>
      {/* copper publish arrow */}
      <g {...S} className={copper} aria-hidden>
        <path d="M104 70h44" />
        <path d="M148 70l-8-6M148 70l-8 6" />
        <path d="M126 56v-3M133 58l2-2M119 58l-2-2" opacity="0.7" />
      </g>
    </Figure>
  );
}
