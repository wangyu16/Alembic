/**
 * Reporting a course without JavaScript (blind-critique 2026-10-26, P11).
 *
 * The report control is a plain `<form method="post" action="/portal/report">`
 * that JavaScript enhances. With scripts off the browser posts it; the route
 * files the report through the same server action and sends the visitor back
 * to the page they came from with the outcome in the address
 * (`?report=sent&reported={packageId}#report-{packageId}`), which the page
 * shows next to that course's control. Pure; tested in `report-return.test.ts`.
 */

import { DEFAULT_NEXT, safeNextPath } from "./safe-next";

export const REPORT_CODES = ["sent", "empty", "limited", "busy", "invalid", "error"] as const;
export type ReportCode = (typeof REPORT_CODES)[number];

export const REPORT_MESSAGES: Record<ReportCode, string> = {
  sent: "Reported — thank you. The people who run Alembic will read it.",
  empty: "Add a brief reason for the report.",
  limited: "You've sent several reports in a short time. Please try again later.",
  busy: "Many reports have been sent in a short time. Please try again later.",
  invalid: "This report couldn't be filed for this course.",
  error: "Couldn't send the report. Please try again.",
};

/** What happens to a report — the truth per docs/specs/portal-governance.md. */
export const REPORT_EXPLAINER =
  "Your report goes to the people who run Alembic, not to the course's author. " +
  "They review it and may take the course off Discover. You won't get a reply, " +
  "and your internet address is not stored.";

export function isReportCode(v: unknown): v is ReportCode {
  return typeof v === "string" && (REPORT_CODES as readonly string[]).includes(v);
}

/** Where to send the visitor back to after a no-script report. `back` is
 *  untrusted (a form field): only same-site paths, otherwise Discover. */
export function reportReturnPath(back: string | null, packageId: string, code: ReportCode): string {
  const safe = safeNextPath(back);
  const path = safe === DEFAULT_NEXT && back !== DEFAULT_NEXT ? "/portal" : safe;
  const url = new URL(path, "https://alembic.invalid");
  url.searchParams.set("report", code);
  url.searchParams.set("reported", packageId.slice(0, 200));
  url.hash = `report-${packageId.slice(0, 200)}`;
  return `${url.pathname}${url.search}${url.hash}`;
}

/** The outcome to show next to one course's report control, if any. */
export function reportOutcomeFor(
  sp: Record<string, string | string[] | undefined>,
  packageId: string,
): ReportCode | null {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const code = one(sp["report"]);
  return one(sp["reported"]) === packageId && isReportCode(code) ? code : null;
}
