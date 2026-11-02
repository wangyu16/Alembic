/** Pure: no server imports, so it is testable alone. */
/** A snapshot name as a tag slug (history-v3 §5). */
export function snapshotSlug(name: string, today: Date = new Date()): string {
  const s = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60).replace(/-+$/, "");
  return s || `snapshot-${today.toISOString().slice(0, 10)}`;
}
