"use client";

import { EmbeddedEditor } from "@/lib/orz-editor/embedded-editor";
import type { OrzKind } from "@/lib/orz-editor/kit";
import { mintUidAction, readCourseTextAction, syncDocAction } from "./actions";

export function DocEditor(p: { kind: OrzKind; packageId: string; path: string; text: string; version: string; isPrivate: boolean }) {
  return (
    <EmbeddedEditor
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
