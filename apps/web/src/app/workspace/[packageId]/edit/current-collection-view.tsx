"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import {
  CREATABLE_FILE_TYPES,
  CURRENT_SECTIONS,
  SECTION_META,
  currentSpaceDir,
  editorKindForPath,
  isCurrentSection,
  isSeededOnCreate,
  type CollectionScope,
  type CurrentSection,
  type EditorKind,
  type FileTypeDef,
} from "@alembic/package-contract";
import {
  collectionItemPath,
  type CollectionScopeTree,
  type FileLeaf,
  type FolderNode,
  type TermInfo,
} from "@alembic/package-ops";
import { isBinaryPath } from "@/lib/collection-upload";
import {
  uploadCollectionFileAction,
  createCollectionFileAction,
  loadCollectionFileAction,
  deleteCollectionEntryAction,
  renameCollectionFileAction,
} from "../collection-actions";
import { CollectionEditorPane } from "./collection-editor-pane";
import {
  startTermAction,
  activateTermAction,
  setTermLabelAction,
  postAnnouncementAction,
} from "../term-actions";

/**
 * Current collection (CF5.4) — the ACTIVE teaching term of a course. It rides
 * the same folder-tree/upload/create machinery as the Assets collection
 * (`AssetsCollectionView`), configured for the public `current/<term-id>` space
 * (contract `currentSpaceDir`), and layers on the term-specific surface: a term
 * switcher, a "start a term" flow, the reserved section grouping
 * (announcements / assignments / other), and an announcement composer.
 *
 * Educator language only — never surface Git/repo concepts (CLAUDE.md). There
 * is deliberately NO Insert / Metadata / share here: Current holds what a class
 * sees now, not reusable Discover assets (those are Assets-only).
 *
 * Two-repo invariant: the Current space is PUBLIC. Every write goes to
 * `repo: "public"` through the one validated collection write door; nothing here
 * ever touches the private repo.
 */

interface Chapter {
  slug: string;
  title: string;
}

/** Read a browser File as UTF-8 text, or base64 for a binary. (Copied from
 *  studio-shell's `readFileContent`, same as AssetsCollectionView.) */
function readFileContent(file: File): Promise<{ content: string; isBinary: boolean }> {
  const isBinary = isBinaryPath(file.name);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const result = reader.result as string;
      // readAsDataURL → "data:...;base64,<payload>"; keep only the payload.
      resolve({ content: isBinary ? result.split(",", 2)[1] ?? "" : result, isBinary });
    };
    if (isBinary) reader.readAsDataURL(file);
    else reader.readAsText(file);
  });
}

/** Human label for a scope band. (Copied from studio-shell's `scopeLabel`.) */
function scopeLabel(scope: CollectionScope, chapters: Chapter[]): string {
  if (scope.kind === "course") return "Whole course";
  const i = chapters.findIndex((c) => c.slug === scope.slug);
  return i >= 0 ? `${i + 1}. ${chapters[i].title}` : scope.slug;
}

/** The switcher label for a term: display label when present, else the id, with
 *  a "· current" marker on the active one. */
function termLabel(term: TermInfo): string {
  const base = term.label?.trim() || term.id;
  return term.isCurrent ? `${base} · current` : base;
}

