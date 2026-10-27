/**
 * When a document's typing is synced (A7; design §7.1). Pure: the clock and
 * the network are passed in, so the rules are tested without a browser.
 *
 * - Every edit is kept on the device at once ("Saved").
 * - Sync when the person leaves the document, after IDLE_MS without typing,
 *   at most MAX_WAIT_MS after the first unsynced edit while typing goes on,
 *   and at once on "Sync now" (or before Publish).
 * - One sync at a time. Edits made while a sync is under way make the
 *   document unsynced again. A failed sync keeps its sync id, so a retry is
 *   the same request (enqueueSync is idempotent by sync id).
 */

export const IDLE_MS = 2 * 60_000;
export const MAX_WAIT_MS = 5 * 60_000;
export const RETRY_MS = 30_000;

export interface Draft {
  text: string;
  /** The synced version this text was edited from (sha256), or null for a new file. */
  baseVersion: string | null;
}

export type SendResult =
  | { ok: true }
  | { ok: false; retryable: boolean; reason: string };

export type SyncStatus =
  | { kind: "synced"; at: number | null }
  | { kind: "saved" }
  | { kind: "syncing" }
  | { kind: "retrying"; reason: string }
  | { kind: "refused"; reason: string };

export interface SchedulerDeps {
  now(): number;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
  send(draft: Draft, syncId: string): Promise<SendResult>;
  newSyncId(): string;
  onStatus?(s: SyncStatus): void;
  /** Called after a sync went through (e.g. drop private text from the device). */
  onSynced?(draft: Draft): void;
}

export class SyncScheduler {
  private draft: Draft | null = null;      // the newest unsynced text
  private firstEditAt: number | null = null;
  private lastEditAt: number | null = null;
  private syncId: string | null = null;    // kept across retries of the same text
  private inFlight = false;
  private timer: unknown = null;
  private status: SyncStatus = { kind: "synced", at: null };

  constructor(private readonly d: SchedulerDeps) {}

  get current(): SyncStatus { return this.status; }
  get hasUnsynced(): boolean { return this.draft !== null; }

  /** The person typed: `text` is already on the device. */
  edit(draft: Draft): void {
    const t = this.d.now();
    if (this.draft === null) this.firstEditAt = t;
    this.draft = draft;
    this.syncId = null; // new text, new request
    this.lastEditAt = t;
    if (!this.inFlight && this.status.kind !== "refused") this.set({ kind: "saved" });
    this.plan();
  }

  /** Leaving the document, "Sync now", or before Publish. */
  async syncNow(): Promise<void> {
    await this.run();
  }

  dispose(): void {
    if (this.timer !== null) this.d.clearTimer(this.timer);
    this.timer = null;
  }

  private set(s: SyncStatus) {
    this.status = s;
    this.d.onStatus?.(s);
  }

  /** Arm one timer for the earliest moment a sync is due. */
  private plan(): void {
    if (this.timer !== null) this.d.clearTimer(this.timer);
    this.timer = null;
    if (this.draft === null || this.inFlight || this.firstEditAt === null || this.lastEditAt === null) return;
    const due = Math.min(this.lastEditAt + IDLE_MS, this.firstEditAt + MAX_WAIT_MS);
    this.timer = this.d.setTimer(() => { this.timer = null; void this.run(); }, Math.max(0, due - this.d.now()));
  }

  private async run(): Promise<void> {
    if (this.inFlight || this.draft === null) return;
    const draft = this.draft;
    this.syncId ??= this.d.newSyncId();
    const syncId = this.syncId;
    this.inFlight = true;
    if (this.timer !== null) { this.d.clearTimer(this.timer); this.timer = null; }
    this.set({ kind: "syncing" });
    let result: SendResult;
    try {
      result = await this.d.send(draft, syncId);
    } catch (e) {
      result = { ok: false, retryable: true, reason: (e as Error).message || "offline" };
    }
    this.inFlight = false;
    if (result.ok) {
      this.d.onSynced?.(draft);
      if (this.draft === draft) {
        this.draft = null;
        this.firstEditAt = this.lastEditAt = null;
        this.syncId = null;
        this.set({ kind: "synced", at: this.d.now() });
      } else {
        this.set({ kind: "saved" }); // typed during the sync: still unsynced
        this.plan();
      }
      return;
    }
    if (!result.retryable) {
      this.set({ kind: "refused", reason: result.reason });
      return; // stays on the device; the person decides (download, ask the owner)
    }
    this.set({ kind: "retrying", reason: result.reason });
    if (this.timer !== null) this.d.clearTimer(this.timer);
    this.timer = this.d.setTimer(() => { this.timer = null; void this.run(); }, RETRY_MS);
  }
}

/** The words in the document bar. */
export function statusLabel(s: SyncStatus, fmt: (ms: number) => string): string {
  switch (s.kind) {
    case "synced": return s.at === null ? "Synced" : `Synced at ${fmt(s.at)}`;
    case "saved": return "Saved";
    case "syncing": return "Syncing…";
    case "retrying": return "Saved — will sync when back online";
    case "refused": return "Saved on this device only — couldn't sync";
  }
}
