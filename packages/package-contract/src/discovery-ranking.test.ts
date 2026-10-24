import { describe, expect, it } from "vitest";
import {
  RANKING,
  adaptationSignal,
  courseQualityScore,
  qualityScore,
  rankScore,
  recencySignal,
  type QualitySignals,
} from "./discovery";

const asOf = "2026-10-23T10:00:00Z";
const base: QualitySignals = {
  a11y: "unknown",
  license: "CC-BY-4.0",
  completeness: 0.4,
  adaptations: 0,
  updatedAt: "2026-06-01T00:00:00Z",
  asOf,
};

describe("A.3 ranking", () => {
  it("[P5.A.3.a] the weights sum to 1, so quality is 0 … 1", () => {
    const sum = Object.values(RANKING.weights).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 12);
    const best = qualityScore({ a11y: "pass", license: "CC0-1.0", completeness: 1, adaptations: 1000, updatedAt: asOf, asOf });
    const worst = qualityScore({ a11y: "fail", license: "ALL-RIGHTS-RESERVED", completeness: 0, adaptations: 0, updatedAt: "1990-01-01T00:00:00Z", asOf });
    expect(best).toBeCloseTo(1, 12);
    expect(worst).toBeCloseTo(0, 12);
  });

  it.each([
    ["accessibility audit passed", { a11y: "pass" }],
    ["accessibility with minor issues (vs unknown)", { a11y: "warn" }],
    ["more complete listing", { completeness: 0.8 }],
    ["more recently updated", { updatedAt: "2026-10-01T00:00:00Z" }],
    ["adapted by others", { adaptations: 3 }],
  ])("each signal raises quality: %s", (_l, over) => {
    expect(qualityScore({ ...base, ...over })).toBeGreaterThan(qualityScore(base));
  });

  it("[P5.A.3.d] an open licence raises quality (elements may carry their own licence)", () => {
    expect(qualityScore(base)).toBeGreaterThan(qualityScore({ ...base, license: "ALL-RIGHTS-RESERVED" }));
  });

  it("[P5.A.3.d] recency halves in about four months and never goes negative or explodes", () => {
    expect(recencySignal(asOf, asOf)).toBe(1);
    expect(recencySignal("2026-06-20T00:00:00Z", asOf)).toBeGreaterThan(0.45);
    expect(recencySignal("2026-06-20T00:00:00Z", asOf)).toBeLessThan(0.55);
    expect(recencySignal("1900-01-01T00:00:00Z", asOf)).toBeGreaterThanOrEqual(0);
    // a future timestamp (clock skew) counts as now
    expect(recencySignal("2030-01-01T00:00:00Z", asOf)).toBe(1);
  });

  it("[P5.A.3.d] adaptations saturate", () => {
    expect(adaptationSignal(0)).toBe(0);
    expect(adaptationSignal(20)).toBeCloseTo(1, 12);
    expect(adaptationSignal(10_000)).toBe(1);
  });

  it("[P5.A.3.c] prominence, not censorship: any match keeps a positive score, whatever its quality", () => {
    expect(rankScore(0.01, 0)).toBeGreaterThan(0);
    expect(rankScore(1, 0)).toBe(0.75);
    expect(rankScore(1, 1)).toBe(1.25);
  });

  it("[P5.A.3.b] relevance first: quality can only reorder matches within a factor of 5/3", () => {
    // a match more than 5/3 as relevant always wins, whatever the qualities
    expect(rankScore(1.0, 0)).toBeGreaterThan(rankScore(0.59, 1));
    // near-ties are decided by quality
    expect(rankScore(0.5, 0.9)).toBeGreaterThan(rankScore(0.55, 0.1));
  });

  it("[P5.R.5.e] a course without a current accessibility check is neutral: the term is left out and the rest re-weighted", () => {
    const signals = { ...base, completeness: 0.6, adaptations: 4, updatedAt: "2026-09-01T00:00:00Z" };
    const unknown = courseQualityScore(signals);
    const pass = courseQualityScore({ ...signals, a11y: "pass" });
    const fail = courseQualityScore({ ...signals, a11y: "fail" });
    // never with the failing course (was: unknown counted as 0, the same as fail)
    expect(unknown).toBeGreaterThan(fail);
    expect(unknown).toBeLessThan(pass);
    expect(qualityScore(signals)).toBeCloseTo(fail, 12);
    // exactly the other four signals, re-weighted to sum to 1
    expect(unknown).toBeCloseTo(fail / (1 - RANKING.weights.accessibility), 12);
    // a checked course scores as before; anything that is not a check is "unknown"
    for (const a11y of ["pass", "warn", "fail"]) expect(courseQualityScore({ ...signals, a11y })).toBe(qualityScore({ ...signals, a11y }));
    expect(courseQualityScore({ ...signals, a11y: "bogus" })).toBe(unknown);
    // still 0 … 1
    expect(courseQualityScore({ a11y: "unknown", license: "CC0-1.0", completeness: 1, adaptations: 1000, updatedAt: asOf, asOf })).toBeCloseTo(1, 12);
  });
});
