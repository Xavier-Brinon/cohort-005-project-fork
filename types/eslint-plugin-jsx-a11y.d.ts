// eslint-plugin-jsx-a11y ships no types. It is only loaded by eslint.config.ts.
declare module "eslint-plugin-jsx-a11y" {
  import type { ESLint } from "eslint";

  const plugin: ESLint.Plugin;
  export default plugin;
}
