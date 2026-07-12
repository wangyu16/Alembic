import Link from "next/link";
import { GuidePageShell, GuideSection } from "../_components/guide-page-shell";
import { SelfContainedFigure, PermalinkFigure } from "../guide-figures";

export const metadata = {
  title: "Creating & editing — Alembic Guide",
  description:
    "How editing works: the in-file editors, AI assistance, inserting figures from Assets, and the download → edit → replace round-trip on every document.",
};

export default function AuthoringPage() {
  return (
    <GuidePageShell
      slug="authoring"
      title="Creating & editing"
      lede="Every document edits the same way, whether you write it here or an agent assembles it. You review, adjust, and decide — the tools stay out of your way."
    >
      <GuideSection
        heading="Edit inside the document"
        figure={<SelfContainedFigure />}
        figureCaption="Each document carries its own editor; your changes save with the Save button in the document's own toolbar."
      >
        <p>
          Open a study guide, slide deck, or practice set and it edits{" "}
          <strong>in place</strong>{" "}— the editor is built into the file. Make your
          changes and save; Alembic keeps the markdown source of truth behind it.
          The same document can be downloaded and edited offline just as easily
          (below).
        </p>
      </GuideSection>

      <GuideSection heading="Let AI do the tedious work">
        <p>
          The mechanical part of authoring — consistent formatting, accessibility,
          spelling and grammar, tightening and re-organizing language — is what AI
          takes off your plate. You draft and steer; AI polishes: you keep the
          substance and skip the drudgery.
        </p>
        <p>
          Where an account is approved for AI, the in-file editor offers an{" "}
          <strong>assistant</strong>: improve a selection, or run an operation over
          the whole document — restructure, tighten, check for issues. The AI
          drafts; you review and apply. High-stakes work always waits for your
          approval, so review effort lands where the stakes are.
        </p>
      </GuideSection>

      <GuideSection
        heading="Insert a figure once, reuse it anywhere"
        figure={<PermalinkFigure />}
        figureCaption="An inserted asset carries a permalink, so the same figure works in every document it appears in — and in downloaded copies."
      >
        <p>
          Put a figure, chemical structure, or plot in your <strong>Assets</strong>{" "}
          collection, then <strong>Insert</strong>{" "}it into any document. What gets
          placed is the asset&rsquo;s permalink, so it renders anywhere the
          document travels — see{" "}
          <Link href="/guide/permalinks">Citing, versions &amp; links</Link>.
        </p>
      </GuideSection>

      <GuideSection heading="Prefer to edit elsewhere? Download and replace">
        <p>
          Every document has <strong>Download</strong>{" "}and{" "}
          <strong>Replace</strong>{" "}controls. Download the source, edit it in
          whatever tool you like, and upload it back to replace the current
          version — its address and identity stay put, so links never break. The
          full offline story is in{" "}
          <Link href="/guide/offline">Work offline &amp; upload</Link>.
        </p>
      </GuideSection>
    </GuidePageShell>
  );
}
