import { describe, expect, it } from "vitest";
import { checkBytes, checkUpload, COURSE_MAX_BYTES, UPLOADS_PER_PERSON_HOUR } from "./upload";

const counts = { byPersonLastHour: 0, byCourseLastHour: 0, courseBytes: 0 };
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);

describe("uploading a file (contract v3 §11.2–§11.4)", () => {
  it("[K1.14] a figure added from an instructor-only document is stored privately, never in the published figures folder", async () => {
    const { activeProfile } = await import("@alembic/package-contract");
    expect(activeProfile.figureFolder("private/instructor/answers.md")).toBe("private/instructor/figures/answers");
    expect(activeProfile.figureFolder("slides/gases.slides.md")).toBe("assets/gases");
    expect(checkUpload({ path: "assets/answers/key.png", size: 10, role: "owner", counts, fromDoc: "private/instructor/answers.md" })).toMatchObject({ ok: false, status: 403 });
    expect(checkUpload({ path: "private/instructor/figures/answers/key.png", size: 10, role: "co-author", counts, fromDoc: "private/instructor/answers.md" })).toMatchObject({ ok: true });
  });
  it("[K1.10] a member who may write the path can add a picture of an allowed kind up to 4 MB; anything else gets a plain reason", () => {
    expect(checkUpload({ path: "assets/gases/b.png", size: 1000, role: "co-author", counts })).toEqual({ ok: true, path: "assets/gases/b.png", kind: "png" });
    expect(checkUpload({ path: "assets/gases/b.png", size: 4_000_001, role: "owner", counts })).toMatchObject({ ok: false, status: 413, message: expect.stringMatching(/larger than 4 MB/) });
    expect(checkUpload({ path: "assets/run.exe", size: 10, role: "owner", counts })).toMatchObject({ ok: false, status: 415 });
    expect(checkUpload({ path: "study-guide/gases.md", size: 10, role: "owner", counts })).toMatchObject({ ok: false, status: 415 });
    expect(checkUpload({ path: "assets/../private/x.png", size: 10, role: "owner", counts })).toMatchObject({ ok: false, status: 400 });
    expect(checkUpload({ path: ".github/x.png", size: 10, role: "owner", counts })).toMatchObject({ ok: false });
  });
  it("[K1.19] uploads are limited per person and per course each hour, and by the course's total, counted from the ledger", () => {
    expect(checkUpload({ path: "assets/a.png", size: 10, role: "owner", counts: { ...counts, byPersonLastHour: UPLOADS_PER_PERSON_HOUR } })).toMatchObject({ ok: false, status: 429 });
    expect(checkUpload({ path: "assets/a.png", size: 10, role: "owner", counts: { ...counts, byCourseLastHour: 200 } })).toMatchObject({ ok: false, status: 429 });
    expect(checkUpload({ path: "assets/a.png", size: 10, role: "owner", counts: { ...counts, courseBytes: COURSE_MAX_BYTES - 5 } })).toMatchObject({ ok: false, status: 507 });
  });
  it("[K1.11] the bytes must be what the name says, and an SVG must be safe", () => {
    expect(checkBytes("png", PNG)).toBeNull();
    expect(checkBytes("jpeg", PNG)).toMatch(/isn't a JPEG/);
    expect(checkBytes("svg", new TextEncoder().encode("<svg><script>x</script></svg>"))).toMatch(/script/);
  });
});
