# Check coverage: before and after the faster tools

What each automated check covers, measured before and after replacing ESLint
with oxlint, Prettier with oxfmt, and TypeScript 5.9's `tsc` with TypeScript 7's.
dependency-cruiser and Vitest are unchanged. Measured 2026-11-18 on an M4 Max
(16 cores), Node 26.13.0.

## Speed

Best of two or three runs, each check alone, then all together.

| Check                       | Before (tool)         | After (tool)              |
| --------------------------- | --------------------- | ------------------------- |
| `typecheck` (typegen + tsc) | 4.2 s (TS 5.9.3)      | 1.0 s (TS 7.0.2)          |
| `tsc` alone                 | 4.0 s                 | 0.6 s                     |
| `lint`                      | 5.5 s (ESLint 10.15)  | 1.1 s (oxlint 1.91.0)     |
| `lint:boolean-names`        | inside ESLint's 5.5 s | 0.7 s (TS 7 checker API)  |
| `format:check`              | 1.05 s (Prettier 3.9) | 0.06 s (oxfmt 0.76.0)     |
| `lint:boundaries`           | 0.8 s                 | 0.8 s (unchanged)         |
| `test`                      | 0.7 s                 | 0.75 s (unchanged)        |
| `check:client-bundle`       | 4.2 s                 | 4.5 s (unchanged)         |
| All but the bundle          | 12.7 s, one by one    | 1.5–1.7 s, in parallel    |
| `check` (pre-push)          | ~17 s, one by one     | 4.5 s, in parallel        |
| `pre-commit` hook           | Prettier + tokens     | 1.5–1.6 s, all but bundle |

The pre-commit hook now runs every check except the client bundle, inside the
3-second budget. Route typegen runs once first; `tsc` and `lint:boolean-names`,
which both read the route types it writes, start when it finishes. The client bundle needs a full `react-router build` (4.2 s on
its own), so it stays on pre-push.

## Coverage

| Check                        | Before                                                          | After                                                                                                                   |
| ---------------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Lint: rules on, per kind     | route 36, module 37, component 37, test 38, script 36           | the same lists, rule for rule (table below); one of them is now `lint:boolean-names`                                    |
| Lint: problems, suppressed   | 0                                                               | 0                                                                                                                       |
| Lint: problems, unsuppressed | 803 in 136 files                                                | 804 in 140 files: oxlint 701, `lint:boolean-names` 103                                                                  |
| Lint: suppressions files     | `eslint-suppressions.json`: 81 files, 238 entries, 803 problems | `oxlint-suppressions.json`: 78 files, 206 entries, 701 problems; `boolean-names-suppressions.json`: 33 files, 103 names |
| TypeScript: files checked    | 1505 (173 outside `node_modules`)                               | 1148 (177 outside `node_modules`)                                                                                       |
| dependency-cruiser           | 143 modules, 715 dependencies, 0 violations, 58 known           | 143 modules, 715 dependencies, 0 violations, 58 known                                                                   |
| Formatter: files checked     | 158 (Prettier)                                                  | 166 (oxfmt)                                                                                                             |
| Vitest                       | 26 files, 524 tests                                             | 29 files, 542 tests                                                                                                     |

Why the numbers moved:

- **Lint problems, 803 to 804.** `lint:boolean-names` finds the same 103
  booleans typescript-eslint found, file for file. oxlint's `immutability`
  reports 1 problem ESLint did not. Every other rule reports the same number of
  problems in the same files. The linted files are 136, less
  `eslint.config.ts` and the jsx-a11y type shim, plus six new scripts.
- **TypeScript files, 1505 to 1148.** `eslint.config.ts` pulled in the type
  declarations of ESLint, typescript-eslint and the plugins; it is gone. The
  sonarjs wrapper pulls in typescript-estree's declarations, and the boolean-name
  check pulls in those of TS 7's API. TS 5.9 and TS 7 read identical files on
  the same tree, apart from each one's own `lib.*.d.ts`. The 173 to 177 is two
  files removed (`eslint.config.ts`, `types/eslint-plugin-jsx-a11y.d.ts`) and
  six added (`scripts/check.ts`, `scripts/check-boolean-names.ts`, the sonarjs
  wrapper, and a test for each).
