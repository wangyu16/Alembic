// @alembic/a11y — pure accessibility audit over already-rendered HTML.
//
// PURE package: no IO, no filesystem, no network, no framework imports, no
// Node built-ins. It consumes HTML produced elsewhere (by orz-markdown) and
// reports educator-facing accessibility findings. It is NOT a markdown parser.

import {
  checkEmptyHeadings,
  checkHeadingOrder,
  checkImages,
  checkLinks,
  checkTables,
  extractHeadings,
  type A11yFinding,
  type A11yRule,
  type A11ySeverity,
  type HeadingHit,
} from "./rules";

export type { A11ySeverity, A11yRule, A11yFinding };

export interface A11yReport {
  findings: A11yFinding[];
  /** "fail" if any error-severity finding; "warn" if only warnings; "pass" if none. */
  status: "pass" | "warn" | "fail";
  errorCount: number;
  warningCount: number;
}

/** Build the report wrapper (status + counts) from a list of findings. */
function toReport(findings: A11yFinding[]): A11yReport {
  let errorCount = 0;
  let warningCount = 0;
  for (const f of findings) {
    if (f.severity === "error") errorCount++;
    else warningCount++;
  }
  const status: A11yReport["status"] =
    errorCount > 0 ? "fail" : warningCount > 0 ? "warn" : "pass";
  return { findings, status, errorCount, warningCount };
}

/**
 * Run every per-fragment rule (everything except cross-document heading order)
 * over one HTML string. Heading order is handled separately so it can be
 * evaluated across multiple fragments.
 */
function auditFragmentBody(html: string, headings: HeadingHit[]): A11yFinding[] {
  return [
    ...checkImages(html),
    ...checkEmptyHeadings(headings),
    ...checkLinks(html),
    ...checkTables(html),
  ];
}

/** Audit a single fragment/document of rendered HTML. */
export function auditHtml(html: string): A11yReport {
  const headings = extractHeadings(html);
  const findings = [
    ...auditFragmentBody(html, headings),
    ...checkHeadingOrder(headings),
  ];
  return toReport(findings);
}

/** Prefix a finding's context with the fragment label so the educator can
 * tell which section it belongs to. Labeled fragments only; unlabeled ones
 * keep their bare context. */
function withLabel(label: string, finding: A11yFinding): A11yFinding {
  if (label === "") return finding;
  const ctx = finding.context;
  const tail = ctx === "" ? "" : `: ${ctx}`;
  return { ...finding, context: `In “${label}”${tail}` };
}

/**
 * Audit several named HTML fragments and return a combined report plus enough
 * context to locate each issue.
 *
 * Heading-order is evaluated ACROSS the fragments in array order (treating the
 * sequence as one document), while img/link/table/empty-heading findings are
 * attributed to the fragment they occur in (and get the fragment label folded
 * into their `context`).
 */
export function auditFragments(
  fragments: Array<{ label: string; html: string }>,
): A11yReport {
  const findings: A11yFinding[] = [];

  // Per-fragment rules, attributed to their fragment.
  const allHeadings: HeadingHit[] = [];
  for (const fragment of fragments) {
    const headings = extractHeadings(fragment.html);
    allHeadings.push(...headings);
    for (const f of auditFragmentBody(fragment.html, headings)) {
      findings.push(withLabel(fragment.label, f));
    }
  }

  // Heading order across the whole document. We don't know which fragment a
  // given cross-boundary skip "belongs" to, so these stay unlabeled.
  findings.push(...checkHeadingOrder(allHeadings));

  return toReport(findings);
}
