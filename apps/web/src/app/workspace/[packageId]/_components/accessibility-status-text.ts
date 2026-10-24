/**
 * The words of the accessibility status line (owner decision 2, 2026-10-24),
 * pure so they are tested (`accessibility-status-text.test.ts`). Educator
 * wording only: "check", "save", "version" — never a commit or a head.
 */

export interface A11yRecord {
  /** The server's record (`packages.a11y_status`); "unknown" = no current check. */
  status: "pass" | "warn" | "fail" | "unknown";
  checkedAt: string | null;
}

const ago = (iso: string, now: Date): string => {
  const mins = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 60_000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
};

export function a11yStatusLine(r: A11yRecord, now = new Date()): { text: string; tone: string } {
  const when = r.checkedAt ? ` (checked ${ago(r.checkedAt, now)})` : "";
  switch (r.status) {
    case "pass":
      return { text: `Accessibility: no problems found${when}.`, tone: "text-ok" };
    case "warn":
      return { text: `Accessibility: minor issues${when}.`, tone: "text-warn" };
    case "fail":
      return { text: `Accessibility: needs work${when}.`, tone: "text-danger" };
    default:
      return {
        text: "Accessibility: not checked for your latest version yet — it is checked automatically after you save.",
        tone: "text-muted",
      };
  }
}
