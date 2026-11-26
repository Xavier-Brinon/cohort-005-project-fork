import { createRequire, registerHooks } from "node:module";
import { pathToFileURL } from "node:url";

const projectRequire = createRequire(
  new URL("../package.json", import.meta.url)
);
const OVERRIDES = new Map([
  ["typescript", pathToFileURL(projectRequire.resolve("typescript")).href],
  [
    "typescript/package.json",
    pathToFileURL(projectRequire.resolve("typescript/package.json")).href,
  ],
]);

registerHooks({
  resolve(specifier, context, nextResolve) {
    const url = OVERRIDES.get(specifier);
    if (url) return { url, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});
