import { defineConfig, configDefaults } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    // Agent worktrees hold full copies of the repo, tests included.
    exclude: [...configDefaults.exclude, ".claude/worktrees/**"],
  },
});
