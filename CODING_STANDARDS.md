# Coding standards

`npm run check` enforces every mechanical standard; the rule comments in
`.oxlintrc.json`, `.dependency-cruiser.cjs` and `scripts/check-boolean-names.ts`
name the standard each one covers. The standards below have no check yet, so a
reviewer applies them.
Each heading names the check planned to replace it; when that check lands,
delete the rules it covers.
Custom lint rules live in `scripts/oxlint-plugins/<plugin>.ts`, with a
RuleTester test beside it, registered under `jsPlugins` in `.oxlintrc.json`,
and listed in `docs/custom-lint-rules.md`.

## Schema (a test over `app/db/schema.ts` and `drizzle/`)

- **Money is integer cents.** Regional prices came out as
  `19.990000000000002` while they were floats.
- **Timestamps are ISO strings in UTC.** The refund window closed a day early
  for learners in Sydney while they were local times.
- **Every foreign key has an index**, added in the same change as the key.
- **Soft-delete anything a person can point at:** mark it deleted and filter
  it out on read. Deleting a lesson used to take the learners' notes and
  bookmarks with it.
- **A status the code compares against is an enum in `app/db/schema.ts`.**
  Refund status was `"pending"` in four files and `"Pending"` in one.
- **Migrations are forward-only:** change the schema with a new migration,
  leaving applied ones as they are.

## Data access (custom lint rules, plus query-count tests)

- **Related writes share a transaction.** The refund was approved, the
  enrollment was never ended, and the learner kept the course.
- **One query per collection:** a join, or one query with an `IN`, rather
  than a query inside a loop. The notes loader ran one query per lesson,
  forty lessons per course.
- **Paginate anything that grows** with the age of the product. The
  instructor's students page timed out on the first big course.
- **Name the columns you select.**
- **Parameterise every raw driver call** (`sqlite.exec`, `.prepare`): bind
  values, never build the SQL string from them. A quote in somebody's name
  should not take the page down. `drizzle/no-dynamic-sql-raw` already covers
  drizzle's `sql.raw`.

## Routes and input (custom lint rules, plus a test over every route action)

- **A loader or action that cannot continue throws a response**:
  `throw data("Course not found", { status: 404 })`. The route keeps one
  success path.
- **Untrusted input goes through a zod schema** once, at the boundary, before
  it reaches a query. `Number("")` is `0`, and an empty `lessonId` once
  opened lesson 0 for every learner.
- **Every action checks permission itself**; a loader guard covers only the
  loader. For a week anybody signed in could approve a refund by posting to
  `/admin/refunds`.

## Testability (a ban on `Date.now()` and bare `new Date()` in modules)

- **Take the time as an argument.** The refund window tests failed every
  night at midnight while modules read the clock.

## Errors and logging (custom lint rules)

- **Catch the narrowest error you can**, and let the rest propagate.
- **Log the error object**, so the stack survives.
- **Keep secrets out of logs.**

## Code shape (custom lint rules and knip)

- **Hoist a value that depends on nothing in the function body** out of it.
- **State an invariant as `invariant(...)`**, where a comment would only
  describe it.
- **A disable comment says why:**
  `// oxlint-disable-next-line <rule> -- <reason>`.
- **One exported symbol per line.**
- **Export a symbol once a second file uses it.**
- **A parameter every caller must pass has no default.**
- **Copy a value you were handed before changing it**, and return the copy.

## UI (style lint rules, plus axe in end-to-end tests)

- **Colours come from the design tokens:** `text-muted-foreground`, not
  `#6b7280`.
- **Inline styles hold only computed values.** A progress width is fine; a
  colour is not.
- **Every focusable element shows a visible focus state.**
- **Every external link has `rel="noopener noreferrer"`**, with or without
  `target="_blank"`.
- **Heading levels descend in order.**
- **Pair colour with a second signal:** text, an icon, or a shape.

## Repository (hooks, CI and GitHub settings)

- **Markdown and Org files stay under 500 lines.** Lockfiles, migrations,
  generated snapshots and the lint baselines are exempt.
- **Strip trailing whitespace** in files oxfmt skips.
- **The branch name matches the ticket.**
- **A lockfile change matches a `package.json` change.**
- **Commit source; generated files stay out of git.**
- **Squash, and rebase onto the base branch**, before landing.
