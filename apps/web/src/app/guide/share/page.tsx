import Link from "next/link";
import { GuidePageShell, GuideSection } from "../_components/guide-page-shell";
import { AdaptFigure } from "../guide-figures";

export const metadata = {
  title: "Share & adapt — Alembic Guide",
  description:
    "Make your work discoverable, adapt other educators' resources for your students with attribution that travels, and suggest improvements back.",
};

export default function SharePage() {
  return (
    <GuidePageShell
      slug="share"
      title="Share & adapt"
      lede="Open resources are worth more when they circulate. Alembic makes reuse easy in both directions — take what fits your students, and give improvements back — with attribution carried automatically."
    >
      <GuideSection heading="List your work publicly">
        <p>
          Publishing makes your course a live website;{" "}
          <strong>List publicly</strong>{" "}puts it on the map. It is a separate,
          deliberate step: choose <strong>List publicly</strong>{" "}and your course —
          or a single asset — joins <Link href="/portal">Discover</Link>,
          Alembic&rsquo;s public index, where other educators can search for it,
          adapt it, and build on it. You decide what goes out, and you can unlist
          at any time.
        </p>
      </GuideSection>

      <GuideSection
        heading="Reuse, and improve together"
        figure={<AdaptFigure />}
        figureCaption="A colleague adapts your course; a copper arrow carries an improvement back to you, with attribution along for the ride."
      >
        <p>
          Anything on <Link href="/portal">Discover</Link>{" "}can be{" "}
          <strong>adapted</strong>: take a course, a module, or a single figure,
          and make it fit your students. Attribution travels automatically, so
          credit is never lost. If you fix or improve something you adapted, you
          can <strong>suggest the change back</strong>{" "}— the original author
          reviews it in plain language and accepts with one click.
        </p>
      </GuideSection>

      <GuideSection heading="Share small — it counts">
        <p>
          You don&rsquo;t need a finished course to contribute. A single clear
          illustration, a well-worked derivation, a clean explanation of one
          stubborn concept — small pieces like these are exactly what other
          educators search for. <strong>List publicly</strong>{" "}works at that
          scale too: a single asset can join Discover on its own, for others to
          find and build on.
        </p>
      </GuideSection>

      <GuideSection heading="Licensing, kept simple">
        <p>
          Every package carries a <strong>license</strong>{" "}you chose (a Creative
          Commons license or a public-domain dedication). It travels with the
          materials and with every adaptation, so anyone reusing your work knows
          the terms — and you know the terms of anything you reuse. That&rsquo;s
          what keeps the whole ecosystem open and safe to build on.
        </p>
      </GuideSection>
    </GuidePageShell>
  );
}
