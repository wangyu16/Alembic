# The foundations loop (workspace v3, step 1: the course contract)

The closed-loop record for step 1 of the foundations work: the package
contract v3, draft 5 (`package-contract-v3.md` §0, §11–§16). Its claims are
K1.10–K1.19 in [docs/claims/v3-foundations.toml](../../claims/v3-foundations.toml),
and the family decisions behind it are FD-09 (Coursewerk owns course content)
and FD-10 (Alembic is a general publishing platform; Coursewerk is its first
content profile).

## Design gate (G0), 2026-10-29

- **Round 2** reviewed draft 3. It passed with fixes: 3 HIGH, 8 MEDIUM and
  6 LOW, all applied in draft 4 (§15).
- **Round 3** was a fresh reviewer on draft 4. It passed with fixes: holes
  in the companion specs, and one new HIGH-MEDIUM (mechanics fields via a
  push). All were applied in draft 5 (§16).

## Built (2026-10-29, Alembic `b9a7afe` to `52dd1e6`, deployed to testing)

| Piece | What | Live check |
|---|---|---|
| 1a | `ContentProfile` + the Coursewerk OER profile, permissions by path class, `delete.private`, `private/README.md` server-only, ratchet scan | — |
| 1b | Course operations: `courseop` rows applied at the head, migration 0063, the add-chapter and draft/ready buttons switched over | a chapter appeared in 4.4 s; Mark ready landed |
| 1c | `setLicense` (owner only, licence files follow), `restoreChapter` | — |
| 1d | Uploads: route, `course_blobs` ledger (0064), blob/move/delete rules, SVG and byte checks, editor figure upload | PNG landed; unsafe SVG, a PNG named `.jpg` and an `.exe` refused |
| 1e | Door C by content | a pushed unsafe SVG and a non-owner licence change were undone within a minute |
| 1f | Publish refuses unsafe SVGs | — |
| 1g | Needs-you both-changed items; Restore the chapter | a deputy restored a removed chapter from Needs you (11 s) |

**Found by the live checks, all fixed:**

- **The course page missed a change that landed between its two reads.** It
  now reads the queue before the head.
- **The worker's store wrapper dropped `blobKnown`, so every live upload was
  refused.** It now binds every method, with a test.
- **The SVG check would have blocked 123 of GenChem's 128 real figures.**
  Their standard DOCTYPE line and embedded raster images are now accepted,
  and the check was tested against all 128 figures.
- **Restore offers missed the deputy.** A deputy is a co-author with
  `deputy_until`, so the offers now go through `course_role_of`.
- **No both-changed item had ever been raised (A10 gap).** Those items are now
  raised for every such file.

## Round 1 audit

Running.
