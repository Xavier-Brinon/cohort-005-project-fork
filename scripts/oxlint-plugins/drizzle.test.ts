import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";

import drizzle from "./drizzle";

RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester({
  languageOptions: { parserOptions: { lang: "tsx" } },
});

const imported = 'import { sql } from "drizzle-orm";\n';

tester.run("no-dynamic-sql-raw", drizzle.rules["no-dynamic-sql-raw"] as never, {
  valid: [
    // A fixed string is safe in sql.raw.
    `${imported}sql.raw("DESC");`,
    `${imported}sql.raw(\`created_at DESC\`);`,
    // sql`` binds every interpolated value as a parameter.
    `${imported}sql\`title LIKE \${pattern}\`;`,
    // Some other object's raw method.
    `${imported}String.raw\`a\${b}\`; other.raw(text);`,
    // An `sql` that is not drizzle's.
    'import { sql } from "./not-drizzle";\nsql.raw(text);',
  ],
  invalid: [
    {
      code: `${imported}sql.raw(\`(title LIKE '%\${search}%')\`);`,
      errors: [{ messageId: "dynamic" }],
    },
    {
      code: `${imported}sql.raw(text);`,
      errors: [{ messageId: "dynamic" }],
    },
    {
      code: `${imported}sql.raw("title = '" + name + "'");`,
      errors: [{ messageId: "dynamic" }],
    },
    {
      code: `${imported}sql.raw(buildClause());`,
      errors: [{ messageId: "dynamic" }],
    },
    {
      code: 'import { eq, sql as q } from "drizzle-orm";\nq.raw(text);',
      errors: [{ messageId: "dynamic" }],
    },
  ],
});
