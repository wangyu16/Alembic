/**
 * Host-side client for the `orz-host-include@1` protocol (canonical spec:
 * PROTOCOL.md in each runtime repo — a sibling of `orz-host-save@1` /
 * `orz-host-ai@1`). A self-contained orz file embedded in an iframe delegates
 * URL-based markdown transclusion (`{{md-include https://…}}`) to the host: the
 * host announces it can resolve includes (hello, with retry — files behind a
 * slow CDN boot late), the file confirms with `ready`, then for each include it
 * sends an `orz-host-include-request` the host answers with
 * `orz-host-include-result`.
 *
 * File owns rendering (which URLs, where to splice); host owns resolution
 * (fetching the permalink under its own allowlist/policy). This keeps STANDALONE
 * files from ever auto-fetching author-chosen URLs from a viewer's browser — a
 * file only resolves includes when a trusted host answers the handshake.
 *
 * Pure protocol logic — no DOM; the caller owns the iframe and forwards only
 * `message` events whose `event.source` is that iframe's window.
 */

export const HOST_INCLUDE_PROTOCOL = "orz-host-include";
export const HOST_INCLUDE_VERSION = 1;

export interface HostIncludeClientOptions {
  /** Send a protocol message to the file (bind to `contentWindow.postMessage`). */
  post(message: Record<string, unknown>): void;
  /** Resolve one include URL to its markdown, or `null` to leave it unresolved
   *  (declined / not allowed / not found). The host owns the allowlist + fetch. */
  resolve(url: string): Promise<string | null>;
  /** Handshake completed (file replied `orz-host-include-ready`). */
  onReady?(info: { version: number }): void;
  /** No `orz-host-include-ready` before `helloMaxMs` — the file predates the
   *  bridge (or has no includes); the host just never receives requests. */
  onHelloTimeout?(): void;
  /** Hello retry cadence (default 400ms) and give-up horizon (default 20s). */
  helloIntervalMs?: number;
  helloMaxMs?: number;
}

export interface HostIncludeClient {
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
  if (data["protocol"] !== HOST_INCLUDE_PROTOCOL) return null;
  return data;
}

export function createHostIncludeClient(opts: HostIncludeClientOptions): HostIncludeClient {
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
    opts.post({
      type: "orz-host-include-hello",
      protocol: HOST_INCLUDE_PROTOCOL,
      version: HOST_INCLUDE_VERSION,
    });

  const result = (
    requestId: unknown,
    payload: { ok: boolean; markdown?: string; error?: string },
  ) =>
    opts.post({
      type: "orz-host-include-result",
      protocol: HOST_INCLUDE_PROTOCOL,
      version: HOST_INCLUDE_VERSION,
      requestId,
      ok: payload.ok,
      ...(payload.markdown !== undefined ? { markdown: payload.markdown } : {}),
      ...(payload.error !== undefined ? { error: payload.error } : {}),
    });

  return {
    get ready() {
      return ready;
    },

    start() {
      if (stopped || ready || helloTimer !== null) return;
      hello();
      helloTimer = setInterval(hello, helloIntervalMs);
      deadlineTimer = setTimeout(() => {
        clearTimers();
        if (!ready) opts.onHelloTimeout?.();
      }, helloMaxMs);
    },

    handleMessage(data: unknown) {
      if (stopped) return;

      const readyMsg = fromFile(data, "orz-host-include-ready");
      if (readyMsg) {
        if (readyMsg["version"] !== HOST_INCLUDE_VERSION) return;
        if (ready) return; // duplicate ready — the retry loop makes these normal
        ready = true;
        clearTimers();
        opts.onReady?.({ version: HOST_INCLUDE_VERSION });
        return;
      }

      const reqMsg = fromFile(data, "orz-host-include-request");
      if (reqMsg) {
        if (!ready) return; // requests are only valid after the handshake
        const requestId = reqMsg["requestId"];
        const url = typeof reqMsg["url"] === "string" ? reqMsg["url"] : "";
        if (!url) {
          result(requestId, { ok: false, error: "The include request arrived empty." });
          return;
        }
        void opts
          .resolve(url)
          .then((markdown) =>
            markdown == null
              ? result(requestId, { ok: false, error: "Not resolvable." })
              : result(requestId, { ok: true, markdown }),
          )
          .catch(() =>
            result(requestId, { ok: false, error: "The host couldn't resolve that." }),
          );
        return;
      }
    },

    stop() {
      stopped = true;
      clearTimers();
    },
  };
}
