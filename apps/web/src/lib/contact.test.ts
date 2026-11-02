import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CONTACT_TOPICS, HONEYPOT_FIELD, checkContact, contactPage, networkHash, sendContact, type SendDeps } from "./contact";
import { MemoryRateStore, consumeRateLimit, rateKey } from "./rate-limit";
import { contactView, groupDigest, replyHref, type ContactRow } from "./contact-digest";

const form = (o: Record<string, string | undefined>) => {
  const base: Record<string, string | undefined> = { name: "Ada Lovelace", email: "ada@school.edu", topic: "using", message: "How do I share a chapter?", ...o };
  return { get: (k: string) => base[k] ?? null };
};

function fakeDeps(over: Partial<SendDeps> = {}) {
  const calls: Array<Record<string, unknown>> = [];
  const deps: SendDeps = {
    limitNetwork: async () => ({ ok: true }),
    limitEmail: async () => ({ ok: true }),
    service: { rpc: async (_fn, args) => { calls.push(args); return { data: "ok", error: null }; } },
    userId: null,
    netHash: "a".repeat(64),
    ...over,
  };
  return { deps, calls };
}

describe("contact form", () => {
  it("[RC.28] checks name, email, topic and message lengths; keeps only a path on this site as the page it came from", () => {
    expect(checkContact(form({})).kind).toBe("ok");
    const bad = checkContact(form({ name: " ", email: "not-an-email", topic: "admin", message: "" }));
    expect(bad.kind === "invalid" && Object.keys(bad.errors).sort()).toEqual(["email", "message", "name", "topic"]);
    const long = checkContact(form({ name: "n".repeat(121), email: `${"e".repeat(195)}@x.edu`, message: "m".repeat(4001) }));
    expect(long.kind === "invalid" && Object.keys(long.errors).sort()).toEqual(["email", "message", "name"]);
    expect(checkContact(form({ message: "m".repeat(4000) })).kind).toBe("ok");
    for (const t of CONTACT_TOPICS) expect(checkContact(form({ topic: t.value })).kind).toBe("ok");
    // Line breaks in the message survive; control characters don't.
    const ok = checkContact(form({ message: "line one\r\nline two\u0000" }));
    expect(ok.kind === "ok" && ok.value.message).toBe("line one\nline two");
    expect(contactPage("/p/abc?x=1")).toBe("/p/abc?x=1");
    for (const bad of ["https://evil.example", "//evil.example", "javascript:alert(1)", "/a b", "/\\evil", "/" + "x".repeat(300), "", undefined, 42]) {
      expect(contactPage(bad)).toBeNull();
    }
  });

  it("[RC.28] a filled honeypot gets the normal confirmation and nothing is counted or kept", async () => {
    let counted = 0;
    const { deps, calls } = fakeDeps({ limitNetwork: async () => (counted++, { ok: true }) });
    expect(await sendContact(form({ [HONEYPOT_FIELD]: "http://spam.example" }), deps)).toEqual({ outcome: "sent" });
    expect(calls).toHaveLength(0);
    expect(counted).toBe(0);
    // A real one is filed with the hashed network only (no address), and the signed-in person when there is one.
    const real = fakeDeps({ userId: "u-1" });
    expect((await sendContact(form({ page: "/guide" }), real.deps)).outcome).toBe("sent");
    expect(real.calls[0]).toEqual({
      p_name: "Ada Lovelace", p_email: "ada@school.edu", p_user: "u-1", p_topic: "using",
      p_message: "How do I share a chapter?", p_page: "/guide", p_net_hash: "a".repeat(64),
    });
    expect(networkHash("203.0.113.9", "s")).toMatch(/^[0-9a-f]{64}$/);
    expect(networkHash("203.0.113.9", "s")).not.toContain("203");
  });

  it("[RC.28] is limited per network (5 an hour) and per email (3 an hour, any capitalisation); past either, nothing is filed", async () => {
    const store = new MemoryRateStore();
    const now = Date.UTC(2026, 9, 29, 10, 5);
    const limitBy = (bucket: "contact" | "contactEmail", subject: () => string) => () =>
      consumeRateLimit(store, bucket, rateKey(bucket, subject(), "secret"), now);
    let ip = "203.0.113.9";
    const { deps, calls } = fakeDeps();
    const d: SendDeps = { ...deps, limitNetwork: limitBy("contact", () => ip), limitEmail: (e) => limitBy("contactEmail", () => `email:${e}`)() };
    const outcomes: string[] = [];
    for (let i = 0; i < 4; i++) outcomes.push((await sendContact(form({ email: i % 2 ? "ADA@school.edu" : "ada@school.edu" }), d)).outcome);
    expect(outcomes).toEqual(["sent", "sent", "sent", "limited"]); // the 4th from the same email
    for (let i = 0; i < 3; i++) outcomes.push((await sendContact(form({ email: `other${i}@school.edu` }), d)).outcome);
    expect(outcomes.slice(4)).toEqual(["sent", "limited", "limited"]); // past 5 tries an hour from one network (refused tries count too)
    ip = "198.51.100.7";
    expect((await sendContact(form({ email: "new@school.edu" }), d)).outcome).toBe("sent");
    expect(calls).toHaveLength(5);
    // The database's own backstop, and a missing or failing database, are said plainly.
    expect((await sendContact(form({}), fakeDeps({ service: { rpc: async () => ({ data: "busy", error: null }) } }).deps)).outcome).toBe("limited");
    expect((await sendContact(form({}), fakeDeps({ service: null }).deps)).outcome).toBe("unavailable");
    expect((await sendContact(form({}), fakeDeps({ service: { rpc: async () => { throw new Error("down"); } } }).deps)).outcome).toBe("unavailable");
  });

  it("is open to visitors who aren't signed in (the sign-in middleware and its page policy don't cover it)", () => {
    const src = readFileSync(resolve(__dirname, "../middleware.ts"), "utf8");
    const matcher = /matcher:\s*\[([^\]]*)\]/.exec(src)![1]!;
    expect(matcher).not.toMatch(/contact|"\/:path\*"|"\/\(\.\*\)"/);
  });
});

describe("contact digest", () => {
  const row = (o: Partial<ContactRow>): ContactRow => ({
    id: Math.random().toString(16), created_at: "2026-10-29T10:00:00Z", name: "A", email: "a@b.co", signed_in: false, topic: "using",
    message: "m", page: null, status: "sorted", category: "bug", urgency: "normal", summary: "s", handled_at: null, handled_note: null, ...o,
  });

  it("groups unsorted first, then the fixed categories, newest first; an unknown stored category counts as Other", () => {
    const g = groupDigest([
      row({ category: "bug", created_at: "2026-10-28T10:00:00Z", summary: "older" }),
      row({ category: "bug", created_at: "2026-10-29T10:00:00Z", summary: "newer" }),
      row({ category: null, status: "new", summary: null }),
      row({ category: "workshop" }),
      row({ category: "mystery" }),
    ]);
    expect(g.map((x) => [x.label, x.rows.length])).toEqual([["Not sorted yet", 1], ["Bug or problem", 2], ["Workshop interest", 1], ["Other", 1]]);
    expect(g[1]!.rows.map((r) => r.summary)).toEqual(["newer", "older"]);
    expect(contactView("spam")).toBe("spam");
    expect(contactView("drop table")).toBe("open");
    expect(replyHref("a+b@x.edu?cc=all@x.edu", "Workshops")).toBe("mailto:a%2Bb@x.edu%3Fcc%3Dall@x.edu?subject=Re%3A%20your%20message%20to%20Alembic%20(Workshops)");
  });
});
