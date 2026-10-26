import { describe, expect, it } from "vitest";
import { REPORT_EXPLAINER, reportOutcomeFor, reportReturnPath } from "./report-return";

describe("reportReturnPath — back to the page after a no-script report (P11)", () => {
  it("returns to the course page with the outcome", () => {
    expect(reportReturnPath("/p/pkg-a", "pkg-a", "sent")).toBe(
      "/p/pkg-a?report=sent&reported=pkg-a#report-pkg-a",
    );
  });

  it("keeps the Discover search it came from", () => {
    expect(reportReturnPath("/portal?q=entropy&license=CC-BY-4.0", "pkg-a", "limited")).toBe(
      "/portal?q=entropy&license=CC-BY-4.0&report=limited&reported=pkg-a#report-pkg-a",
    );
  });

  it("replaces an earlier outcome rather than piling them up", () => {
    expect(reportReturnPath("/p/pkg-a?report=empty&reported=pkg-a", "pkg-a", "sent")).toBe(
      "/p/pkg-a?report=sent&reported=pkg-a#report-pkg-a",
    );
  });

  it.each(["@evil.example", "//evil.example", "https://evil.example", "/\\evil.example", null])(
    "never leaves the site for back=%j",
    (bad) => {
      const out = reportReturnPath(bad, "pkg-a", "sent");
      expect(out.startsWith("/portal?")).toBe(true);
      expect(new URL(`https://alembic.orz.how${out}`).origin).toBe("https://alembic.orz.how");
    },
  );
});

describe("reportOutcomeFor", () => {
  it("shows the outcome only next to the course it belongs to", () => {
    const sp = { report: "sent", reported: "pkg-a" };
    expect(reportOutcomeFor(sp, "pkg-a")).toBe("sent");
    expect(reportOutcomeFor(sp, "pkg-b")).toBeNull();
  });
  it("ignores unknown outcomes", () => {
    expect(reportOutcomeFor({ report: "<script>", reported: "pkg-a" }, "pkg-a")).toBeNull();
  });
});

describe("REPORT_EXPLAINER", () => {
  it("says who reads a report and what may happen, without promising a reply", () => {
    expect(REPORT_EXPLAINER).toMatch(/people who run Alembic/);
    expect(REPORT_EXPLAINER).toMatch(/off Discover/);
    expect(REPORT_EXPLAINER).toMatch(/won't get a reply/);
  });
});
