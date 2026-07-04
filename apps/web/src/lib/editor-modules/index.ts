import { EditorRegistry } from "@alembic/editor-kit";
import { ketcherModule } from "./ketcher";
import { plotModule } from "./plot";
import { hostedCarrierModule } from "./hosted-carrier";

/**
 * Alembic's host registry of editor modules. The shell looks a carrier
 * file's editor up by kind here. Adding a kind = registering its module
 * (same shape the orz-editor / VS Code hosts would use). The three
 * self-contained document kinds share ONE hosted-carrier module (E1): the
 * file brings its own editor; Alembic hosts it and receives saves.
 */
export const editorRegistry = new EditorRegistry()
  .register(ketcherModule)
  .register(plotModule)
  .register(hostedCarrierModule("md", "Document"))
  .register(hostedCarrierModule("slides", "Slides"))
  .register(hostedCarrierModule("paged", "Paged document"));

export { ketcherModule, plotModule, hostedCarrierModule };
