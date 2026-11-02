/** [RC.11] Reading a whole tree from one archive: real gzip + tar from the system's tar (no fakes). */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readTarGz } from "./tar";

describe("tree archives", () => {
  it("[RC.11] a real .tar.gz gives every regular file by its path under the top folder, long and non-ASCII names included, bytes exact", () => {
    const root = mkdtempSync(join(tmpdir(), "tar-"));
    const top = join(root, "owner-repo-abc123");
    const long = `study-guide/chapters/${"a-very-long-chapter-folder-name-".repeat(4)}gases/notes.md`;
    const files: Record<string, Uint8Array> = {
      "alembic.json": new TextEncoder().encode('{"title":"T"}\n'),
      "assets/fig.png": Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 255]),
      [long]: new TextEncoder().encode("# Long\n"),
      "study-guide/réaction—ΔH.md": new TextEncoder().encode("ΔH = −286 kJ\n"),
    };
    for (const [p, b] of Object.entries(files)) { mkdirSync(join(top, p, ".."), { recursive: true }); writeFileSync(join(top, p), b); }
    const archive = join(root, "a.tar.gz");
    execFileSync("tar", ["-czf", archive, "-C", root, "owner-repo-abc123"], { env: { ...process.env, COPYFILE_DISABLE: "1" } }); // no macOS ._ files
    const got = readTarGz(readFileSync(archive), 10 * 1024 * 1024);
    expect([...got.keys()].sort()).toEqual(Object.keys(files).sort());
    for (const [p, b] of Object.entries(files)) expect(Buffer.from(got.get(p)!).equals(Buffer.from(b))).toBe(true);
    expect(() => readTarGz(readFileSync(archive), 10)).toThrow();
  });
});
