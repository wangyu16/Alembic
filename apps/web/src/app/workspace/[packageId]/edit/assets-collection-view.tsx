"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import {
  CREATABLE_FILE_TYPES,
  classForPath,
  editorKindForPath,
  isInsertable,
  isSeededOnCreate,
  type CollectionScope,
  type EditorKind,
  type FileTypeDef,
  type HandlingClass,
} from "@alembic/package-contract";
import {
  collectionItemPath,
  type CollectionScopeTree,
  type FileLeaf,
  type FolderNode,
} from "@alembic/package-ops";
import { isBinaryPath } from "@/lib/collection-upload";
import {
  uploadCollectionFileAction,
  createCollectionFileAction,
  loadCollectionFileAction,
  deleteCollectionEntryAction,
  renameCollectionFileAction,
} from "../collection-actions";
import { setAssetMetadataAction } from "../share-actions";
import { adaptElementAction } from "../adapt-actions";
import { CollectionEditorPane } from "./collection-editor-pane";

/**
 * Assets collection (CF4; docs/specs/collections-framework.md §3, §4, §6).
 *
 * The same folder-tree/upload/folder machine as the Private collection
 * (`PrivateCollectionView` in studio-shell.tsx), configured for the public
 * `materials/` space, PLUS the asset-specific per-file actions the handling
 * class earns (§3): OPEN (a tab), INSERT (Object permalink as `src`, for
 * insertable classes only) and a metadata/SHARE panel that gates
 * discoverability (§4). Documents are viewed/cited, never inserted
 * (SteeringNote §3).
 *
 * The un-exported helpers in studio-shell (`readFileContent`, `scopeLabel`, the
 * class badge, the folder recursion, the Create menu) are redefined locally —
 * this file can't reach them — copying their logic verbatim.
 */

const MATERIALS_SPACE = "materials";

/** Per-file share metadata, projected from the registry (keyed by repo path). */
export interface AssetMeta {
  docId: string;
  discoverable: boolean;
  description?: string;
  tags: string[];
  license?: string;
  permalinkClass: "document" | "object";
}

interface Chapter {
  slug: string;
  title: string;
}

/** Read a browser File as UTF-8 text, or base64 for a binary. (Copied from
 *  studio-shell's `readFileContent`.) */
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

/** A file's handling-class badge (a small muted tag). */
function ClassBadge({ cls }: { cls: HandlingClass }) {
  const label =
    cls === "document"
      ? "document"
      : cls === "opaque-download"
        ? "file"
        : cls.replace("insertable-", "");
  return <span className="rounded bg-elevated px-1.5 py-0.5 text-[10px] text-faint">{label}</span>;
}

/** Copy `text` to the clipboard; flips `mark` true for ~1.5s. */
function useCopy(): [boolean, (text: string) => void, string | null] {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const copy = (text: string) => {
    setError(null);
    void (async () => {
      try {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      } catch {
        setError("Couldn't copy — copy it manually: " + text);
      }
    })();
  };
  return [copied, copy, error];
}

