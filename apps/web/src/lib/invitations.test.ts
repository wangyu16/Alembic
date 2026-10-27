import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { invitationHash, isGithubLogin, isInvitationToken, newInvitationToken } from "./invitations";

describe("invitation tokens", () => {
  it("are 32 random bytes, hashed with SHA-256, and recognised by shape", () => {
    const a = newInvitationToken(); const b = newInvitationToken();
    expect(a.token).not.toBe(b.token);
    expect(isInvitationToken(a.token)).toBe(true);
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(invitationHash(a.token)).toBe(a.hash);
    for (const bad of ["", "x", `${a.token}=`, `${a.token.slice(0, 42)}/`, "../" + a.token.slice(3)]) expect(isInvitationToken(bad)).toBe(false);
  });
  it("GitHub names", () => {
    for (const ok of ["a", "wangyu16", "some-one", "A".repeat(39)]) expect(isGithubLogin(ok)).toBe(true);
    for (const bad of ["", "-a", "a-", "a--b", "a b", "a@b", "A".repeat(40), "é"]) expect(isGithubLogin(bad)).toBe(false);
  });
});
