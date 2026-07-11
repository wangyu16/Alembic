/**
 * The editor-module interface (editor-overhaul Phase 2, guardrail G7).
 *
 * ONE contract, keyed to carrier kind, that every heavy editor implements —
 * `ketcher`, `plot`, `md`, `slides`, `pdf`, and future kinds. A module is **pure
 * UI over a carrier source**: the host injects everything contract-related
 * (persistence, AI, asset resolution), so the same module embeds in Alembic
 * (which enforces packageOps + risk tiers + the two-repo invariant), orz-editor,
 * or a VS Code extension (a filesystem host with no tiers) without change.
 *
 * Framework-agnostic: `mount` takes a DOM element, so a React/Vue/vanilla module
 * all fit. This unifies the two earlier sketches (carriers §3 `CarrierEditor`
 * pull-style, and the overhaul §5 push-style `EditorModule`) into one: it has
 * both `onChange` (push) and `getSource`/`renderPayload` (pull), plus the host
 * hooks `requestAI` / `resolveAsset` and the optional `deriveAltText` capability.
 */

import type { HostAIOperation, HostAIRequest } from "./host-ai-client";

export {
  HOST_SAVE_PROTOCOL,
  HOST_SAVE_VERSION,
  createHostSaveClient,
  type HostSaveClient,
  type HostSaveClientOptions,
  type HostSavePayload,
} from "./host-save-client";

export {
  HOST_AI_PROTOCOL,
  HOST_AI_VERSION,
  createHostAIClient,
  type HostAIClient,
  type HostAIClientOptions,
  type HostAIOperation,
  type HostAIRequest,
} from "./host-ai-client";

export {
  HOST_INCLUDE_PROTOCOL,
  HOST_INCLUDE_VERSION,
  createHostIncludeClient,
  type HostIncludeClient,
  type HostIncludeClientOptions,
} from "./host-include-client";

/** A proposed AI edit the host diffs and the educator approves (a Tier-2 change). */
export interface AIProposal {
  /** The proposed new carrier source (full replacement). */
  source: string;
  /** Plain-language rationale, shown with the diff. */
  rationale?: string;
}

export type EditorTheme = "light" | "dark";

/** Everything the host provides to a mounted module. */
export interface EditorContext {
  /** The carrier's embedded source (KetJSON, Plotly spec, markdown, slide model). */
  source: string;
  /** Read-only surface (e.g. a published-package viewer). */
  readOnly?: boolean;
  theme?: EditorTheme;
  /** Resolve a portable asset reference (`materials/…`) to a URL/permalink. The
   *  Alembic host refuses non-`materials` paths (two-repo safety, G1). */
  resolveAsset?(ref: string): string;
  /** Persist an edit. The Alembic host routes this through the validated write
   *  path (packageOps + risk tiers); other hosts may write a file directly. */
  onChange(next: { source: string; rendered: string }): void;
  /** Persist a save the FILE itself requested (a hosted self-contained
   *  document's own Save button — the orz-host-save protocol). Resolves with
   *  the outcome so the module can acknowledge back into the file
   *  (`orz-host-saved`); on `ok: false` the file keeps the document dirty.
   *  When absent, hosted-carrier modules fall back to `onChange` and
   *  acknowledge ok. */
  hostSave?(payload: { source: string; rendered: string; theme?: string }): Promise<{ ok: boolean; error?: string }>;
  /** The file's unsaved-changes signal (`orz-host-dirty`), so the host can
   *  arm its own unsaved guard without owning the editing surface. */
  onDirty?(dirty: boolean): void;
  /** Run AI on the active file and return a proposal for the host to diff +
   *  approve. The Alembic host runs it through the governed provider + tiers. */
  requestAI?(prompt: string, selection?: unknown): Promise<AIProposal>;
  /** AI operations the host offers this module's file, advertised to the file's
   *  in-file assistant over the `orz-host-ai@1` bridge. Absent = no AI offered. */
  aiOperations?: HostAIOperation[];
  /** Run an advertised AI operation on the file's text/selection and return a
   *  proposal the file diffs + applies. Alembic routes this through the
   *  operations registry + `PLATFORM_SCOPE` + governance. Pairs with
   *  `aiOperations`; used by hosted (iframe) modules via the bridge. */
  runAIOperation?(req: HostAIRequest): Promise<{ ok: boolean; proposed?: string; error?: string }>;
  /** Resolve a web transclusion URL (`{{md-include https://…}}`) to its markdown
   *  for the file's PREVIEW, over the `orz-host-include@1` bridge. The Alembic
   *  host fetches under its own permalink allowlist. Absent = no include bridge
   *  (the file leaves directives unresolved, never auto-fetching). Returns null
   *  when the host declines/can't resolve. */
  resolveInclude?(url: string): Promise<string | null>;
}

/** The live handle to a mounted module. */
export interface EditorHandle {
  /** Current carrier source (pull — for hosts that read on demand). May be async
   *  (e.g. a same-origin editor whose API resolves the source asynchronously). */
  getSource(): string | Promise<string>;
  /** Re-render the payload (HTML/SVG/PDF) from the current source — export/preview. */
  renderPayload?(): string | Promise<string>;
  /** Derive accessibility alt text from the source (assets that need it). */
  deriveAltText?(): string | Promise<string>;
  /** Tear down listeners / DOM. */
  destroy(): void;
}

/** An editor for one carrier kind. */
export interface EditorModule {
  /** Carrier kind id (matches the carriers registry): "ketcher" | "plot" | "md" | … */
  kind: string;
  /** Human label for the host's Insert/Edit menus. */
  label: string;
  /** True when the module is its own WYSIWYG surface (e.g. Ketcher) rather than
   *  the standard source-left / preview-right layout. */
  wysiwyg?: boolean;
  /** Mount into a host element; returns a handle. */
  mount(el: HTMLElement, ctx: EditorContext): EditorHandle;
}

/**
 * Host-side registry: carrier kind → module. The host populates it from whatever
 * module packages it imports; consumers look modules up by the file's carrier
 * kind. (Kept out of `@alembic/carriers`, which stays UI-free.)
 */
export class EditorRegistry {
  private readonly modules = new Map<string, EditorModule>();

  register(module: EditorModule): this {
    this.modules.set(module.kind, module);
    return this;
  }

  get(kind: string): EditorModule | undefined {
    return this.modules.get(kind);
  }

  has(kind: string): boolean {
    return this.modules.has(kind);
  }

  list(): EditorModule[] {
    return [...this.modules.values()];
  }
}
