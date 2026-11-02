import { describe, expect, it } from "vitest";
import { openForJob, sealForJob } from "./agent-seal";

const k1 = { kid: "a1", secret: new Uint8Array(32).fill(1) };
const k2 = { kid: "a2", secret: new Uint8Array(32).fill(2) };

describe("a job's sealed gateway key (agent-runtime §18)", () => {
  it("[K1.42] opens only for its own job, under the key that sealed it; a tampered or foreign value opens to nothing", () => {
    const s = sealForJob("agk_secret_value", "aj-aaaaaaaaaaaa", k1);
    expect(s).not.toContain("agk_");
    expect(openForJob(s, "aj-aaaaaaaaaaaa", [k2, k1])).toBe("agk_secret_value");
    expect(openForJob(s, "aj-bbbbbbbbbbbb", [k1])).toBeNull();
    expect(openForJob(s, "aj-aaaaaaaaaaaa", [k2])).toBeNull();
    const parts = s.split(".");
    const body = Buffer.from(parts[3]!, "base64url"); body[0] = body[0]! ^ 1;
    expect(openForJob([...parts.slice(0, 3), body.toString("base64url")].join("."), "aj-aaaaaaaaaaaa", [k1])).toBeNull();
    for (const junk of ["", "v1", "v2.a1.x.y", "agk_secret_value"]) expect(openForJob(junk, "aj-aaaaaaaaaaaa", [k1])).toBeNull();
  });
});
