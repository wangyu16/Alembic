import { GuideSidebar } from "./guide-sidebar";
import { GuideFooterNav } from "./guide-footer-nav";

/**
 * The frame every guide article shares: a sticky sidebar (drawer on mobile), a
 * readable article column capped near 65–75ch, a serif title with the house `#`
 * mono prefix, and prev/next at the foot. The home page does not use this — it
 * is the full-width card hub.
 */
export function GuidePageShell({
  slug,
  title,
  lede,
  children,
}: {
  slug: string;
  title: string;
  lede: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-6xl flex-1 px-6 py-8 lg:flex lg:gap-10 lg:py-14">
      <GuideSidebar />
      <main className="min-w-0 flex-1">
        <article className="mx-auto max-w-[68ch]">
          <header className="flex flex-col gap-4">
            <h1 className="font-serif text-3xl leading-[1.12] tracking-tight text-ink text-balance sm:text-4xl">
              <span aria-hidden className="mr-3 font-mono text-[0.7em] text-faint select-none">
                #
              </span>
              {title}
            </h1>
            <p className="text-lg leading-relaxed text-muted text-pretty">{lede}</p>
          </header>
          <div className="mt-10 flex flex-col gap-10">{children}</div>
          <GuideFooterNav slug={slug} />
        </article>
      </main>
    </div>
  );
}

/**
 * A screenshot of the real product (captured from the testing site, kept under
 * public/guide/). Width and height are the image's own, so the page doesn't
 * jump while it loads; the alt text says what the picture shows.
 */
export function GuideShot({
  src,
  alt,
  width,
  height,
  caption,
}: {
  src: string;
  alt: string;
  width: number;
  height: number;
  caption?: string;
}) {
  return (
    <figure className="my-1 flex flex-col gap-2">
      {/* Static screenshots: a plain img keeps them as they are (no resizing service). */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        width={width}
        height={height}
        loading="lazy"
        decoding="async"
        className="h-auto w-full rounded-lg border border-edge bg-surface"
      />
      {caption && <figcaption className="text-sm text-muted">{caption}</figcaption>}
    </figure>
  );
}

/** A short aside inside a section: a tip, or something to watch for. */
export function GuideNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-edge bg-surface px-4 py-3 text-[0.95rem] leading-relaxed text-muted">
      {children}
    </div>
  );
}

/** A small block of example text, shown exactly as you would type it. */
export function GuideExample({ children, label }: { children: string; label?: string }) {
  return (
    <figure className="flex flex-col gap-1.5">
      {label && <figcaption className="text-sm text-faint">{label}</figcaption>}
      <pre className="overflow-x-auto rounded-lg border border-edge bg-surface px-4 py-3 font-mono text-[0.85rem] leading-relaxed text-ink">
        {children}
      </pre>
    </figure>
  );
}

/**
 * One section of a guide article: an optional line figure, a serif subhead, and
 * prose. The figure sits in a quiet framed panel so the line art has room to
 * breathe. `wide` drops the panel for a full-measure block of prose.
 */
export function GuideSection({
  heading,
  figure,
  figureCaption,
  children,
}: {
  heading: string;
  figure?: React.ReactNode;
  figureCaption?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="font-serif text-xl tracking-tight text-ink">{heading}</h2>
      {figure && (
        <figure className="my-1 flex flex-col items-center gap-3 rounded-xl border border-edge bg-surface px-4 py-6">
          <div className="w-full max-w-md">{figure}</div>
          {figureCaption && (
            <figcaption className="max-w-prose text-center text-sm text-muted">
              {figureCaption}
            </figcaption>
          )}
        </figure>
      )}
      <div className="flex flex-col gap-4 text-[0.975rem] leading-relaxed text-muted [&_a]:text-[var(--accent)] [&_a:hover]:underline [&_strong]:text-ink [&_ol]:list-decimal [&_ol]:pl-6 [&_ul]:list-disc [&_ul]:pl-6 [&_li]:mt-1.5 [&_kbd]:rounded [&_kbd]:border [&_kbd]:border-edge [&_kbd]:px-1 [&_kbd]:font-mono [&_kbd]:text-[0.85em] [&_p_code]:rounded [&_p_code]:bg-surface [&_p_code]:px-1 [&_p_code]:font-mono [&_p_code]:text-[0.88em] [&_p_code]:text-ink [&_li_code]:rounded [&_li_code]:bg-surface [&_li_code]:px-1 [&_li_code]:font-mono [&_li_code]:text-[0.88em] [&_li_code]:text-ink">
        {children}
      </div>
    </section>
  );
}