export function CurrentCollectionView({
  packageId,
  terms,
  activeTermId,
  isCurrent,
  tree,
  chapters,
  onDirty,
}: {
  packageId: string;
  terms: TermInfo[];
  activeTermId: string | null;
  isCurrent: boolean;
  tree: CollectionScopeTree[];
  chapters: Chapter[];
  onDirty?: (d: boolean) => void;
}): React.JSX.Element {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [newTermOpen, setNewTermOpen] = useState(false);
  // Upload target.
  const [scopeIdx, setScopeIdx] = useState(0); // 0 = course, else chapters[idx-1]
  const [folder, setFolder] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  // CF6: in-app create + edit (only reachable on the current, editable term).
  const [editing, setEditing] = useState<{
    path: string;
    name: string;
    editorKind: EditorKind;
    initialContent: string;
    isNew: boolean;
  } | null>(null);

  const hasCurrentTerm = terms.some((t) => t.isCurrent);

  const refresh = () => router.refresh();
  const goToTerm = (termId: string) =>
    router.push(`?collection=current&term=${encodeURIComponent(termId)}`);

  // ── Empty state: no term started yet ───────────────────────────────────────
  if (!activeTermId) {
    return (
      <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto">
        <div>
          <h2 className="font-serif text-lg text-ink">This term</h2>
          <p className="max-w-prose text-sm text-muted">
            The Current collection holds this run of the course — the
            announcements, assignments, and materials your students see right
            now. Start a term to begin; when the course runs again, you roll over
            to a fresh term and this one is archived.
          </p>
        </div>
        {newTermOpen ? (
          <NewTermForm
            packageId={packageId}
            hasCurrentTerm={hasCurrentTerm}
            onCancel={() => setNewTermOpen(false)}
            onStarted={(id) => {
              setNewTermOpen(false);
              goToTerm(id);
            }}
            onDirty={onDirty}
          />
        ) : (
          <div className="panel rounded-lg border border-edge p-4">
            <button className="btn btn-primary btn-sm" onClick={() => setNewTermOpen(true)}>
              Start a term
            </button>
          </div>
        )}
      </div>
    );
  }

  // From here `activeTermId` is a validated term id (page derived it from a real
  // term). Guard `currentSpaceDir` regardless — it throws on an invalid id.
  const space = currentSpaceDir(activeTermId);
  const editable = isCurrent; // an archived term is read-only.

  const targetScope: CollectionScope =
    scopeIdx === 0 ? { kind: "course" } : { kind: "chapter", slug: chapters[scopeIdx - 1].slug };

  // CF6 create/edit — the pane persists to the public `current/<term-id>` space.
  const openEditor = (path: string, name: string, editorKind: EditorKind) => {
    setError(null);
    start(async () => {
      const r = await loadCollectionFileAction(packageId, "public", path);
      if (!r.ok) {
        setError(r.error ?? "Couldn't open that file.");
        return;
      }
      setEditing({ path, name, editorKind, initialContent: r.content ?? "", isNew: false });
    });
  };

  const onCreate = (t: FileTypeDef) => {
    if (!t.editorKind) return;
    const base = window.prompt(`Name for the new ${t.label}?`, "");
    if (!base) return;
    const slug = base.trim().replace(/\s+/g, "-").replace(/[^A-Za-z0-9._-]/g, "");
    if (!slug) return;
    const filename = slug.endsWith(t.extension) ? slug : `${slug}${t.extension}`;
    setCreateOpen(false);
    setError(null);
    const kind = t.editorKind;
    if (isSeededOnCreate(kind)) {
      start(async () => {
        const r = await createCollectionFileAction(packageId, {
          space,
          scope: targetScope,
          folder: folder.trim() || undefined,
          filename,
        });
        if (!r.ok || !r.path) {
          setError(r.error ?? "Couldn't create the file.");
          return;
        }
        const c = await loadCollectionFileAction(packageId, "public", r.path);
        setEditing({ path: r.path, name: filename, editorKind: kind, initialContent: c.content ?? "", isNew: false });
      });
    } else {
      let path: string;
      try {
        path = collectionItemPath(space, targetScope, folder.trim() ? `${folder.trim()}/${filename}` : filename);
      } catch {
        setError("That name or folder isn't allowed.");
        return;
      }
      setEditing({ path, name: filename, editorKind: kind, initialContent: "", isNew: true });
    }
  };

  if (editing) {
    return (
      <CollectionEditorPane
        packageId={packageId}
        space={space}
        path={editing.path}
        name={editing.name}
        editorKind={editing.editorKind}
        initialContent={editing.initialContent}
        isNew={editing.isNew}
        onClose={() => setEditing(null)}
        onSaved={refresh}
        onDirty={onDirty}
      />
    );
  }

  const onUpload = (file: File) => {
    setError(null);
    setNote(null);
    start(async () => {
      const { content, isBinary } = await readFileContent(file);
      const r = await uploadCollectionFileAction(packageId, {
        space,
        repo: "public",
        scope: targetScope,
        folder: folder.trim() || undefined,
        filename: file.name,
        content,
        isBinary,
        sizeBytes: file.size,
      });
      if (!r.ok) setError(r.error ?? "Upload failed.");
      else {
        setNote(r.warning ?? `Added ${file.name}.`);
        refresh();
      }
      if (fileRef.current) fileRef.current.value = "";
    });
  };

  const onDelete = (path: string, isFolder: boolean) => {
    if (!window.confirm(`Delete ${isFolder ? "this folder and everything in it" : "this file"}?`))
      return;
    setError(null);
    start(async () => {
      const r = await deleteCollectionEntryAction(packageId, space, path, isFolder);
      if (!r.ok) setError(r.error ?? "Delete failed.");
      else refresh();
    });
  };

  const onRename = (leaf: FileLeaf) => {
    const next = window.prompt("Rename to (name only):", leaf.name);
    if (!next || next.trim() === leaf.name) return;
    const dir = leaf.path.slice(0, leaf.path.length - leaf.name.length); // includes trailing "/"
    setError(null);
    start(async () => {
      const r = await renameCollectionFileAction(packageId, space, leaf.path, `${dir}${next.trim()}`);
      if (!r.ok) setError(r.error ?? "Rename failed.");
      else refresh();
    });
  };

  const onMakeCurrent = () => {
    setError(null);
    start(async () => {
      const r = await activateTermAction(packageId, { termId: activeTermId });
      if (!r.ok) setError(r.error ?? "Couldn't switch to this term.");
      else refresh();
    });
  };

  const renderFolder = (node: FolderNode, depth: number): React.ReactNode => (
    <div key={node.path} style={{ marginLeft: depth * 12 }}>
      {depth > 0 && (
        <div className="flex items-center gap-2 py-1">
          <span className="text-sm text-muted">📁 {node.name}</span>
          {editable && (
            <button
              className="btn btn-ghost btn-xs text-faint"
              disabled={pending}
              onClick={() => onDelete(node.path, true)}
            >
              Delete
            </button>
          )}
        </div>
      )}
      {node.folders.map((f) => renderFolder(f, depth + 1))}
      <ul className="divide-y divide-[var(--edge-soft)]">
        {node.files.map((leaf) => (
          <FileRow
            key={leaf.path}
            packageId={packageId}
            leaf={leaf}
            depth={depth}
            pending={pending}
            editable={editable}
            onRename={() => onRename(leaf)}
            onDelete={() => onDelete(leaf.path, false)}
            onEdit={openEditor}
          />
        ))}
      </ul>
    </div>
  );

  // ── Split the course-scope tree into reserved sections + everything else ────
  const courseTree = tree.find((t) => t.scope.kind === "course");
  const chapterTrees = tree.filter((t) => t.scope.kind === "chapter");
  const sectionFolder = (id: CurrentSection): FolderNode | undefined =>
    courseTree?.root.folders.find((f) => f.name === id);
  // Course-scope files/folders not under a known section → "Other files".
  const otherRoot: FolderNode | undefined = courseTree && {
    name: "",
    path: courseTree.root.path,
    folders: courseTree.root.folders.filter((f) => !isCurrentSection(f.name)),
    files: courseTree.root.files,
  };
  const otherHasContent =
    !!otherRoot && (otherRoot.folders.length > 0 || otherRoot.files.length > 0);

  const activeTerm = terms.find((t) => t.id === activeTermId);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto">
      <div>
        <h2 className="font-serif text-lg text-ink">This term</h2>
        <p className="max-w-prose text-sm text-muted">
          What your students see this run of the course — announcements,
          assignments, and materials for the active term.
        </p>
      </div>

      {/* Term switcher + start-a-term + rename label */}
      <div className="panel flex flex-wrap items-end gap-2 rounded-lg border border-edge p-3">
        <label className="flex flex-col gap-1 text-xs text-muted">
          Term
          <select
            className="field"
            value={activeTermId}
            onChange={(e) => {
              if (e.target.value !== activeTermId) goToTerm(e.target.value);
            }}
          >
            {terms.map((t) => (
              <option key={t.id} value={t.id}>
                {termLabel(t)}
              </option>
            ))}
          </select>
        </label>
        <button className="btn btn-ghost btn-sm" onClick={() => setNewTermOpen((v) => !v)}>
          Start a term
        </button>
        {editable && activeTerm && (
          <RenameLabel packageId={packageId} current={activeTerm.label ?? activeTerm.id} onDone={refresh} />
        )}
      </div>

      {newTermOpen && (
        <NewTermForm
          packageId={packageId}
          hasCurrentTerm={hasCurrentTerm}
          onCancel={() => setNewTermOpen(false)}
          onStarted={(id) => {
            setNewTermOpen(false);
            goToTerm(id);
          }}
          onDirty={onDirty}
        />
      )}

      {/* Archived read-only banner */}
      {!editable && (
        <div className="panel flex flex-wrap items-center gap-3 rounded-lg border border-edge p-3">
          <p className="text-sm text-muted">
            You&rsquo;re viewing an archived term. Switch to the current term to
            make changes.
          </p>
          <button className="btn btn-primary btn-sm" disabled={pending} onClick={onMakeCurrent}>
            Make this the current term again
          </button>
        </div>
      )}

      {/* Upload + Create (current term only) */}
      {editable && (
        <div className="panel flex flex-wrap items-end gap-2 rounded-lg border border-edge p-3">
          <label className="flex flex-col gap-1 text-xs text-muted">
            Scope
            <select
              className="field"
              value={scopeIdx}
              onChange={(e) => setScopeIdx(Number(e.target.value))}
            >
              <option value={0}>Whole course</option>
              {chapters.map((c, i) => (
                <option key={c.slug} value={i + 1}>
                  {i + 1}. {c.title}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            Folder (optional)
            <input
              className="field"
              placeholder="e.g. assignments or misc/handouts"
              value={folder}
              onChange={(e) => setFolder(e.target.value)}
            />
          </label>

          {/* Create — the framework's creatable formats. In-app creation isn't
              wired for collections yet; each item is a disabled placeholder. */}
          <div className="relative">
            <button
              className="btn btn-ghost btn-sm"
              aria-haspopup="menu"
              aria-expanded={createOpen}
              onClick={() => setCreateOpen((v) => !v)}
            >
              Create ▾
            </button>
            {createOpen && (
              <>
                <button
                  type="button"
                  aria-label="Close create menu"
                  className="fixed inset-0 z-20 cursor-default"
                  onClick={() => setCreateOpen(false)}
                />
                <div
                  role="menu"
                  className="absolute left-0 z-30 mt-1 w-64 overflow-hidden rounded-xl border border-edge bg-[var(--surface)] p-1 shadow-xl"
                >
                  {CREATABLE_FILE_TYPES.map((t) => (
                    <button
                      key={t.extension}
                      role="menuitem"
                      className="flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm text-ink hover:bg-elevated"
                      onClick={() => onCreate(t)}
                    >
                      <span>{t.label}</span>
                      <span className="text-[10px] text-faint">{t.extension}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* A styled trigger over a hidden native input. */}
          <label
            className={`btn btn-primary btn-sm ${pending ? "pointer-events-none opacity-60" : "cursor-pointer"}`}
          >
            {pending ? "Uploading…" : "Upload a file"}
            <input
              ref={fileRef}
              type="file"
              className="sr-only"
              disabled={pending}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onUpload(f);
              }}
            />
          </label>
        </div>
      )}

      {error && <p className="text-sm text-danger">{error}</p>}
      {note && <p className="text-xs text-ok">{note}</p>}

      {/* Reserved sections (announcements / assignments / other) */}
      <div className="flex flex-col gap-4">
        {CURRENT_SECTIONS.map((id) => {
          const meta = SECTION_META[id];
          const node = sectionFolder(id);
          const hasFiles = !!node && (node.folders.length > 0 || node.files.length > 0);
          return (
            <div key={id}>
              <p className="mb-1 text-xs uppercase tracking-wide text-faint">{meta.label}</p>
              <p className="mb-1 text-xs text-muted">{meta.hint}</p>
              <div className="panel rounded-lg border border-edge p-2">
                {id === "announcements" && editable && activeTermId && (
                  <AnnouncementComposer
                    packageId={packageId}
                    termId={activeTermId}
                    onPosted={refresh}
                    onDirty={onDirty}
                  />
                )}
                {hasFiles ? (
                  renderFolder(node, 0)
                ) : (
                  <p className="px-1 py-1 text-sm text-faint">Nothing here yet.</p>
                )}
              </div>
            </div>
          );
        })}

        {/* Course-scope files outside a section */}
        {otherHasContent && otherRoot && (
          <div>
            <p className="mb-1 text-xs uppercase tracking-wide text-faint">Other files</p>
            <div className="panel rounded-lg border border-edge p-2">{renderFolder(otherRoot, 0)}</div>
          </div>
        )}

        {/* Chapter-scoped materials, one panel per chapter */}
        {chapterTrees.map((st) => (
          <div key={JSON.stringify(st.scope)}>
            <p className="mb-1 text-xs uppercase tracking-wide text-faint">
              {scopeLabel(st.scope, chapters)}
            </p>
            <div className="panel rounded-lg border border-edge p-2">{renderFolder(st.root, 0)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── One file row: open · rename · delete ───────────────────────────────────
 * Current files are opened (a tab) and, on the active term, renamed/deleted.
 * No Insert / Metadata / share — Current is not a Discover surface. */
function FileRow({
  packageId,
  leaf,
  depth,
  pending,
  editable,
  onRename,
  onDelete,
  onEdit,
}: {
  packageId: string;
  leaf: FileLeaf;
  depth: number;
  pending: boolean;
  editable: boolean;
  onRename: () => void;
  onDelete: () => void;
  onEdit: (path: string, name: string, kind: EditorKind) => void;
}) {
  const editorKind = editorKindForPath(leaf.path);
  return (
    <li className="py-1.5" style={{ marginLeft: depth > 0 ? 12 : 0 }}>
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-sm text-ink">{leaf.name}</span>
        {/* Open — a real anchor in a new tab (the workspace's capture-phase
            unsaved guard only lets real anchors through). */}
        <a
          href={`/api/asset/${packageId}/${leaf.path}`}
          target="_blank"
          rel="noreferrer"
          className="btn btn-ghost btn-xs"
          title="Open this file in a new tab"
        >
          Open
        </a>
        {editable && (
          <>
            {editorKind && (
              <button
                className="btn btn-ghost btn-xs"
                disabled={pending}
                onClick={() => onEdit(leaf.path, leaf.name, editorKind)}
                title="Edit this file in the workspace"
              >
                Edit
              </button>
            )}
            <button className="btn btn-ghost btn-xs" disabled={pending} onClick={onRename}>
              Rename
            </button>
            <button className="btn btn-ghost btn-xs text-danger" disabled={pending} onClick={onDelete}>
              Delete
            </button>
          </>
        )}
      </div>
    </li>
  );
}

/* ── New-term form ───────────────────────────────────────────────────────────
 * Term id (immutable, url-safe folder name) + display label + carry-over. On
 * ok, the caller navigates to the new term. Marks the shell dirty while editing.
 */
function NewTermForm({
  packageId,
  hasCurrentTerm,
  onCancel,
  onStarted,
  onDirty,
}: {
  packageId: string;
  hasCurrentTerm: boolean;
  onCancel: () => void;
  onStarted: (termId: string) => void;
  onDirty?: (d: boolean) => void;
}) {
  const [termId, setTermId] = useState("");
  const [label, setLabel] = useState("");
  const [carryOver, setCarryOver] = useState(hasCurrentTerm);
  const [dirty, setDirty] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const markDirty = () => {
    if (!dirty) {
      setDirty(true);
      onDirty?.(true);
    }
  };
  // Clear the shell's unsaved flag if this form unmounts while dirty.
  useEffect(() => () => onDirty?.(false), [onDirty]);

  const submit = () => {
    setError(null);
    start(async () => {
      const r = await startTermAction(packageId, {
        termId: termId.trim().toLowerCase(),
        label: label.trim(),
        carryOver,
      });
      if (!r.ok) {
        setError(r.error ?? "Couldn't start that term.");
        return;
      }
      setDirty(false);
      onDirty?.(false);
      onStarted(termId.trim().toLowerCase());
    });
  };

  return (
    <div className="panel flex flex-col gap-2 rounded-lg border border-edge p-3">
      <p className="text-sm text-ink">Start a term</p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label className="text-xs">
          <span className="mb-1 block text-muted">Term id</span>
          <input
            value={termId}
            onChange={(e) => {
              setTermId(e.target.value);
              markDirty();
            }}
            placeholder="2026-fall"
            className="field w-full"
          />
          <span className="mt-1 block text-faint">
            Lowercase, numbers, hyphens — e.g. 2026-fall. This can&rsquo;t change later.
          </span>
        </label>
        <label className="text-xs">
          <span className="mb-1 block text-muted">Display label</span>
          <input
            value={label}
            onChange={(e) => {
              setLabel(e.target.value);
              markDirty();
            }}
            placeholder="Fall 2026"
            className="field w-full"
          />
          <span className="mt-1 block text-faint">A friendly name you can rename anytime.</span>
        </label>
      </div>
      {hasCurrentTerm && (
        <label className="flex items-center gap-2 text-xs text-muted">
          <input
            type="checkbox"
            checked={carryOver}
            onChange={(e) => {
              setCarryOver(e.target.checked);
              markDirty();
            }}
          />
          Carry over assignments &amp; materials from the current term
        </label>
      )}
      <div className="flex items-center gap-2">
        <button
          onClick={submit}
          disabled={pending || !termId.trim()}
          className="btn btn-primary btn-sm"
        >
          {pending ? "Starting…" : "Start term"}
        </button>
        <button
          onClick={() => {
            setDirty(false);
            onDirty?.(false);
            onCancel();
          }}
          className="btn btn-ghost btn-sm"
        >
          Cancel
        </button>
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}

/* ── Rename the active term's display label (never moves a file) ─────────────*/
function RenameLabel({
  packageId,
  current,
  onDone,
}: {
  packageId: string;
  current: string;
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState(current);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    setError(null);
    start(async () => {
      const r = await setTermLabelAction(packageId, label.trim());
      if (!r.ok) {
        setError(r.error ?? "Couldn't rename the term.");
        return;
      }
      setOpen(false);
      onDone();
    });
  };

  if (!open) {
    return (
      <button className="btn btn-ghost btn-sm" onClick={() => setOpen(true)}>
        Rename label
      </button>
    );
  }

  return (
    <span className="flex items-center gap-1">
      <input
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        aria-label="Term display label"
        placeholder="Fall 2026"
        className="field w-40 text-xs"
        autoFocus
        onKeyDown={(e) => e.key === "Enter" && !pending && label.trim() && submit()}
      />
      <button onClick={submit} disabled={pending || !label.trim()} className="btn btn-primary btn-sm">
        {pending ? "…" : "Save"}
      </button>
      <button onClick={() => setOpen(false)} className="btn btn-ghost btn-sm">
        Cancel
      </button>
      {error && <span className="text-xs text-danger">{error}</span>}
    </span>
  );
}

/* ── Announcement composer (current term only) ──────────────────────────────
 * Title + body → a dated markdown note in the term's announcements section.
 * Marks the shell dirty while composing. */
function AnnouncementComposer({
  packageId,
  termId,
  onPosted,
  onDirty,
}: {
  packageId: string;
  termId: string;
  onPosted: () => void;
  onDirty?: (d: boolean) => void;
}) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [dirty, setDirty] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const markDirty = () => {
    if (!dirty) {
      setDirty(true);
      onDirty?.(true);
    }
  };
  useEffect(() => () => onDirty?.(false), [onDirty]);

  const submit = () => {
    setError(null);
    start(async () => {
      const r = await postAnnouncementAction(packageId, { termId, title: title.trim(), body: body.trim() });
      if (!r.ok) {
        setError(r.error ?? "Couldn't post that announcement.");
        return;
      }
      setTitle("");
      setBody("");
      setDirty(false);
      onDirty?.(false);
      onPosted();
    });
  };

  return (
    <div className="mb-2 flex flex-col gap-2 rounded-lg border border-edge-soft bg-[var(--surface)] p-3">
      <label className="text-xs">
        <span className="mb-1 block text-muted">Announcement title</span>
        <input
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            markDirty();
          }}
          placeholder="Welcome to the course"
          className="field w-full"
        />
      </label>
      <label className="text-xs">
        <span className="mb-1 block text-muted">Message</span>
        <textarea
          value={body}
          onChange={(e) => {
            setBody(e.target.value);
            markDirty();
          }}
          rows={3}
          placeholder="What your students should know today."
          className="field w-full resize-y"
        />
      </label>
      <div className="flex items-center gap-2">
        <button onClick={submit} disabled={pending || !title.trim()} className="btn btn-primary btn-sm">
          {pending ? "Posting…" : "Post announcement"}
        </button>
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}
