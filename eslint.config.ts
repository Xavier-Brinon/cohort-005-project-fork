// Every rule here enforces a rule in CODING_STANDARDS.md. Existing violations
// live in eslint-suppressions.json; fix one, then run `npm run lint:prune` to
// shrink the file. New code gets no suppressions.
import eslintComments from "@eslint-community/eslint-plugin-eslint-comments";
import vitest from "@vitest/eslint-plugin";
import { defineConfig, globalIgnores } from "eslint/config";
import importX from "eslint-plugin-import-x";
import jsxA11y from "eslint-plugin-jsx-a11y";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import simpleImportSort from "eslint-plugin-simple-import-sort";
import sonarjs from "eslint-plugin-sonarjs";
import unicorn from "eslint-plugin-unicorn";
import globals from "globals";
import tseslint from "typescript-eslint";

const TEST_FILES = ["**/*.test.ts", "**/*.test.tsx", "app/test/**"];

// Files that a framework or tool loads by their default export, and type
// shims that must mirror a package's default export.
const DEFAULT_EXPORT_FILES = [
  "app/root.tsx",
  "app/routes.ts",
  "app/routes/**",
  "*.config.ts",
  "types/**/*.d.ts",
];

// Scripts are command-line programs: printing is their output.
const CLI_FILES = ["scripts/**", "request-logger/**"];

const BOOLEAN_PREFIXES = [
  "is",
  "has",
  "can",
  "should",
  "was",
  "were",
  "will",
  "did",
  "does",
  "needs",
];

export default defineConfig(
  globalIgnores([
    "build/",
    ".react-router/",
    "drizzle/",
    "public/",
    ".agents/",
    ".claude/",
    ".sandcastle/",
    ".grill/",
    "_internal/",
    ".dependency-cruiser.cjs",
  ]),

  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
        ecmaFeatures: { jsx: true },
      },
      globals: { ...globals.browser, ...globals.node },
    },
    linterOptions: { reportUnusedDisableDirectives: "error" },
    settings: { react: { version: "detect" } },
    plugins: {
      "@typescript-eslint": tseslint.plugin,
      "eslint-comments": eslintComments,
      "import-x": importX,
      "jsx-a11y": jsxA11y,
      react,
      "react-hooks": { rules: reactHooks.rules },
      "simple-import-sort": simpleImportSort,
      sonarjs,
      unicorn,
    },
    rules: {
      // Use `===`, never `==`.
      eqeqeq: ["error", "always"],
      // Use `const` unless you reassign. Never `var`.
      "prefer-const": "error",
      "no-var": "error",
      // Prefer arrow functions for callbacks.
      "prefer-arrow-callback": "error",
      // No `console.log` left in a committed file.
      "no-console": ["error", { allow: ["error"] }],
      // Do not catch an error only to re-throw it unchanged.
      "no-useless-catch": "error",
      // Return early rather than nesting. Do not nest more than three levels.
      "no-else-return": ["error", { allowElseIf: false }],
      "max-depth": ["error", 3],
      // No more than three parameters.
      "max-params": ["error", 3],
      // Keep a function under fifty lines.
      "max-lines-per-function": [
        "error",
        { max: 50, skipBlankLines: true, skipComments: true },
      ],
      // Keep every file under 500 lines.
      "max-lines": ["error", { max: 500 }],

      // Do not write `any`, and do not write `!`.
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-non-null-assertion": "error",
      // Do not write a type that the compiler can infer.
      "@typescript-eslint/no-inferrable-types": "error",
      // `interface` for object shapes; `type` only where an interface cannot
      // express it (unions, mapped, conditional, tuple types).
      "@typescript-eslint/consistent-type-definitions": ["error", "interface"],
      // Throw `Error`, never a string. React Router responses count: a failing
      // loader or action throws `data(...)` or `redirect(...)`.
      "@typescript-eslint/only-throw-error": [
        "error",
        {
          allow: [
            {
              from: "package",
              package: "react-router",
              name: "DataWithResponseInit",
            },
            { from: "lib", name: "Response" },
          ],
        },
      ],
      // Catch the narrowest thing you can.
      "@typescript-eslint/use-unknown-in-catch-callback-variable": "error",
      // Name a boolean so it reads as a question.
      "@typescript-eslint/naming-convention": [
        "error",
        {
          selector: ["variable", "parameter"],
          types: ["boolean"],
          format: ["PascalCase"],
          prefix: BOOLEAN_PREFIXES,
        },
        {
          // A destructured name is chosen by whoever owns the object.
          selector: ["variable", "parameter"],
          modifiers: ["destructured"],
          format: null,
        },
      ],

      // Do not abbreviate. `id` and `url` are the standard's exceptions;
      // `params`, `searchParams`, `props` and `ref` are names React and React
      // Router hand us.
      "unicorn/name-replacements": [
        "error",
        {
          checkFilenames: false,
          allowList: {
            id: true,
            ID: true,
            url: true,
            URL: true,
            params: true,
            searchParams: true,
            setSearchParams: true,
            props: true,
            Props: true,
            ref: true,
          },
        },
      ],

      // Imports are sorted: packages, then aliases, then relative.
      "simple-import-sort/imports": [
        "error",
        { groups: [["^\\u0000"], ["^node:", "^@?\\w"], ["^~/"], ["^\\."]] },
      ],

      // Default exports only for route modules.
      "import-x/no-default-export": "error",

      // Don't leave commented-out code.
      "sonarjs/no-commented-code": "error",

      // A disable comment says why.
      "eslint-comments/require-description": [
        "error",
        { ignore: ["eslint-enable"] },
      ],

      // Every item in a list gets a stable key.
      "react/jsx-key": "error",
      "react/no-array-index-key": "error",
      // Set `rel="noopener noreferrer"` on every external link.
      "react/jsx-no-target-blank": [
        "error",
        { allowReferrer: false, enforceDynamicLinks: "always" },
      ],
      // Escape anything a person typed before you render it as HTML.
      "react/no-danger": "error",

      // Effects declare every value they read.
      "react-hooks/exhaustive-deps": "error",
      // Do not put a side effect in the render path.
      "react-hooks/purity": "error",
      "react-hooks/globals": "error",
      // Never mutate a value you were handed (props, state, hook arguments).
      "react-hooks/immutability": "error",

      // Every image has alt text.
      "jsx-a11y/alt-text": "error",
      // Every input has a label.
      "jsx-a11y/label-has-associated-control": [
        "error",
        {
          labelComponents: ["Label"],
          controlComponents: ["Input", "Textarea", "Select", "Switch"],
          assert: "either",
        },
      ],
      // Do not set a positive `tabIndex`.
      "jsx-a11y/tabindex-no-positive": "error",
      // Use semantic elements.
      "jsx-a11y/no-static-element-interactions": "error",
      "jsx-a11y/click-events-have-key-events": "error",
      // Keep the heading levels in order (content half; order needs a browser).
      "jsx-a11y/heading-has-content": "error",
    },
  },

  {
    files: DEFAULT_EXPORT_FILES,
    rules: { "import-x/no-default-export": "off" },
  },

  {
    files: CLI_FILES,
    rules: { "no-console": "off" },
  },

  {
    files: TEST_FILES,
    plugins: { vitest },
    rules: {
      // Do not commit a skipped test.
      "vitest/no-disabled-tests": "error",
      "vitest/no-focused-tests": "error",
      // `describe` and `it` callbacks group cases; they are not functions
      // doing more than one thing.
      "max-lines-per-function": "off",
    },
  }
);
