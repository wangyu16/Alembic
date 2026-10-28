"use client";

import { useEffect, useRef } from "react";
import { EmbeddedEditor, type EmbeddedEditorHandle } from "@/lib/orz-editor/embedded-editor";
import type { OrzKind } from "@/lib/orz-editor/kit";
import { browserSupabase } from "@/lib/supabase/browser";
import { mintUidAction, readCourseTextAction, readVersionAction, syncDocAction } from "./actions";

export function DocEditor(p: { kind: OrzKind; packageId: string; path: string; text: string; version: string; isPrivate: boolean }) {
  const ed = useRef<EmbeddedEditorHandle>(null);

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
  );
}
