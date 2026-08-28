import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  assertOwnedStagingPath,
  createStagingUploadUrl,
  deleteStagingObject,
  downloadStagingObject,
  safeStagingName,
  StagingError,
  STAGING_BUCKET,
  type StagingClient,
} from "./staging";

/**
 * Compile-time check: a real Supabase client satisfies the narrow surface
 * these helpers ask for. If supabase-js ever changes those signatures this
 * line fails the build instead of the first caller failing in production.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _clientShape: StagingClient = {} as SupabaseClient;

const USER = "11111111-1111-4111-8111-111111111111";

/** Minimal storage double recording which bucket/paths were touched. */
function stubClient(
  over: Partial<{
    signed: { data: unknown; error: { message: string } | null };
    download: { data: unknown; error: { message: string } | null };
    remove: { data: unknown; error: { message: string } | null };
  }> = {},
) {
  const buckets: string[] = [];
  const removed: string[][] = [];
  const downloaded: string[] = [];
  const signedFor: string[] = [];

  const api = {
    createSignedUploadUrl: vi.fn(async (path: string) => {
      signedFor.push(path);
      return (over.signed ?? {
        data: { signedUrl: `https://example.test/upload/${path}`, token: "tok-1", path },
        error: null,
      }) as never;
    }),
    download: vi.fn(async (path: string) => {
      downloaded.push(path);
      return (over.download ?? {
        data: {
          arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
        },
        error: null,
      }) as never;
    }),
    remove: vi.fn(async (paths: string[]) => {
      removed.push(paths);
      return (over.remove ?? { data: [], error: null }) as never;
    }),
  };

  const client: StagingClient = {
    storage: {
      from(bucket: string) {
        buckets.push(bucket);
        return api;
      },
    },
  };
  return { client, api, buckets, removed, downloaded, signedFor };
}

describe("assertOwnedStagingPath (the pure guard)", () => {
  it("accepts a path under the user's own prefix", () => {
    expect(() => assertOwnedStagingPath(`${USER}/abc-notes.docx`, USER)).not.toThrow();
    expect(() => assertOwnedStagingPath(`${USER}/nested/file.zip`, USER)).not.toThrow();
  });

  it("rejects another user's prefix", () => {
    expect(() => assertOwnedStagingPath("22222222/file.zip", USER)).toThrow(StagingError);
  });

  it("rejects a prefix collision (userId2/… when the user is userId)", () => {
    // A naive `path.startsWith(userId)` accepts every one of these.
    for (const p of [
      `${USER}2/file.zip`,
      `${USER}-other/file.zip`,
      `${USER}extra/file.zip`,
    ]) {
      expect(() => assertOwnedStagingPath(p, USER)).toThrow(StagingError);
    }
  });

  it("rejects traversal in every position", () => {
    for (const p of [
      `${USER}/../other/file.zip`,
      `${USER}/nested/../../other/file.zip`,
      `../${USER}/file.zip`,
      `${USER}/./file.zip`,
      "../../etc/passwd",
      `${USER}/..`,
    ]) {
      expect(() => assertOwnedStagingPath(p, USER)).toThrow(StagingError);
    }
  });

  it("rejects absolute paths, backslashes, encoded segments and empty segments", () => {
    for (const p of [
      `/${USER}/file.zip`,
      `${USER}\\file.zip`,
      `${USER}/%2e%2e/file.zip`,
      `${USER}//file.zip`,
      `${USER}/`,
      "",
    ]) {
      expect(() => assertOwnedStagingPath(p, USER)).toThrow(StagingError);
    }
  });

  it("rejects the bare prefix with no object under it", () => {
    expect(() => assertOwnedStagingPath(USER, USER)).toThrow(StagingError);
  });

  it("rejects everything when there is no signed-in user", () => {
    expect(() => assertOwnedStagingPath(`${USER}/file.zip`, "")).toThrow(StagingError);
  });
});

