import { describe, expect, it, vi } from "vitest";
import {
  DIGEST_CAP, MemoryMailer, ResendMailer, buildDigest, buildInvitation, signActionToken, verifyActionToken,
  type DigestCourse, type DigestItem, type NeedsYouKind,
} from "./index";

const SECRET = "s".repeat(40);
const item = (id: string, kind: NeedsYouKind, chapter: string | null = null, title?: string, createdAt = "2026-10-20T00:00:00Z"): DigestItem =>
  ({ id, kind, chapter, title, createdAt });
const base = (courses: DigestCourse[]) => ({
  person: { userId: "u1", email: "a@example.org", name: "Ada <b>" },
  period: "week" as const,
  periodKey: "2026-W44",
  courses,
  settingsUrl: "https://alembic.example/settings",
  actionLink: (i: DigestItem, a: string) => `https://alembic.example/act?i=${i.id}&a=${a}`,
});

describe("buildDigest", () => {
  it("says so when nothing needs you", () => {
    const e = buildDigest(base([{ title: "Chem", url: "https://c", items: [] }]));
    expect(e.subject).toBe("Nothing needs you this week");
    expect(e.text).toContain("Nothing needs you this week");
    expect(e.idempotencyKey).toBe("digest:u1:2026-W44");
  });

  it("ranks approvals first, groups by course and chapter, caps the list, escapes text", () => {
    const items = [
      item("q", "question", "Chapter 2", "Which <unit>?"),
      item("a", "approve", "Chapter 5", "Chapter 5 plan"),
      item("c", "to-confirm", "Chapter 2", "Keep figure 3"),
      ...Array.from({ length: 12 }, (_, n) => item(`i${n}`, "update", null)),
    ];
    const e = buildDigest(base([{ title: "Chem", url: "https://c", items }]));
    expect(e.subject).toBe("15 things need you this week");
    expect(e.text.indexOf("Approve: Chapter 5 plan")).toBeLessThan(e.text.indexOf("Question from the agent"));
    expect((e.text.match(/^\s+- /gm) ?? []).length).toBe(DIGEST_CAP);
    expect(e.text).toContain("5 more are waiting");
    expect(e.html).toContain("Which &lt;unit&gt;?");
    expect(e.html).toContain("Ada &lt;b&gt;");
    expect(e.html).not.toContain("<unit>");
    // One-click only for simple items.
    expect(e.text).toContain("Confirm: https://alembic.example/act?i=c&a=confirm");
    expect(e.text).not.toContain("act?i=a");
    // Someone who can see an item but not decide it gets no one-click link.
    const co = buildDigest(base([{ title: "Chem", url: "https://c", items: [{ ...item("c2", "to-confirm"), canDecide: false }] }]));
    expect(co.text).not.toContain("act?i=c2");
  });
});

describe("buildInvitation", () => {
  it("names the inviter and course, links to accept, and is sent once per invitation", () => {
    const e = buildInvitation({ invitationId: "inv1", to: "b@example.org", inviterName: "Ada", courseTitle: "Chem <1>", role: "co-author", acceptUrl: "https://a/accept?t=x", expiresAt: new Date("2026-11-10T00:00:00Z") });
    expect(e.subject).toContain("Ada invited you");
    expect(e.html).toContain("Chem &lt;1&gt;");
    expect(e.text).toContain("until 2026-11-10");
    expect(e.idempotencyKey).toBe("invite:inv1");
  });
});

describe("action tokens", () => {
  const claim = { item: "n1", user: "u1", action: "confirm", exp: 2_000 };
  it("round-trips, and refuses tampering, another secret, expiry and short secrets", () => {
    const t = signActionToken(claim, SECRET);
    expect(verifyActionToken(t, SECRET, 1_000)).toEqual(claim);
    expect(verifyActionToken(t, SECRET, 2_000)).toBeNull();
    expect(verifyActionToken(t, "x".repeat(40), 1_000)).toBeNull();
    const [d, s] = t.split(".");
    const forged = Buffer.from(JSON.stringify({ ...claim, user: "u2" })).toString("base64url");
    expect(verifyActionToken(`${forged}.${s}`, SECRET, 1_000)).toBeNull();
    expect(verifyActionToken(`${d}.${s}.x`, SECRET, 1_000)).toBeNull();
    expect(() => signActionToken(claim, "short")).toThrow();
  });
});

describe("mailers", () => {
  it("Resend: posts with the idempotency key; errors surface", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ id: "re_1" })) as unknown as typeof fetch;
    const m = new ResendMailer("key", "Alembic <hello@alembic.example>", fetchImpl);
    const e = buildInvitation({ invitationId: "inv2", to: "b@example.org", inviterName: "Ada", courseTitle: "Chem", role: "co-author", acceptUrl: "https://a", expiresAt: new Date() });
    expect(await m.send(e)).toEqual({ id: "re_1" });
    const init = (fetchImpl as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]![1];
    expect((init.headers as Record<string, string>)["idempotency-key"]).toBe("invite:inv2");
    const bad = new ResendMailer("key", "x", (async () => new Response("no", { status: 422 })) as unknown as typeof fetch);
    await expect(bad.send(e)).rejects.toThrow("422");
  });
  it("memory mailer keeps one email per key", async () => {
    const m = new MemoryMailer();
    const e = buildDigest(base([]));
    await m.send(e); await m.send(e);
    expect(m.sent).toHaveLength(1);
  });
});
