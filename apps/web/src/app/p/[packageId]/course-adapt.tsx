"use client";

import Link from "next/link";
import { useId, useState, useTransition } from "react";
import { adaptFromPortalAction } from "@/app/workspace/[packageId]/adapt-actions";

export interface CourseAdaptTarget {
  id: string;
  title: string;
  chapters: Array<{ slug: string; title: string; path: string }>;
}

/**
 * "Adapt this course" on a course page (Phase 5 Track A.4): the SOURCE is
 * preselected — this course — so the educator only picks which of its
 * chapters, and which of their own chapters receives the sections. The
 * server action re-checks everything (the source is listed now, the licence
 * allows it, the target chapter is theirs) and keeps attribution.
 */
export function CourseAdapt({
  sourcePackageId,
  sourceChapters,
  targets,
}: {
  sourcePackageId: string;
  sourceChapters: string[];
  targets: CourseAdaptTarget[];
}) {
  const uid = useId();
  const [sourceIndex, setSourceIndex] = useState(0);
  const [targetId, setTargetId] = useState(targets[0]?.id ?? "");
  const target = targets.find((t) => t.id === targetId) ?? targets[0];
  const [chapterPath, setChapterPath] = useState(target?.chapters[0]?.path ?? "");
  const [pending, start] = useTransition();
  const [result, setResult] = useState<
    { ok: true; text: string; href: string } | { ok: false; text: string } | null
  >(null);

  if (!target) return null;
  const chapter = target.chapters.find((c) => c.path === chapterPath) ?? target.chapters[0];

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chapter) return;
    setResult(null);
    start(async () => {
      const r = await adaptFromPortalAction(
        target.id,
        sourcePackageId,
        chapter.path,
        sourceChapters.length > 0
          ? { index: sourceIndex, title: sourceChapters[sourceIndex] ?? "" }
          : undefined,
      );
      if (!r.ok) {
        setResult({ ok: false, text: r.error ?? "That didn't work. Please try again." });
        return;
      }
      setResult({
        ok: true,
        text: `Added ${r.adapted ?? 0} section${r.adapted === 1 ? "" : "s"} to “${chapter.title}” in “${target.title}”, with attribution.`,
        href: `/workspace/${encodeURIComponent(target.id)}/edit?chapter=${encodeURIComponent(chapter.slug)}`,
      });
    });
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      {sourceChapters.length > 1 && (
        <label htmlFor={`${uid}-src`} className="flex flex-col gap-1 text-sm">
          <span className="text-muted">From this course&rsquo;s chapter</span>
          <select
            id={`${uid}-src`}
            value={sourceIndex}
            onChange={(e) => setSourceIndex(Number(e.target.value))}
            className="field text-sm"
          >
            {sourceChapters.map((t, i) => (
              <option key={`${i}-${t}`} value={i}>
                {t}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="flex flex-wrap gap-3">
        <label htmlFor={`${uid}-course`} className="flex min-w-[12rem] flex-1 flex-col gap-1 text-sm">
          <span className="text-muted">Into your course</span>
          <select
            id={`${uid}-course`}
            value={target.id}
            onChange={(e) => {
              setTargetId(e.target.value);
              const t = targets.find((x) => x.id === e.target.value);
              setChapterPath(t?.chapters[0]?.path ?? "");
            }}
            className="field text-sm"
          >
            {targets.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor={`${uid}-chapter`} className="flex min-w-[12rem] flex-1 flex-col gap-1 text-sm">
          <span className="text-muted">Chapter</span>
          <select
            id={`${uid}-chapter`}
            value={chapter?.path ?? ""}
            onChange={(e) => setChapterPath(e.target.value)}
            className="field text-sm"
          >
            {target.chapters.map((c) => (
              <option key={c.path} value={c.path}>
                {c.title}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending || !chapter} className="btn btn-primary btn-sm">
          {pending ? "Adding…" : "Add its sections"}
        </button>
      </div>
      <div aria-live="polite" className="text-sm">
        {result?.ok === true && (
          <p className="text-ok">
            {result.text}{" "}
            <Link href={result.href} className="link">
              Open it
            </Link>
          </p>
        )}
        {result?.ok === false && <p className="text-danger">{result.text}</p>}
      </div>
    </form>
  );
}
