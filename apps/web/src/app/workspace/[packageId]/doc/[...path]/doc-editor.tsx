"use client";

import { useEffect, useRef, useState } from "react";
import { EmbeddedEditor, type EmbeddedEditorHandle } from "@/lib/orz-editor/embedded-editor";
import type { OrzKind } from "@/lib/orz-editor/kit";
import { browserSupabase } from "@/lib/supabase/browser";
import { mintUidAction, readCourseTextAction, readVersionAction, syncDocAction } from "./actions";

export function DocEditor(p: { kind: OrzKind; packageId: string; path: string; text: string; version: string; isPrivate: boolean }) {
  const ed = useRef<EmbeddedEditorHandle>(null);
  const others = usePresence(p.packageId, p.path);

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
        .subscribe();
    })();
    return () => { gone = true; if (channel) void sb.removeChannel(channel); };
  }, [p.packageId, p.path]);

  return (
    <div className="flex h-full flex-col">
      {others.length ? (
        <div data-testid="presence" className="border-b bg-sky-50 px-3 py-1 text-xs">
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
      readCourseText={(path) => readCourseTextAction(p.packageId, path)}
      mintUid={() => mintUidAction()}
      sync={(a) => syncDocAction(a)}
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
