import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";

import sonarjs from "./sonarjs";

RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester({
  languageOptions: { parserOptions: { lang: "tsx" } },
});

// Without the wrapper's parser the rule reports nothing, so the invalid cases
// are what prove the wrapper works under oxlint.
tester.run("no-commented-code", sonarjs.rules["no-commented-code"] as never, {
  valid: [
    "// Return early rather than nesting.\nexport const a = 1;",
    "// TODO: split this file by responsibility.\nexport const b = 2;",
  ],
  invalid: [
    {
      code: '// const contents = readFileSync("a.txt", "utf8");\nexport const c = 3;',
      errors: 1,
    },
    {
      code: "export function f(x: number) {\n  // if (x > 1) { return x; }\n  return 0;\n}",
      errors: 1,
    },
  ],
});