- **Formatter files, 158 to 166.** oxfmt also formats TOML (`mise.toml`). Three
  Prettier inputs are deleted (`.prettierrc`, `eslint.config.ts`, the jsx-a11y
  shim) and ten new files are added (the two configs,
  `boolean-names-suppressions.json`, the six scripts, and this document).
- **Tests, 524 to 542.** 18 new tests for the sonarjs wrapper, the
  boolean-name check and the check runner.

## ESLint rule to oxlint rule

Every ESLint rule that was on, the rule that replaces it, and the problems each
reported on the whole tree with suppressions off (ESLint then oxlint). "Native"
rules are oxlint's own Rust ports; "JS plugin" rules run the ESLint plugin
inside oxlint. No rule is dropped. One rule moved out of the linter, to a
script that asks TypeScript 7's type checker.

| ESLint rule                                                 | oxlint rule                                             | How                         | Problems  |
| ----------------------------------------------------------- | ------------------------------------------------------- | --------------------------- | --------- |
| `eqeqeq`                                                    | `eslint/eqeqeq`                                         | native                      | 6 / 6     |
| `prefer-const`                                              | `eslint/prefer-const`                                   | native                      | 0 / 0     |
| `no-var`                                                    | `eslint/no-var`                                         | native                      | 0 / 0     |
| `prefer-arrow-callback`                                     | `eslint/prefer-arrow-callback`                          | native                      | 0 / 0     |
| `no-console`                                                | `eslint/no-console`                                     | native                      | 7 / 7     |
| `no-useless-catch`                                          | `eslint/no-useless-catch`                               | native                      | 0 / 0     |
| `no-else-return`                                            | `eslint/no-else-return`                                 | native                      | 0 / 0     |
| `max-depth`                                                 | `eslint/max-depth`                                      | native                      | 14 / 14   |
| `max-params`                                                | `eslint/max-params`                                     | native                      | 43 / 43   |
| `max-lines-per-function`                                    | `eslint/max-lines-per-function`                         | native                      | 149 / 149 |
| `max-lines`                                                 | `eslint/max-lines`                                      | native                      | 20 / 20   |
| `@typescript-eslint/no-explicit-any`                        | `typescript/no-explicit-any`                            | native                      | 47 / 47   |
| `@typescript-eslint/no-non-null-assertion`                  | `typescript/no-non-null-assertion`                      | native                      | 60 / 60   |
| `@typescript-eslint/no-inferrable-types`                    | `typescript/no-inferrable-types`                        | native                      | 0 / 0     |
| `@typescript-eslint/consistent-type-definitions`            | `typescript/consistent-type-definitions`                | native                      | 0 / 0     |
| `@typescript-eslint/only-throw-error`                       | `typescript/only-throw-error`                           | native, type-aware          | 0 / 0     |
| `@typescript-eslint/use-unknown-in-catch-callback-variable` | `typescript/use-unknown-in-catch-callback-variable`     | native, type-aware          | 1 / 1     |
| `@typescript-eslint/naming-convention`                      | `lint:boolean-names` (`scripts/check-boolean-names.ts`) | TS 7 checker, written here  | 103 / 103 |
| `unicorn/name-replacements`                                 | `unicorn-js/name-replacements`                          | JS plugin                   | 327 / 327 |
| `simple-import-sort/imports`                                | `simple-import-sort/imports`                            | JS plugin                   | 0 / 0     |
| `import-x/no-default-export`                                | `import/no-default-export`                              | native                      | 0 / 0     |
| `sonarjs/no-commented-code`                                 | `sonarjs/no-commented-code`                             | JS plugin, wrapped          | 0 / 0     |
| `eslint-comments/require-description`                       | `eslint-comments/require-description`                   | JS plugin                   | 1 / 1     |
| `react/jsx-key`                                             | `react/jsx-key`                                         | native                      | 0 / 0     |
| `react/no-array-index-key`                                  | `react/no-array-index-key`                              | native                      | 12 / 12   |
| `react/jsx-no-target-blank`                                 | `react/jsx-no-target-blank`                             | native                      | 0 / 0     |
| `react/no-danger`                                           | `react/no-danger`                                       | native                      | 6 / 6     |
| `react-hooks/exhaustive-deps`                               | `react/exhaustive-deps`                                 | native                      | 2 / 2     |
| `react-hooks/purity`                                        | `react/purity`                                          | native                      | 0 / 0     |
| `react-hooks/globals`                                       | `react/globals`                                         | native                      | 0 / 0     |
| `react-hooks/immutability`                                  | `react/immutability`                                    | native                      | 0 / 1     |
| `jsx-a11y/alt-text`                                         | `jsx-a11y/alt-text`                                     | native                      | 0 / 0     |
| `jsx-a11y/label-has-associated-control`                     | `jsx-a11y/label-has-associated-control`                 | native                      | 2 / 2     |
| `jsx-a11y/tabindex-no-positive`                             | `jsx-a11y/tabindex-no-positive`                         | native                      | 0 / 0     |
| `jsx-a11y/no-static-element-interactions`                   | `jsx-a11y/no-static-element-interactions`               | native, handlers configured | 2 / 2     |
| `jsx-a11y/click-events-have-key-events`                     | `jsx-a11y/click-events-have-key-events`                 | native                      | 1 / 1     |
| `jsx-a11y/heading-has-content`                              | `jsx-a11y/heading-has-content`                          | native                      | 0 / 0     |
| `vitest/no-disabled-tests` (tests only)                     | `vitest/no-disabled-tests`                              | native                      | 0 / 0     |
| `vitest/no-focused-tests` (tests only)                      | `vitest/no-focused-tests`                               | native                      | 0 / 0     |
| `reportUnusedDisableDirectives: "error"`                    | `options.reportUnusedDisableDirectives: "error"`        | native                      | 0 / 0     |
| bulk suppressions (`--prune-suppressions`)                  | bulk suppressions (`--prune-suppressions`)              | native                      | —         |

