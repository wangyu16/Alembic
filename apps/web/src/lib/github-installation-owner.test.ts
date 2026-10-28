import { describe, expect, it } from "vitest";
import { githubUserIdOf, installationOwnership } from "./github-installation-owner";

describe("githubUserIdOf", () => {
  it("reads the GitHub sign-in identity only", () => {
    expect(githubUserIdOf({ identities: [{ provider: "github", identity_data: { sub: "12345" } }] })).toBe("12345");
    expect(githubUserIdOf({ identities: [{ provider: "github", identity_data: { provider_id: 12345 } }] })).toBe("12345");
    expect(githubUserIdOf({ identities: [{ provider: "google", identity_data: { sub: "12345" } }] })).toBeNull();
    expect(githubUserIdOf({ identities: [] })).toBeNull();
    expect(githubUserIdOf({ identities: [{ provider: "github", identity_data: { sub: "12a" } }] })).toBeNull();
    // user_metadata is editable by the user and is never consulted.
    expect(githubUserIdOf({ user_metadata: { provider_id: "12345" } } as never)).toBeNull();
  });
});

describe("installationOwnership", () => {
  it("accepts only the person's own account", () => {
    expect(installationOwnership({ type: "User", id: 12345 }, "12345")).toBe("own");
    expect(installationOwnership({ type: "User", id: 999 }, "12345")).toBe("someone-else");
    expect(installationOwnership({ type: "Organization", id: 12345 }, "12345")).toBe("organization");
    expect(installationOwnership({ type: "User", id: null }, "12345")).toBe("unknown");
    expect(installationOwnership({ type: "User", id: 12345 }, null)).toBe("unknown");
  });
});
