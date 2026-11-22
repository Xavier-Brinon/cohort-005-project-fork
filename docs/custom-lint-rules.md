# Custom lint rules

Lint rules written for this repo, with no ESLint ancestor. Each enforces a
standard from `CODING_STANDARDS.md`, lives in `scripts/oxlint-plugins/`, and
has a RuleTester test beside it.

| Rule                         | File                                | Standard                 | Proof it fails                                                                                                          |
| ---------------------------- | ----------------------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `drizzle/no-dynamic-sql-raw` | `scripts/oxlint-plugins/drizzle.ts` | Parameterise every query | `sql.raw` with the search text interpolated, in `app/routes/courses.tsx`: `drizzle(no-dynamic-sql-raw)` at 58:7, exit 1 |

## `drizzle/no-dynamic-sql-raw`

Allows `sql.raw` with a fixed string and reports any other argument. It finds
`sql` under any local name `drizzle-orm` imported it as. Raw better-sqlite3
calls (`sqlite.exec`, `.prepare`) are outside it; the standard for those stays
in `CODING_STANDARDS.md`.