The per-file overrides carry over unchanged: default exports allowed in routes,
`root.tsx`, `routes.ts`, root `*.config.ts` and `types/**/*.d.ts`; `console`
allowed in `scripts/` and `request-logger/`; `max-lines-per-function` off and
the two Vitest rules on in test files.

### Where the replacement differs

- **Boolean names are a script, not a lint rule.** `naming-convention` needs
  type information, which oxlint gives no JS plugin, and oxlint has no port of
  it. A syntactic stand-in written as a JS plugin found only 76 of the 103: it
  missed props destructured through a separately declared interface
  (`enrolled`, `trackingEnabled`), loader data, the result of
  `toggleBookmark()`, and the parameter of an `onCheckedChange` callback.
  `scripts/check-boolean-names.ts` instead asks TS 7's checker for the type of
  every variable, parameter and destructured name, one batch per file, and
  reports a boolean (`boolean`, `true`, `false`, or any of them with `null`
  or `undefined`) whose name lacks a prefix. It finds the same 103, file for
  file. It keeps its own suppressions, `boolean-names-suppressions.json`, a
  count per file that works like oxlint's: a new name fails, a stale count
  fails, and `npm run lint:prune` prunes both files. The editor no longer
  shows these as lint problems; the check reports them on commit.
- **`react/immutability` reports one false positive.** In
  `app/components/youtube-player.tsx`, the effect's cleanup sets
  `destroyed = true` on a variable declared inside the same effect. React's
  own rule allows this; oxlint's port does not. It sits in
  `oxlint-suppressions.json`.
- **`sonarjs/no-commented-code` needed a wrapper.** The rule parses each
  comment with `context.languageOptions.parser`, which oxlint does not provide;
  loaded as-is it silently reported nothing. `scripts/oxlint-plugins/sonarjs.ts`
  hands it typescript-estree, the parser it had under ESLint, and its tests
  fail if the rule goes quiet again.
- **`jsx-a11y/no-static-element-interactions`** defaults to fewer handlers in
  oxlint (it missed `onMouseLeave` in `star-rating.tsx`). The config now lists
  ESLint's default handlers, and both report the same 2 problems.
- **Same problems, different line.** oxlint reports `max-lines` at the top of
  the file, and `require-description`, `exhaustive-deps` and
  `max-lines-per-function` sometimes a line or so off ESLint's. The counts per
  file and per rule match.
- **typescript-eslint's `destructured` exemption never applied.** The ESLint
  config exempted destructured names, but its `types: ["boolean"]` selector
  outranked the exemption, so `const { enabled } = data` was reported anyway.
  The new check matches that behaviour, not the comment.

