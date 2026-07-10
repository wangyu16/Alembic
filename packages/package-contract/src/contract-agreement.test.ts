/**
 * CONTRACT AGREEMENT — the safety net under the dual-mode two-repo check.
 *
 * `assertPathAllowedInEitherContract` (validate.ts) accepts a path if it is
 * valid under the v1 layer contract (layers.ts) OR the v2 space contract
 * (spaces.ts). The commit-plan validator and the package-ops writers now use
 * that OR so the v2-only `current/` space can be committed while v1 packages
 * still validate.
 *
 * That OR is only safe because of ONE property, which is stated nowhere in the
 * code it protects and is invisible to anyone adding a new space:
 *
 *   No directory name is classified PUBLIC under one contract and PRIVATE
 *   under the other.
 *
 * Why it matters: the dual-mode check is fail-closed only as long as this
 * holds. If some future directory were, say, PRIVATE under v2 but PUBLIC under
 * v1, then a private file at that path, committed to the PUBLIC repo, would be
 * REJECTED by v2 but ACCEPTED by v1 — and the OR would let it through. Git
 * history is permanent; that is a silent, irreversible breach of the two-repo
 * invariant (CLAUDE.md architecture rule 1).
 *
 * The property is currently true (v1 `private-instructor` and v2 `private` are
 * each private and single-contract; every shared directory name is public in
 * both). This test PINS it: add a space that disagrees and this fails before it
 * can ship. DO NOT DELETE THIS TEST as "redundant with layers/spaces tests" —
 * those test each contract in isolation; only this one tests that the two
 * contracts AGREE, which is the precondition the OR silently depends on.
 */

import { describe, expect, it } from "vitest";
import {
  LAYER_DIR,
  LAYER_REPO,
  PACKAGE_LAYERS,
  type RepoKind,
} from "./layers";
import { PACKAGE_SPACES, SPACE_DIR, SPACE_REPO } from "./spaces";
import { assertPathAllowedInEitherContract } from "./validate";

/** dir name → repo, as classified by the v1 layer contract. */
function v1DirRepos(): Map<string, RepoKind> {
  const m = new Map<string, RepoKind>();
  for (const layer of PACKAGE_LAYERS) {
    m.set(LAYER_DIR[layer], LAYER_REPO[layer]);
  }
  return m;
}

/** dir name → repo, as classified by the v2 space contract. */
function v2DirRepos(): Map<string, RepoKind> {
  const m = new Map<string, RepoKind>();
  for (const space of PACKAGE_SPACES) {
    m.set(SPACE_DIR[space], SPACE_REPO[space]);
  }
  return m;
}

describe("contract agreement (dual-mode two-repo safety)", () => {
  it("no directory is public in one contract and private in the other", () => {
    const v1 = v1DirRepos();
    const v2 = v2DirRepos();

    const disagreements: string[] = [];
    for (const [dir, v1Repo] of v1) {
      const v2Repo = v2.get(dir);
      if (v2Repo !== undefined && v2Repo !== v1Repo) {
        disagreements.push(
          `"${dir}": v1 layer → ${v1Repo}, v2 space → ${v2Repo}`,
        );
      }
    }

    expect(
      disagreements,
      // If this fires, the dual-mode OR can leak a private file into the public
      // repo. This is a security regression, not a test to "fix" by loosening.
      `Directory repo assignments disagree across the v1/v2 contracts, which ` +
        `breaks the safety precondition of assertPathAllowedInEitherContract:\n` +
        disagreements.join("\n"),
    ).toEqual([]);
  });

  it("has directories that actually appear in both contracts (guard against a vacuous pass)", () => {
    // The agreement check above is only meaningful if the two maps share names.
    // If a refactor ever renamed every dir so the sets became disjoint, the
    // check would pass vacuously — catch that here.
    const v1 = v1DirRepos();
    const v2 = v2DirRepos();
    const shared = [...v1.keys()].filter((dir) => v2.has(dir));
    expect(shared.length).toBeGreaterThan(0);
  });

  describe("known-dangerous regression anchors", () => {
    // Private paths must be rejected for the PUBLIC repo under the dual-mode
    // check — this is the whole point of the two-repo invariant.
    it("rejects private-instructor/ (v1 private) in the public repo", () => {
      expect(() =>
        assertPathAllowedInEitherContract("private-instructor/x.md", "public"),
      ).toThrow();
    });

    it("rejects private/ (v2 private) in the public repo", () => {
      expect(() =>
        assertPathAllowedInEitherContract("private/x.md", "public"),
      ).toThrow();
    });

    // Public locations from each contract must be accepted for the public repo.
    it("accepts materials/ (v1 public) in the public repo", () => {
      expect(() =>
        assertPathAllowedInEitherContract("materials/x.svg", "public"),
      ).not.toThrow();
    });

    it("accepts assets/ (v2 public) in the public repo", () => {
      expect(() =>
        assertPathAllowedInEitherContract("assets/x.svg", "public"),
      ).not.toThrow();
    });

    it("accepts current/ (v2-only public) in the public repo", () => {
      // current/ has NO v1 layer — this is the case the dual-mode upgrade exists
      // to enable. It must be accepted only via the v2 contract.
      expect(() =>
        assertPathAllowedInEitherContract("current/x.pdf", "public"),
      ).not.toThrow();
    });

    it("rejects an unknown top-level directory for BOTH repos", () => {
      expect(() =>
        assertPathAllowedInEitherContract("bogus/x.md", "public"),
      ).toThrow();
      expect(() =>
        assertPathAllowedInEitherContract("bogus/x.md", "private"),
      ).toThrow();
    });

    it("accepts root-allowlisted files in BOTH repos", () => {
      for (const repo of ["public", "private"] as const) {
        expect(() =>
          assertPathAllowedInEitherContract("alembic.json", repo),
        ).not.toThrow();
        expect(() =>
          assertPathAllowedInEitherContract("README.md", repo),
        ).not.toThrow();
      }
    });
  });
});
