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

/** The two tiers: a plain-text blueprint, assembled by AI into course materials. */
export function BlueprintFigure() {
  return (
    <Figure
      viewBox="0 0 280 150"
      title="Your plain-text blueprint is assembled by AI into the course materials"
      desc="On the left, a concise blueprint — a concept map of linked ideas and a checklist of objectives, in copper. An arrow marked with a spark shows AI assembling it into the finished course materials on the right: a central study guide with slides and practice around it."
    >
      {/* Blueprint: concept map + objectives (the plan), copper */}
      <g {...S} className={copper} aria-hidden>
        <circle cx="34" cy="40" r="7" />
        <circle cx="72" cy="30" r="7" />
        <circle cx="58" cy="68" r="7" />
        <path d="M40 44l12 20M64 35l-2 26M41 39h24" opacity="0.7" />
        <path d="M24 96h44M24 108h32" />
        <path d="M20 96l-3 3M20 108l-3 3" opacity="0.6" />
      </g>
      {/* AI assembly arrow with a spark */}
      <g {...S} aria-hidden>
        <path d="M104 74h58" />
        <path d="M162 74l-8-6M162 74l-8 6" />
      </g>
      <g {...S} className={copper} aria-hidden>
        <path d="M133 50v10M128 55h10M130 52l6 6M136 52l-6 6" opacity="0.9" />
      </g>
      {/* Course materials: study guide (copper center) + slides/practice */}
      <g {...S} aria-hidden>
        <rect x="200" y="16" width="52" height="28" rx="3" />
        <path d="M208 25h36M208 32h24" />
        <rect x="200" y="106" width="52" height="28" rx="3" />
        <path d="M208 115h36M208 122h24" />
        <path d="M226 44v10M226 96v10" opacity="0.5" strokeDasharray="2 4" />
      </g>
      <g {...S} className={copper} aria-hidden>
        <rect x="196" y="56" width="60" height="38" rx="4" />
        <path d="M204 66h44M204 74h44M204 82h30" />
      </g>
    </Figure>
  );
}

/** Getting started: create → author → preview → publish → list publicly. */
export function StepsFigure() {
  return (
    <Figure
      viewBox="0 0 330 96"
      title="Five steps: create, author, preview, publish, and list publicly"
      desc="A left-to-right flow — create a package, author its documents, preview them, publish to a live website, and (optionally) list it publicly on Discover. Publish and the final list-publicly step are in copper because each is a deliberate choice you approve."
    >
      {/* create */}
      <g {...S} aria-hidden>
        <rect x="8" y="30" width="36" height="36" rx="4" />
        <path d="M26 40v16M18 48h16" />
      </g>
      {/* author */}
      <g {...S} aria-hidden>
        <rect x="74" y="30" width="36" height="36" rx="4" />
        <path d="M82 41h20M82 48h20M82 55h12" />
      </g>
      {/* preview */}
      <g {...S} aria-hidden>
        <rect x="140" y="30" width="36" height="36" rx="4" />
        <circle cx="158" cy="48" r="7.5" />
        <circle cx="158" cy="48" r="2.2" />
      </g>
      {/* publish (copper — deliberate) */}
      <g {...S} className={copper} aria-hidden>
        <rect x="206" y="30" width="36" height="36" rx="4" />
        <path d="M224 58V38M216 46l8-8 8 8" />
      </g>
      {/* list publicly / share (copper — the sharing step) */}
      <g {...S} className={copper} aria-hidden>
        <rect x="272" y="30" width="36" height="36" rx="4" />
        <circle cx="290" cy="48" r="2.4" />
        <path d="M283 41a10 10 0 0 1 0 14M297 41a10 10 0 0 0 0 14" />
      </g>
      {/* connectors */}
      <g {...S} aria-hidden opacity="0.6">
        <path d="M48 48h22M70 48l-5-3M70 48l-5 3" />
        <path d="M114 48h22M136 48l-5-3M136 48l-5 3" />
        <path d="M180 48h22M202 48l-5-3M202 48l-5 3" />
        <path d="M246 48h22M268 48l-5-3M268 48l-5 3" />
      </g>
    </Figure>
  );
}

/** The round-trip: download a document, edit it offline, upload to replace. */
export function RoundTripFigure() {
  return (
    <Figure
      viewBox="0 0 220 150"
      title="Download a document, edit it offline, upload it to replace the original"
      desc="A document in Alembic is downloaded, edited offline with a copper pencil, and uploaded back to replace the same document — a loop that keeps its identity."
    >
      {/* document in Alembic */}
      <g {...S} aria-hidden>
        <rect x="82" y="16" width="56" height="34" rx="4" />
        <path d="M92 26h36M92 33h36M92 40h22" />
      </g>
      {/* download arrow (left, down) */}
      <g {...S} aria-hidden opacity="0.7">
        <path d="M78 40c-30 6-42 24-42 40" />
        <path d="M36 80l-4-6M36 80l5-5" />
      </g>
      {/* offline edit */}
      <g {...S} aria-hidden>
        <rect x="14" y="92" width="44" height="42" rx="4" />
        <path d="M22 102h20M22 109h20" />
      </g>
      <g {...S} className={copper} aria-hidden>
        <path d="M50 112l8 8-14 14-8 2 2-8 12-16z" />
      </g>
      {/* replace arrow (right, up) */}
      <g {...S} className={copper} aria-hidden>
        <path d="M64 118c60-6 92-30 78-64" strokeDasharray="0" opacity="0.85" />
        <path d="M142 54l0 8M142 54l7 3" />
      </g>
    </Figure>
  );
}

/** Share & adapt: your work is reused, improvements flow back. */
export function AdaptFigure() {
  return (
    <Figure
      viewBox="0 0 240 140"
      title="Others adapt your course, and can suggest improvements back"
      desc="Your package on the left is adapted into a colleague's copy on the right; a copper arrow shows an improvement suggested back to you, with attribution carried along."
    >
      {/* your package */}
      <g {...S} aria-hidden>
        <rect x="20" y="42" width="60" height="56" rx="5" />
        <path d="M32 56h36M32 66h36M32 76h22" />
      </g>
      {/* adapted copy */}
      <g {...S} aria-hidden>
        <rect x="160" y="42" width="60" height="56" rx="5" />
        <path d="M172 56h36M172 66h36M172 76h22" />
      </g>
      {/* adapt arrow (yours → copy), with attribution tag */}
      <g {...S} aria-hidden opacity="0.7">
        <path d="M84 58c30-14 46-14 72 0" />
        <path d="M156 58l-8-2M156 58l-6 5" />
      </g>
      <g {...S} className={copper} aria-hidden>
        <circle cx="120" cy="47" r="4" />
        <path d="M120 45v4M118 47h4" opacity="0.8" />
      </g>
      {/* suggest-back arrow (copy → yours), copper */}
      <g {...S} className={copper} aria-hidden>
        <path d="M156 86c-30 14-46 14-72 0" />
        <path d="M84 86l8 2M84 86l6-5" />
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