## Proof that each check still fails

Each violation was planted, the check was run, and the plant was reverted; the
check passed again afterwards.

| Plant                                                                                                    | Check                  | Output                                                                                                                                                                       |
| -------------------------------------------------------------------------------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `export const planted   =   { a:1,b:2 }`                                                                 | `format:check` (oxfmt) | `app/lib/planted-format.ts` … `Format issues found in above 1 files.` exit 1                                                                                                 |
| `export const planted: number = "not a number";`                                                         | `typecheck` (TS 7)     | `error TS2322: Type 'string' is not assignable to type 'number'.` exit 1                                                                                                     |
| `import { slugify } from "~/modules/example/lib/impl";` in `app/lib/`                                    | `lint:boundaries`      | `error entrypoint-boundary-from-app: app/lib/planted-boundary.ts → app/modules/example/lib/impl.ts` exit 1                                                                   |
| `return value == null;`                                                                                  | `lint` (oxlint)        | `error eslint(eqeqeq): Expected === and instead saw ==` exit 1                                                                                                               |
| One violation of each JS-plugin rule and a `throw "not ready"`                                           | `lint`                 | `unicorn-js(name-replacements)`, `simple-import-sort(imports)`, `sonarjs(no-commented-code)`, `eslint-comments(require-description)`, `typescript(only-throw-error)`, exit 1 |
| A second `max-params` in `app/lib/utils.ts`, which may keep 1                                            | `lint`                 | both `max-params` problems in the file, `new violations not covered by the suppressions file`, exit 1                                                                        |
| One of two suppressed `eqeqeq` in `request-logger/agents.ts` fixed, not pruned                           | `lint`                 | `There are suppressions that do not occur anymore.` exit 1; after `lint:prune` the count is 1, exit 0                                                                        |
| Unformatted `==` file staged with a clean one                                                            | `.githooks/pre-commit` | `✗ lint (staged)`, `✗ format:check (staged)`, other checks pass, exit 1                                                                                                      |
| `export const bookmarked = toggleBookmark();` and `Badge({ active }: { active: boolean })` in a new file | `lint:boolean-names`   | `app/lib/planted-boolean.ts: 2 boolean names without a prefix, 0 suppressed`, `3:14 \`bookmarked\` is a boolean`, `5:25 \`active\` is a boolean`, exit 1                     |
| `settings.tsx` suppressed at 6, 5 found                                                                  | `lint:boolean-names`   | `app/routes/settings.tsx: 6 suppressed but 5 found; run \`npm run lint:prune\``exit 1;`--prune` from 9 writes 5                                                              |
| `settings.tsx` suppressed at 4, 5 found                                                                  | `lint:boolean-names`   | `5 boolean names without a prefix, 4 suppressed`, all five listed, exit 1                                                                                                    |

## Notes

- **TypeScript 7 runs beside 5.9.** TS 7's package has no compiler API, and
  dependency-cruiser and react-router typegen load `typescript`. So
  `typescript` stays at 5.9.3 for them, and `typescript7` (`npm:typescript@7.0.2`)
  provides the `tsc` that `typecheck` runs, by its path, because both packages
  install a `tsc` binary. TS 7 removed `baseUrl`; `paths` works without it.
- **The boolean-name check uses an unstable API.** TS 7 exposes its checker
  as `typescript7/unstable/sync`. `typescript7` is pinned to exactly 7.0.2,
  and `scripts/check-boolean-names.test.ts` runs the check on a small project
  whose booleans only types reveal, so an upgrade that changes the API fails a test.
- **Prettier is still installed.** `app/components/monaco-markdown-editor.tsx`
  imports `prettier/standalone` at runtime to format Markdown in the editor. Only
  its job as the repo's formatter moved to oxfmt.
- **ESLint is still installed** as a peer dependency of the four ESLint plugins
  oxlint loads. Nothing runs it.
- **oxfmt formats one thing differently.** It breaks a union type that does
  not fit on the line after `=` onto one line per member; Prettier kept it on one
  line. Seven files changed for this.
- **Versions are at least two weeks old**: oxlint 1.91.0, oxfmt 0.76.0 and
  oxlint-tsgolint 7.0.2005 (all 2026-11-03 or earlier), TypeScript 7.0.2
  (2026-07-08).
