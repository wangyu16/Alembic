import { EditorRegistry } from "@alembic/editor-kit";
import { ketcherModule } from "./ketcher";
import { plotModule } from "./plot";

/**
 * Alembic's host registry of editor modules (Phase 2). The new shell looks a
 * carrier file's editor up by kind here. Adding a kind = registering its module
 * (same shape the orz-editor / VS Code hosts would use).
 */
export const editorRegistry = new EditorRegistry()
  .register(ketcherModule)
  .register(plotModule);

export { ketcherModule, plotModule };
