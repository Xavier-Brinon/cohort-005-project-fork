// Lets `node` run scripts that import app code, which Vite resolves but node
// does not: the `~/` alias from tsconfig `paths`, and relative imports written
// without their `.ts` extension. Load it before the script:
//   node --import ./scripts/resolve-app-imports.ts scripts/seed.ts
import { registerHooks } from "node:module";

const APP_DIR = new URL("../app/", import.meta.url);
const EXTENSIONS = [".ts", ".tsx", "/index.ts"];

registerHooks({
  resolve(specifier, context, nextResolve) {
    const aliased = specifier.startsWith("~/")
      ? new URL(specifier.slice(2), APP_DIR).href
      : specifier;
    try {
      return nextResolve(aliased, context);
    } catch (error) {
      const isLocal = aliased.startsWith(".") || aliased.startsWith("file:");
      if (!isLocal) throw error;
      for (const extension of EXTENSIONS) {
        try {
          return nextResolve(aliased + extension, context);
        } catch {
          // Try the next extension.
        }
      }
      throw error;
    }
  },
});
