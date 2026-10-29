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
}

/**
 * What an opened document starts from (RC.17): text kept on this device that
 * hasn't reached the course always wins, and is sent again with the version
 * it was edited from, so the course merges it with what changed meanwhile.
 * Never silently dropped because the course moved on.
 */
export function resumeFrom(kept: DeviceDraft | null | undefined, course: { text: string; version: string | null }): { text: string; pending: { text: string; baseVersion: string | null } | null } {
  if (!kept || kept.text === course.text) return { text: course.text, pending: null };
  // Known unsent (RC.17); or a record from before the flag, only when the course hasn't moved since it
  // was edited (the old rule: such a record may hold text the course already has, audit r3 HIGH-1).
  const unsent = kept.synced === false || (kept.synced === undefined && kept.baseVersion === course.version);
  return unsent ? { text: kept.text, pending: { text: kept.text, baseVersion: kept.baseVersion } } : { text: course.text, pending: null };
}

export interface DraftStore {
  put(d: DeviceDraft): Promise<void>;
  get(key: string): Promise<DeviceDraft | null>;
  delete(key: string): Promise<void>;
  list(prefix: string): Promise<DeviceDraft[]>;
}

export const draftKey = (packageId: string, path: string) => `${packageId}:${path}`;

export class MemoryDraftStore implements DraftStore {
  private readonly m = new Map<string, DeviceDraft>();
  async put(d: DeviceDraft) { this.m.set(d.key, { ...d }); }
  async get(key: string) { const d = this.m.get(key); return d ? { ...d } : null; }
  async delete(key: string) { this.m.delete(key); }
  async list(prefix: string) { return [...this.m.values()].filter((d) => d.key.startsWith(prefix)).map((d) => ({ ...d })); }
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
}

/** Ask the browser not to evict this site's storage (Safari evicts after 7 days unused). */
export async function requestPersistentStorage(): Promise<boolean> {
  try { return (await navigator.storage?.persist?.()) ?? false; } catch { return false; }
}
