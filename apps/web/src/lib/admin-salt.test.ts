import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("./supabase/server", () => ({ createSupabaseServerClient: vi.fn() }));
vi.mock("./supabase/service", () => ({ createServiceClient: vi.fn() }));

const { exportPseudonymizer } = await import("./admin");

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
});

// Sibling of P5.S.11 (a secret that is set-but-blank must not count as set):
// a blank RESEARCH_EXPORT_SALT used to give an EMPTY salt, so the export's
// participant codes were a bare sha256 of the user id — linkable by anyone
// who knows an id.
describe("research export pseudonymizer salt", () => {
  it("ignores a blank RESEARCH_EXPORT_SALT and falls through to the service key", () => {
    process.env["RESEARCH_EXPORT_SALT"] = "";
    process.env["SUPABASE_SECRET_KEY"] = "service-key";
    const blank = exportPseudonymizer()("user-1");
    process.env["RESEARCH_EXPORT_SALT"] = "service-key";
    expect(blank).toBe(exportPseudonymizer()("user-1"));
  });
});
