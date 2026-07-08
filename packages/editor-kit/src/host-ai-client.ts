/**
 * Host-side client for the `orz-host-ai@1` protocol (canonical spec:
 * docs/specs/orz-host-ai.md — sibling of `orz-host-save@1`). A self-contained
 * orz file embedded in an iframe delegates its in-file AI assistant to the host:
 * the host announces which operations it offers (hello, with retry — files
 * behind a slow CDN boot late), the file confirms with `ready`, then sends
 * `orz-host-ai-request` messages the host runs and answers with
 * `orz-host-ai-result`.
 *
 * File owns the UI (selection, menu, diff, apply); host owns execution
 * (which ops, the model call, governance, tiers). Pure protocol logic — no DOM;
 * the caller owns the iframe and forwards only `message` events whose
 * `event.source` is that iframe's window.
 */

export const HOST_AI_PROTOCOL = "orz-host-ai";
export const HOST_AI_VERSION = 1;

/** An operation the host advertises to the file's assistant. */
export interface HostAIOperation {
  /** Stable operation id the file echoes back in a request. */
  id: string;
  /** Menu label shown in the file's assistant. */
  title: string;
  /** Offered on a text selection (a passage), not only the whole document. */
  selection: boolean;
}

/** An AI request the file makes. */
export interface HostAIRequest {
  /** An advertised operation id. */
  op: string;
  /** The content to operate on: the selected passage, or the whole document. */
  text: string;
  /** True when `text` is a selected passage (not the whole document). */
  selection: boolean;
}

export interface HostAIClientOptions {
  /** Send a protocol message to the file (bind to `contentWindow.postMessage`). */
  post(message: Record<string, unknown>): void;
  /** The operations this host offers the file (advertised in the hello). */
  operations: HostAIOperation[];
  /** Run an operation the file requested; the outcome is relayed back. */
  run(request: HostAIRequest): Promise<{ ok: boolean; proposed?: string; error?: string }>;
  /** Handshake completed (file replied `orz-host-ai-ready`). */
  onReady?(info: { version: number }): void;
  /** No `orz-host-ai-ready` before `helloMaxMs` — the file predates the bridge
   *  (or has no assistant); the host just never receives AI requests. */
  onHelloTimeout?(): void;
  /** Hello retry cadence (default 400ms) and give-up horizon (default 20s). */
  helloIntervalMs?: number;
  helloMaxMs?: number;
}

export interface HostAIClient {
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
  if (data["protocol"] !== HOST_AI_PROTOCOL) return null;
  return data;
}

export function createHostAIClient(opts: HostAIClientOptions): HostAIClient {
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
      type: "orz-host-ai-hello",
      protocol: HOST_AI_PROTOCOL,
      version: HOST_AI_VERSION,
      operations: opts.operations,
    });

  const result = (
    requestId: unknown,
    payload: { ok: boolean; proposed?: string; error?: string },
  ) =>
    opts.post({
      type: "orz-host-ai-result",
      protocol: HOST_AI_PROTOCOL,
      version: HOST_AI_VERSION,
      requestId,
      ok: payload.ok,
      ...(payload.proposed !== undefined ? { proposed: payload.proposed } : {}),
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

      const readyMsg = fromFile(data, "orz-host-ai-ready");
      if (readyMsg) {
        if (readyMsg["version"] !== HOST_AI_VERSION) return;
        if (ready) return; // duplicate ready — the retry loop makes these normal
        ready = true;
        clearTimers();
        opts.onReady?.({ version: HOST_AI_VERSION });
        return;
      }

      const reqMsg = fromFile(data, "orz-host-ai-request");
      if (reqMsg) {
        if (!ready) return; // requests are only valid after the handshake
        const requestId = reqMsg["requestId"];
        const op = typeof reqMsg["op"] === "string" ? reqMsg["op"] : "";
        const text = typeof reqMsg["text"] === "string" ? reqMsg["text"] : "";
        const selection = reqMsg["selection"] === true;
        if (!op || !text) {
          result(requestId, { ok: false, error: "The AI request arrived empty." });
          return;
        }
        void opts
          .run({ op, text, selection })
          .then((r) =>
            result(requestId, { ok: r.ok, proposed: r.proposed, error: r.error }),
          )
          .catch(() =>
            result(requestId, { ok: false, error: "The host couldn't run that." }),
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