describe("safeStagingName", () => {
  it("strips directory components and traversal", () => {
    expect(safeStagingName("../../etc/passwd")).toBe("passwd");
    expect(safeStagingName("C:\\Users\\me\\notes.docx")).toBe("notes.docx");
    expect(safeStagingName("..")).toBe("upload");
  });

  it("keeps a readable name and flattens unsafe characters", () => {
    expect(safeStagingName("Week 1 — Thermo (final).pptx")).toBe(
      "Week-1-Thermo-final-.pptx",
    );
    expect(safeStagingName("réactions.pdf")).toBe("reactions.pdf");
  });

  it("never returns an empty, dotted, or over-long name", () => {
    expect(safeStagingName("")).toBe("upload");
    expect(safeStagingName("...")).toBe("upload");
    expect(safeStagingName("###")).toBe("upload");
    expect(safeStagingName(`${"a".repeat(400)}.zip`).length).toBeLessThanOrEqual(100);
  });
});

describe("createStagingUploadUrl", () => {
  it("mints an owner-prefixed, uuid-unique path in the staging bucket", async () => {
    const { client, buckets, signedFor } = stubClient();
    const a = await createStagingUploadUrl(client, USER, "Week 1 notes.docx");
    const b = await createStagingUploadUrl(client, USER, "Week 1 notes.docx");

    expect(buckets).toEqual([STAGING_BUCKET, STAGING_BUCKET]);
    expect(a.path).toMatch(
      new RegExp(`^${USER}/[0-9a-f-]{36}-Week-1-notes\\.docx$`),
    );
    expect(a.path).not.toBe(b.path); // same filename, different object
    expect(signedFor).toEqual([a.path, b.path]);
    expect(a.signedUrl).toContain(a.path);
    expect(a.token).toBe("tok-1");
  });

  it("mints a path that its own guard accepts, even from a hostile filename", async () => {
    const { client } = stubClient();
    const { path } = await createStagingUploadUrl(client, USER, "../../../etc/passwd");
    expect(() => assertOwnedStagingPath(path, USER)).not.toThrow();
    expect(path.split("/")).toHaveLength(2);
  });

  it("refuses without a signed-in user", async () => {
    const { client, api } = stubClient();
    await expect(createStagingUploadUrl(client, "", "notes.docx")).rejects.toBeInstanceOf(
      StagingError,
    );
    expect(api.createSignedUploadUrl).not.toHaveBeenCalled();
  });

  it("surfaces a storage failure as a plain-language StagingError", async () => {
    const { client } = stubClient({
      signed: { data: null, error: { message: "bucket missing" } },
    });
    await expect(
      createStagingUploadUrl(client, USER, "notes.docx"),
    ).rejects.toThrow(/couldn't start that upload/i);
  });
});

describe("downloadStagingObject / deleteStagingObject", () => {
  it("returns the object's bytes", async () => {
    const { client, downloaded } = stubClient();
    const bytes = await downloadStagingObject(client, `${USER}/x-notes.docx`);
    expect(Array.from(bytes)).toEqual([1, 2, 3]);
    expect(downloaded).toEqual([`${USER}/x-notes.docx`]);
  });

  it("turns a download failure into a StagingError", async () => {
    const { client } = stubClient({
      download: { data: null, error: { message: "not found" } },
    });
    await expect(
      downloadStagingObject(client, `${USER}/gone.zip`),
    ).rejects.toBeInstanceOf(StagingError);
  });

  it("removes the object from the staging bucket", async () => {
    const { client, removed, buckets } = stubClient();
    await deleteStagingObject(client, `${USER}/x-notes.docx`);
    expect(removed).toEqual([[`${USER}/x-notes.docx`]]);
    expect(buckets).toEqual([STAGING_BUCKET]);
  });

  it("turns a delete failure into a StagingError", async () => {
    const { client } = stubClient({
      remove: { data: null, error: { message: "denied" } },
    });
    await expect(
      deleteStagingObject(client, `${USER}/x-notes.docx`),
    ).rejects.toBeInstanceOf(StagingError);
  });
});
