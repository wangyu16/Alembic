/**
 * Host-side client for the `orz-host-save@1` protocol (canonical spec:
 * orz-mdhtml/PROTOCOL.md). A self-contained orz file embedded in an iframe
 * switches its Save action to postMessage after a handshake; this client is
 * the host half: it announces the host (hello, with retry — files that load
 * their runtime from a slow CDN boot late), verifies the file's `ready`,
 * relays the file's saves to the host's persistence hook, and acknowledges
 * the outcome back into the file.
 *
 * Pure protocol logic — no DOM. The caller owns the iframe: it binds `post`
 * to `contentWindow.postMessage` and forwards only `message` events whose
 * `event.source` is that iframe's window (the file applies the mirror rule:
 * it only trusts `window.parent`). Everything here is testable with fake
 * timers.
 */

export const HOST_SAVE_PROTOCOL = "orz-host-save";
export const HOST_SAVE_VERSION = 1;

export interface HostSavePayload {
  /** The file's embedded editable source (markdown / slide model). */
  source: string;
  /** The full serialized self-reproducing document — the bytes a file save
   *  would write. This is what the host persists as the file's content. */
  rendered: string;
}

export interface HostSaveClientOptions {
  /** Send a protocol message to the file (bind to `contentWindow.postMessage`). */
  post(message: Record<string, unknown>): void;
  /** Persist a save the file requested; the outcome becomes the ack. */
  save(payload: HostSavePayload): Promise<{ ok: boolean; error?: string }>;
  /** Handshake completed (file replied `orz-host-ready`). */
  onReady?(info: { kind: string; version: number }): void;
  /** The file's unsaved-changes signal. */
  onDirty?(dirty: boolean): void;
  /** No `orz-host-ready` before `helloMaxMs` — the file predates the
   *  protocol (or never booted); the host should fall back to read-only. */
  onHelloTimeout?(): void;
  /** Hello retry cadence (default 400ms) and give-up horizon (default 20s). */
  helloIntervalMs?: number;
  helloMaxMs?: number;
}

export interface HostSaveClient {
  /** Begin the hello retry loop (call once the iframe has loaded). */
  start(): void;
  /** Feed a `message` event's data (caller has already checked the source). */
  handleMessage(data: unknown): void;
  /** Tear down timers. */
  stop(): void;
  readonly ready: boolean;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/** A protocol message from the file: correct envelope, expected type. */
function fromFile(data: unknown, type: string): Record<string, unknown> | null {
  if (!isRecord(data)) return null;
  if (data["type"] !== type) return null;
  if (data["protocol"] !== HOST_SAVE_PROTOCOL) return null;
  return data;
}

export function createHostSaveClient(opts: HostSaveClientOptions): HostSaveClient {
  const helloIntervalMs = opts.helloIntervalMs ?? 400;
  const helloMaxMs = opts.helloMaxMs ?? 20_000;

  let ready = false;
  let stopped = false;
  let helloTimer: ReturnType<typeof setInterval> | null = null;
  let deadlineTimer: ReturnType<typeof setTimeout> | null = null;

  const clearTimers = () => {
    if (helloTimer !== null) clearInterval(helloTimer);
    if (deadlineTimer !== null) clearTimeout(deadlineTimer);
    helloTimer = null;
    deadlineTimer = null;
  };

  const hello = () =>
    opts.post({ type: "orz-host-hello", protocol: HOST_SAVE_PROTOCOL, version: HOST_SAVE_VERSION });

  return {
    get ready() {
      return ready;
    },

    start() {
      if (stopped || ready || helloTimer !== null) return;
      hello();
      // Re-sending is harmless per the spec; files behind a slow CDN miss
      // the first hello because their runtime hasn't parsed yet.
      helloTimer = setInterval(hello, helloIntervalMs);
      deadlineTimer = setTimeout(() => {
        clearTimers();
        if (!ready) opts.onHelloTimeout?.();
      }, helloMaxMs);
    },

    handleMessage(data: unknown) {
      if (stopped) return;

      const readyMsg = fromFile(data, "orz-host-ready");
      if (readyMsg) {
        // The file answers with the highest version it supports ≤ ours; v1
        // hosts only speak v1, so anything else means no common version.
        if (readyMsg["version"] !== HOST_SAVE_VERSION) return;
        if (ready) return; // duplicate ready — the retry loop makes these normal
        ready = true;
        clearTimers();
        opts.onReady?.({ kind: String(readyMsg["kind"] ?? ""), version: HOST_SAVE_VERSION });
        return;
      }

      const saveMsg = fromFile(data, "orz-host-save");
      if (saveMsg) {
        if (!ready) return; // saves are only valid after the handshake
        const source = typeof saveMsg["source"] === "string" ? saveMsg["source"] : "";
        const rendered = typeof saveMsg["html"] === "string" ? saveMsg["html"] : "";
        if (!rendered) {
          opts.post({ type: "orz-host-saved", ok: false, error: "The save arrived empty." });
          return;
        }
        void opts
          .save({ source, rendered })
          .then((r) =>
            opts.post(
              r.ok
                ? { type: "orz-host-saved", ok: true }
                : { type: "orz-host-saved", ok: false, error: r.error ?? "The host couldn't save." },
            ),
          )
          .catch(() =>
            opts.post({ type: "orz-host-saved", ok: false, error: "The host couldn't save." }),
          );
        return;
      }

      const dirtyMsg = fromFile(data, "orz-host-dirty");
      if (dirtyMsg && ready) {
        opts.onDirty?.(dirtyMsg["dirty"] === true);
      }
    },

    stop() {
      stopped = true;
      clearTimers();
    },
  };
}