export function AssetsCollectionView({
  packageId,
  tree,
  chapters,
  assetMeta,
  onDirty,
}: {
  packageId: string;
  tree: CollectionScopeTree[];
  chapters: Chapter[];
  assetMeta: Record<string, AssetMeta>;
  onDirty?: (d: boolean) => void;
}): React.JSX.Element {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  // Upload target.
  const [scopeIdx, setScopeIdx] = useState(0); // 0 = course, else chapters[idx-1]
  const [folder, setFolder] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const targetScope: CollectionScope =
    scopeIdx === 0 ? { kind: "course" } : { kind: "chapter", slug: chapters[scopeIdx - 1].slug };

  const refresh = () => router.refresh();

  // CF6: in-app create + edit. When `editing` is set the view shows the shared
  // editor pane instead of the tree; the pane mounts once (never re-keyed).
  const [editing, setEditing] = useState<{
    path: string;
    name: string;
    editorKind: EditorKind;
    initialContent: string;
    isNew: boolean;
  } | null>(null);

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
          space: MATERIALS_SPACE,
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
      // ketcher/plot: no server seed — open an empty editor; first save writes it.
      let path: string;
      try {
        path = collectionItemPath(
          MATERIALS_SPACE,
          targetScope,
          folder.trim() ? `${folder.trim()}/${filename}` : filename,
        );
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
        space={MATERIALS_SPACE}
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
        space: MATERIALS_SPACE,
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
      const r = await deleteCollectionEntryAction(packageId, MATERIALS_SPACE, path, isFolder);
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
      const r = await renameCollectionFileAction(
        packageId,
        MATERIALS_SPACE,
        leaf.path,
        `${dir}${next.trim()}`,
      );
      if (!r.ok) setError(r.error ?? "Rename failed.");
      else refresh();
    });
  };

  const renderFolder = (node: FolderNode, depth: number): React.ReactNode => (
    <div key={node.path} style={{ marginLeft: depth * 12 }}>
      {depth > 0 && (
        <div className="flex items-center gap-2 py-1">
          <span className="text-sm text-muted">📁 {node.name}</span>
          <button
            className="btn btn-ghost btn-xs text-faint"
            disabled={pending}
            onClick={() => onDelete(node.path, true)}
          >
            Delete
          </button>
        </div>
      )}
      {node.folders.map((f) => renderFolder(f, depth + 1))}
      <ul className="divide-y divide-[var(--edge-soft)]">
        {node.files.map((leaf) => (
          <FileRow
            key={leaf.path}
            packageId={packageId}
            leaf={leaf}
            meta={assetMeta[leaf.path]}
            depth={depth}
            pending={pending}
            onRename={() => onRename(leaf)}
            onDelete={() => onDelete(leaf.path, false)}
            onEdit={openEditor}
            onRefresh={refresh}
            onDirty={onDirty}
          />
        ))}
      </ul>
    </div>
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto">
      <div>
        <h2 className="font-serif text-lg text-ink">Assets</h2>
        <p className="max-w-prose text-sm text-muted">
          Images, structures, plots, and files you can insert into documents or share for others to
          reuse. Add a description, tags, and a license to make one discoverable.
        </p>
      </div>

      {/* Upload + Create + Adapt */}
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
            placeholder="e.g. figures or ch03/plots"
            value={folder}
            onChange={(e) => setFolder(e.target.value)}
          />
        </label>

        {/* Create — a menu of the framework's creatable formats (CF6). Each opens
            the shared editor: seeded documents/markdown open on a starter; the
            structure/plot editors open empty and write on first save. */}
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

        {/* A styled trigger over a hidden native input, so it reads as an action
            rather than the raw "Choose File / No file chosen" text. */}
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

        <AdaptControl packageId={packageId} onRefresh={refresh} />
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}
      {note && <p className="text-xs text-ok">{note}</p>}

      {/* Tree */}
      {tree.length === 0 ? (
        <p className="text-sm text-faint">No assets yet — upload one above.</p>
      ) : (
        <div className="flex flex-col gap-4">
          {tree.map((st) => (
            <div key={JSON.stringify(st.scope)}>
              <p className="mb-1 text-xs uppercase tracking-wide text-faint">
                {scopeLabel(st.scope, chapters)}
              </p>
              <div className="panel rounded-lg border border-edge p-2">{renderFolder(st.root, 0)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── One file row: open · insert · metadata/share · rename · delete ──────────
 * The class-driven actions (§3): OPEN for every file (a tab), INSERT for the
 * insertable classes with a permalink, and a metadata panel that gates
 * discoverability (§4). Documents are never inserted (isInsertable excludes
 * them — SteeringNote §3). */
function FileRow({
  packageId,
  leaf,
  meta,
  depth,
  pending,
  onRename,
  onDelete,
  onEdit,
  onRefresh,
  onDirty,
}: {
  packageId: string;
  leaf: FileLeaf;
  meta: AssetMeta | undefined;
  depth: number;
  pending: boolean;
  onRename: () => void;
  onDelete: () => void;
  onEdit: (path: string, name: string, kind: EditorKind) => void;
  onRefresh: () => void;
  onDirty?: (d: boolean) => void;
}) {
  // `leaf.class` is authoritative; fall back to `classForPath` if a tree ever
  // omits it (it doesn't today) or the registry-projected meta disagrees.
  const cls: HandlingClass = leaf.class ?? classForPath(leaf.path);
  const insertable = isInsertable(cls);
  // CF6: files with an in-app editor get an Edit affordance.
  const editorKind = editorKindForPath(leaf.path);
  const [panelOpen, setPanelOpen] = useState(false);
  const [copiedInsert, copyInsert, insertCopyError] = useCopy();

  // The insert-ready reference: markdown image for images, bare permalink
  // otherwise (never for a `document` — isInsertable already excludes it).
  const insertRef =
    meta && insertable
      ? cls === "insertable-image"
        ? `![${meta.description ?? leaf.name}](/d/${meta.docId})`
        : `/d/${meta.docId}`
      : null;

  return (
    <li className="py-1.5" style={{ marginLeft: depth > 0 ? 12 : 0 }}>
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-sm text-ink">{leaf.name}</span>
        <ClassBadge cls={cls} />
        {/* Open — the owner preview route, a real anchor in a new tab (the
            workspace's capture-phase unsaved guard only lets real anchors
            through). Documents open the same way for now. */}
        <a
          href={`/api/asset/${packageId}/${leaf.path}`}
          target="_blank"
          rel="noreferrer"
          className="btn btn-ghost btn-xs"
          title="Open this file in a new tab"
        >
          Open
        </a>
        {insertable && (
          <button
            className="btn btn-ghost btn-xs"
            disabled={!insertRef}
            title={
              insertRef
                ? "Copy an insert-ready reference to the clipboard"
                : "Share it first to get a permalink."
            }
            onClick={() => insertRef && copyInsert(insertRef)}
          >
            {copiedInsert ? "Copied" : "Insert"}
          </button>
        )}
        <button
          className="btn btn-ghost btn-xs"
          aria-expanded={panelOpen}
          onClick={() => setPanelOpen((v) => !v)}
          title="Description, tags, license, and sharing"
        >
          Metadata
        </button>
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
        <button
          className="btn btn-ghost btn-xs text-danger"
          disabled={pending}
          onClick={onDelete}
        >
          Delete
        </button>
      </div>
      {insertCopyError && <p className="mt-1 text-[11px] text-danger">{insertCopyError}</p>}
      {panelOpen && (
        <MetadataPanel
          packageId={packageId}
          leaf={leaf}
          cls={cls}
          meta={meta}
          onRefresh={onRefresh}
          onDirty={onDirty}
        />
      )}
    </li>
  );
}

/* ── Metadata / share panel (§4) ─────────────────────────────────────────────
 * description · tags · license · discoverable. Save → setAssetMetadataAction.
 * An OBJECT must have a description before it can be made discoverable — the
 * action enforces it and returns the error, which we surface. When discoverable,
 * the `/d/{docId}` permalink is shown with a copy button. */
function MetadataPanel({
  packageId,
  leaf,
  cls,
  meta,
  onRefresh,
  onDirty,
}: {
  packageId: string;
  leaf: FileLeaf;
  cls: HandlingClass;
  meta: AssetMeta | undefined;
  onRefresh: () => void;
  onDirty?: (d: boolean) => void;
}) {
  const [description, setDescription] = useState(meta?.description ?? "");
  const [tagsText, setTagsText] = useState((meta?.tags ?? []).join(", "));
  const [license, setLicense] = useState(meta?.license ?? "");
  const [discoverable, setDiscoverable] = useState(meta?.discoverable ?? false);
  const [dirty, setDirty] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [permalink, setPermalink] = useState<string | null>(
    meta?.discoverable ? `/d/${meta.docId}` : null,
  );
  const [copiedLink, copyLink, linkCopyError] = useCopy();

  const markDirty = () => {
    if (!dirty) {
      setDirty(true);
      onDirty?.(true);
    }
  };
  // Clear the shell's unsaved flag if this panel unmounts while dirty.
  useEffect(() => () => onDirty?.(false), [onDirty]);

  // Documents are viewed/cited, not inserted — surface a hint, but still allow
  // description/tags/license (the discoverable gate differs and is enforced
  // server-side).
  const isDocument = cls === "document";

  const save = () => {
    if (!meta) {
      setError("This file isn't registered yet — reopen the package once, then retry.");
      return;
    }
    setError(null);
    start(async () => {
      const tags = tagsText
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      const r = await setAssetMetadataAction(packageId, meta.docId, {
        description: description.trim() || undefined,
        tags,
        license: license.trim(),
        discoverable,
      });
      if (!r.ok) {
        setError(r.error ?? "That didn't save.");
        return;
      }
      setDirty(false);
      onDirty?.(false);
      setPermalink(r.permalink ?? (discoverable ? `/d/${meta.docId}` : null));
      onRefresh();
    });
  };

  return (
    <div className="mt-2 flex flex-col gap-2 rounded-lg border border-edge-soft bg-[var(--surface)] p-3">
      {!meta && (
        <p className="text-[11px] text-faint">
          Not registered yet — reopen the package once so this file gets a permalink, then its
          metadata can be saved.
        </p>
      )}
      {isDocument && (
        <p className="text-[11px] text-faint">
          A document is opened and cited, not inserted. Its description, tags, and license still help
          others find it.
        </p>
      )}
      <label className="text-xs">
        <span className="mb-1 block text-muted">Description</span>
        <textarea
          value={description}
          onChange={(e) => {
            setDescription(e.target.value);
            markDirty();
          }}
          rows={2}
          placeholder="What it shows — also used as the image alt text and how others find it."
          className="field w-full resize-y"
        />
      </label>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label className="text-xs">
          <span className="mb-1 block text-muted">Tags</span>
          <input
            value={tagsText}
            onChange={(e) => {
              setTagsText(e.target.value);
              markDirty();
            }}
            placeholder="benzene, aromatic, ring"
            className="field w-full"
          />
          <span className="mt-1 block text-faint">Comma-separated.</span>
        </label>
        <label className="text-xs">
          <span className="mb-1 block text-muted">License</span>
          <input
            value={license}
            onChange={(e) => {
              setLicense(e.target.value);
              markDirty();
            }}
            placeholder="CC BY 4.0"
            className="field w-full"
          />
        </label>
      </div>
      <label className="flex items-center gap-2 text-xs text-muted">
        <input
          type="checkbox"
          checked={discoverable}
          onChange={(e) => {
            setDiscoverable(e.target.checked);
            markDirty();
          }}
        />
        Discoverable — others can find and reuse this on Discover
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={save}
          disabled={pending || !dirty || !meta}
          className="btn btn-primary btn-sm"
        >
          {pending ? "Saving…" : "Save"}
        </button>
        {permalink && (
          <span className="flex items-center gap-2 text-xs">
            <code className="text-muted">{permalink}</code>
            <button
              onClick={() => copyLink(`${window.location.origin}${permalink}`)}
              className="link"
              title="Copy the shareable permalink"
            >
              {copiedLink ? "Copied" : "Copy permalink"}
            </button>
          </span>
        )}
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
      {linkCopyError && <p className="text-xs text-danger">{linkCopyError}</p>}
    </div>
  );
}

/* ── "Adapt": copy a shared object into this package by permalink (§6) ────────
 * Straightforward — `adaptElementAction(packageId, permalink)` needs only a
 * pasted link, so it's included. Mirrors studio-shell's AdaptControl. */
function AdaptControl({
  packageId,
  onRefresh,
}: {
  packageId: string;
  onRefresh: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [link, setLink] = useState("");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const submit = () => {
    setMsg(null);
    start(async () => {
      const r = await adaptElementAction(packageId, link);
      if (!r.ok) {
        setMsg({ ok: false, text: r.error ?? "Couldn't add that element." });
        return;
      }
      setLink("");
      setOpen(false);
      setMsg({ ok: true, text: r.already ? "Already in this package." : "Added to Assets." });
      onRefresh();
    });
  };

  if (!open) {
    return (
      <span className="flex items-center gap-2">
        <button
          onClick={() => setOpen(true)}
          className="btn btn-ghost btn-sm"
          title="Paste a shared element's permalink (from Discover) to copy it into this package"
        >
          Adapt…
        </button>
        {msg?.ok && <span className="text-xs text-muted">{msg.text}</span>}
      </span>
    );
  }

  return (
    <span className="flex items-center gap-1">
      <input
        value={link}
        onChange={(e) => setLink(e.target.value)}
        placeholder="Paste a shared link (/d/…)"
        aria-label="Shared element permalink"
        className="field w-56 text-xs"
        autoFocus
        onKeyDown={(e) => e.key === "Enter" && !pending && link.trim() && submit()}
      />
      <button onClick={submit} disabled={pending || !link.trim()} className="btn btn-primary btn-sm">
        {pending ? "…" : "Add"}
      </button>
      <button
        onClick={() => {
          setOpen(false);
          setMsg(null);
        }}
        className="btn btn-ghost btn-sm"
      >
        Cancel
      </button>
      {msg && !msg.ok && <span className="text-xs text-danger">{msg.text}</span>}
    </span>
  );
}
