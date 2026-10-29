/**
 * Unsynced text kept on the device (A7). IndexedDB in the browser; a memory
 * store for tests. Private (Instructor) text is removed once synced unless
 * the person keeps that course offline (design §7.1, §7.7).
 */

export interface DeviceDraft {
  /** `${packageId}:${path}` */
  key: string;
  text: string;
  baseVersion: string | null;
  savedAt: number;
  private: boolean;
  /** The course has this text (set after a sync; absent on records from before RC.17: treated as not sent). */
  synced?: boolean;
  /** The sync that carried exactly this text, recorded before it was sent: on reopening, the course is asked whether that sync arrived (audit r5 MEDIUM-1). */
  sentId?: string;
}

/**
 * What an opened document starts from (RC.17): text kept on this device that
 * hasn't reached the course always wins, and is sent again with the version
 * it was edited from, so the course merges it with what changed meanwhile.
 * Never silently dropped because the course moved on.
 */
export function resumeFrom(
  kept: DeviceDraft | null | undefined,
  course: { text: string; version: string | null },
  /** The sync that carried the kept text arrived (its reply was lost while the tab was closing, audit r4 H-1 / r5 MEDIUM-1). */
  courseHasKept = false,
): { text: string; pending: { text: string; baseVersion: string | null } | null } {
  if (!kept || kept.text === course.text || courseHasKept) return { text: course.text, pending: null };
  // Known unsent (RC.17); or a record from before the flag, only when the course hasn't moved since it
  // was edited (the old rule: such a record may hold text the course already has, audit r3 HIGH-1).
  const unsent = kept.synced === false || (kept.synced === undefined && kept.baseVersion === course.version);
  return unsent ? { text: kept.text, pending: { text: kept.text, baseVersion: kept.baseVersion } } : { text: course.text, pending: null };
}

/**
 * Which sync to ask the course about before resuming (audit r5 MEDIUM-1): only the one recorded as carrying
 * exactly the kept text. Never "does the course hold this text": a revert to older text would match and be
 * dropped. Unsent text with no recorded sync was never sent, so it is resent without asking.
 */
export function arrivalToCheck(kept: DeviceDraft | null | undefined, courseText: string): string | null {
  return kept && kept.text !== courseText && kept.synced === false && kept.sentId ? kept.sentId : null;
}

/**
 * A text the course accepted but hasn't written yet (re-verifier r4 A3/j: a reopen within seconds of "Saved"
 * showed the older text): the sync to ask about, so the editor can show this text while it lands.
 */
export function landingToCheck(kept: DeviceDraft | null | undefined, courseText: string): string | null {
  return kept && kept.text !== courseText && kept.synced === true && kept.sentId ? kept.sentId : null;
}

export interface DraftStore {
  put(d: DeviceDraft): Promise<void>;
  get(key: string): Promise<DeviceDraft | null>;
  delete(key: string): Promise<void>;
  list(prefix: string): Promise<DeviceDraft[]>;
  /** Read, change and write one record atomically (audit r5 LOW-2): `fn` returns the new record, null to delete, undefined to leave it. */
  update(key: string, fn: (cur: DeviceDraft | null) => DeviceDraft | null | undefined): Promise<void>;
}

export const draftKey = (packageId: string, path: string) => `${packageId}:${path}`;

export class MemoryDraftStore implements DraftStore {
  private readonly m = new Map<string, DeviceDraft>();
  async put(d: DeviceDraft) { this.m.set(d.key, { ...d }); }
  async get(key: string) { const d = this.m.get(key); return d ? { ...d } : null; }
  async delete(key: string) { this.m.delete(key); }
  async list(prefix: string) { return [...this.m.values()].filter((d) => d.key.startsWith(prefix)).map((d) => ({ ...d })); }
  async update(key: string, fn: (cur: DeviceDraft | null) => DeviceDraft | null | undefined) {
    const cur = this.m.get(key);
    const next = fn(cur ? { ...cur } : null);
    if (next === null) this.m.delete(key); else if (next) this.m.set(key, { ...next });
  }
}

const DB = "alembic-device";
const STORE = "drafts";

export class IndexedDbDraftStore implements DraftStore {
  private db: Promise<IDBDatabase> | null = null;

  private open(): Promise<IDBDatabase> {
    this.db ??= new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => { req.result.createObjectStore(STORE, { keyPath: "key" }); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return this.db;
  }

  private async tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.open();
    return new Promise<T>((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const req = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(req.result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  }

  async put(d: DeviceDraft) { await this.tx("readwrite", (s) => s.put(d)); }
  async get(key: string) { return ((await this.tx("readonly", (s) => s.get(key))) as DeviceDraft | undefined) ?? null; }
  async delete(key: string) { await this.tx("readwrite", (s) => s.delete(key)); }
  async list(prefix: string) {
    const range = IDBKeyRange.bound(prefix, `${prefix}￿`);
    return (await this.tx("readonly", (s) => s.getAll(range))) as DeviceDraft[];
  }
  async update(key: string, fn: (cur: DeviceDraft | null) => DeviceDraft | null | undefined) {
    // One readwrite transaction: a keystroke stored meanwhile can't be overwritten by an older record.
    await this.tx("readwrite", (s) => {
      const req = s.get(key);
      req.onsuccess = () => {
        const next = fn((req.result as DeviceDraft | undefined) ?? null);
        if (next === null) s.delete(key); else if (next) s.put(next);
      };
      return req;
    });
  }
}

/** Ask the browser not to evict this site's storage (Safari evicts after 7 days unused). */
export async function requestPersistentStorage(): Promise<boolean> {
  try { return (await navigator.storage?.persist?.()) ?? false; } catch { return false; }
}
