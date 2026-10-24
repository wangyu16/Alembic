import { describe, expect, it } from "vitest";
import { a11yStatusLine } from "./accessibility-status-text";

const now = new Date("2026-10-24T12:00:00Z");

describe("the accessibility status line (owner decision 2, 2026-10-24)", () => {
  it("[P5.R.5.g] the educator sees the latest check in plain words, and when it ran", () => {
    expect(a11yStatusLine({ status: "pass", checkedAt: "2026-10-24T11:55:00Z" }, now).text).toBe(
      "Accessibility: no problems found (checked 5 min ago).",
    );
    expect(a11yStatusLine({ status: "warn", checkedAt: "2026-10-24T09:00:00Z" }, now).text).toBe(
      "Accessibility: minor issues (checked 3 h ago).",
    );
    expect(a11yStatusLine({ status: "fail", checkedAt: "2026-10-22T12:00:00Z" }, now).tone).toBe("text-danger");
    const none = a11yStatusLine({ status: "unknown", checkedAt: "2026-10-20T00:00:00Z" }, now).text;
    expect(none).toMatch(/not checked for your latest version yet/);
    // educator wording only — no developer vocabulary
    for (const s of ["pass", "warn", "fail", "unknown"] as const) {
      expect(a11yStatusLine({ status: s, checkedAt: null }, now).text).not.toMatch(/commit|head|sha|repo|git|push/i);
    }
  });
});
