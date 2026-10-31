"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { EmbeddedEditor, type EmbeddedEditorHandle } from "@/lib/orz-editor/embedded-editor";
import type { OrzKind } from "@/lib/orz-editor/kit";
import { browserSupabase } from "@/lib/supabase/browser";
import { mintUidAction, syncStatusAction, readCourseTextAction, readVersionAction } from "./actions";
import type { SendResult } from "@/lib/device-save/scheduler";

export function DocEditor(p: { kind: OrzKind; packageId: string; path: string; text: string; version: string; renderedAt: string; isPrivate: boolean; nonce?: string; assets?: Array<[string, string]> }) {
  const ed = useRef<EmbeddedEditorHandle>(null);
  const others = usePresence(p.packageId, p.path);
  const assetMap = useMemo(() => new Map(p.assets ?? []), [p.assets]);

  // Live updates (A8): a new version of this document (a co-author's sync, an edit on GitHub) comes in while it is open.
  useEffect(() => {
    const sb = browserSupabase();
    let channel: ReturnType<typeof sb.channel> | null = null;
    let gone = false;
    void (async () => {
      // Subscribe as the signed-in person (RLS: members only), not before the session is loaded.
      const { data } = await sb.auth.getSession();
      if (gone || !data.session) return;
      await sb.realtime.setAuth(data.session.access_token);
      channel = sb
        .channel(`doc:${p.packageId}:${p.path}`)
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "doc_versions", filter: `package_id=eq.${p.packageId}` }, (msg: { new: unknown }) => {
          const row = msg.new as { path?: string; version?: string; commit_sha?: string };
          if (row.path !== p.path || !row.version || !row.commit_sha) return;
          void readVersionAction(p.packageId, p.path, row.commit_sha, row.version).then((text) => {
            if (text !== null) ed.current?.applyRemote(text, row.version!);
          });
        })
        .subscribe((state: string) => {
          if (state !== "SUBSCRIBED" || gone) return;
          // Catch up (audit r5 MEDIUM-2): a version recorded after this page was made, before we listened.
          void sb.from("doc_versions").select("version, commit_sha").eq("package_id", p.packageId).eq("path", p.path)
            .gt("recorded_at", p.renderedAt).order("recorded_at", { ascending: false }).limit(1)
            .then(({ data: rows }: { data: unknown[] | null }) => {
              const row = rows?.[0] as { version: string; commit_sha: string } | undefined;
              if (!row || row.version === p.version) return;
              void readVersionAction(p.packageId, p.path, row.commit_sha, row.version).then((text) => {
                if (text !== null) ed.current?.applyRemote(text, row.version);
              });
            });
        });
    })();
    return () => { gone = true; if (channel) void sb.removeChannel(channel); };
  }, [p.packageId, p.path]);

  return (
    <div className="flex h-full flex-col">
      {others.length ? (
        <div data-testid="presence" className="notice rounded-none border-x-0 border-t-0 px-3 py-1.5 font-medium" role="status">
          Also here: {others.join(", ")}
        </div>
      ) : null}
      <div className="min-h-0 flex-1">
    <EmbeddedEditor
      ref={ed}
      kind={p.kind}
      packageId={p.packageId}
      docPath={p.path}
      text={p.text}
      baseVersion={p.version}
      isPrivate={p.isPrivate}
      {...(p.nonce ? { nonce: p.nonce } : {})}
      assetUrls={assetMap}
      readCourseText={(path) => readCourseTextAction(p.packageId, path)}
      syncStatus={(id) => syncStatusAction(p.packageId, id)}
      mintUid={() => mintUidAction()}
      sync={(a) => sendSync(a)}
    />
      </div>
    </div>
  );
}

/**
 * Who else has this document open (A8 presence): a private Realtime channel
 * only course members may join (migration 0058); each person shares only the
 * name they sign in with. One entry per person, however many tabs.
 */
function usePresence(packageId: string, path: string): string[] {
  const [others, setOthers] = useState<string[]>([]);
  useEffect(() => {
    const sb = browserSupabase();
    let channel: ReturnType<typeof sb.channel> | null = null;
    let gone = false;
    void (async () => {
      const { data } = await sb.auth.getSession();
      if (gone || !data.session) return;
      await sb.realtime.setAuth(data.session.access_token);
      const me = data.session.user.id;
      const meta = data.session.user.user_metadata as { user_name?: unknown; name?: unknown };
      const name = String(meta.user_name ?? meta.name ?? "A co-author").slice(0, 60);
      const ch = sb.channel(`presence:${packageId}:${path}`, { config: { private: true, presence: { key: me } } });
      channel = ch;
      ch.on("presence", { event: "sync" }, () => {
        const state = ch.presenceState() as Record<string, Array<{ name?: unknown }>>;
        const names = Object.entries(state)
          .filter(([key]) => key !== me)
          .map(([, metas]) => String(metas[0]?.name ?? "A co-author").slice(0, 60));
        setOthers([...new Set(names)].sort());
      }).subscribe((status: string) => {
        if (status === "SUBSCRIBED") void ch.track({ name });
      });
    })();
    return () => { gone = true; if (channel) void sb.removeChannel(channel); };
  }, [packageId, path]);
  return others;
}

/**
 * Send to the course through the sync route (RC.13). keepalive lets the browser finish it while the
 * person leaves (it allows bodies up to 64 KB); a larger text is sent normally, which still completes
 * on navigation inside the workspace.
 */
async function sendSync(a: { packageId: string; path: string; text: string; baseVersion: string | null; syncId: string }): Promise<SendResult> {
  const body = JSON.stringify({ path: a.path, text: a.text, baseVersion: a.baseVersion, syncId: a.syncId });
  const url = `/workspace/${encodeURIComponent(a.packageId)}/sync`;
  const send = (keepalive: boolean) => fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body, keepalive });
  try {
    // keepalive allows 64 KB of BYTES (not characters: Greek, arrows and subscripts take more); past it, or if
    // the browser refuses it, a normal request (RC.17).
    const small = new TextEncoder().encode(body).length < 60_000;
    const res = await (small ? send(true).catch(() => send(false)) : send(false));
    const r = (await res.json().catch(() => null)) as SendResult | null;
    return r ?? { ok: false, retryable: true, reason: "Couldn't reach Alembic." };
  } catch {
    return { ok: false, retryable: true, reason: "Couldn't reach Alembic." };
  }
}
