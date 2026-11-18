// oxlint JS plugin: drizzle/no-dynamic-sql-raw.
//
// Enforces "Parameterise every query" from CODING_STANDARDS.md for drizzle.
// Drizzle's sql`... ${value}` sends `value` as a bound parameter, but
// `sql.raw(text)` pastes `text` into the query as SQL. A fixed string is safe
// there; anything built at run time (a template with `${}`, a variable, a
// call) may carry a quote from the person who typed it, so the rule reports
// it. It follows `sql` under whatever local name `drizzle-orm` imported it as.

/** The parts of the ESTree nodes this rule reads. */
interface Node {
  type: string;
  name?: string;
  computed?: boolean;
  object?: Node;
  property?: Node;
  expressions?: Node[];
  value?: unknown;
}

interface ImportDeclaration extends Node {
  source: { value: unknown };
  specifiers: { type: string; imported?: Node; local: Node }[];
}

interface CallExpression extends Node {
  callee: Node;
  arguments: Node[];
}

interface Context {
  report(problem: { node: Node; messageId: string }): void;
}

/** The local names `sql` from `drizzle-orm` goes by in `import { sql as q }`. */
function sqlImportNames(node: ImportDeclaration) {
  if (node.source.value !== "drizzle-orm") return [];
  return node.specifiers
    .filter(
      (specifier) =>
        specifier.type === "ImportSpecifier" &&
        specifier.imported?.name === "sql"
    )
    .flatMap((specifier) => specifier.local.name ?? []);
}

function isRawOf(callee: Node, sqlNames: Set<string>) {
  return (
    callee.type === "MemberExpression" &&
    callee.computed !== true &&
    callee.object?.type === "Identifier" &&
    sqlNames.has(callee.object.name ?? "") &&
    callee.property?.type === "Identifier" &&
    callee.property.name === "raw"
  );
}

/** A string the source spells out in full, with nothing filled in at run time. */
function isFixedString(node: Node) {
  if (node.type === "Literal") return typeof node.value === "string";
  return node.type === "TemplateLiteral" && node.expressions?.length === 0;
}

const noDynamicSqlRaw = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow sql.raw() with a value built at run time; use sql`` or a query builder so drizzle binds it as a parameter.",
    },
    messages: {
      dynamic:
        "sql.raw() puts its text into the query unescaped. Pass a fixed string, or build the condition with sql`` or a drizzle operator so the value is bound as a parameter.",
    },
    schema: [],
  },
  create: (context: Context) => {
    const sqlNames = new Set<string>();
    return {
      ImportDeclaration(node: ImportDeclaration) {
        for (const name of sqlImportNames(node)) sqlNames.add(name);
      },
      CallExpression(node: CallExpression) {
        if (!isRawOf(node.callee, sqlNames)) return;
        const [text] = node.arguments;
        if (text && isFixedString(text)) return;
        context.report({ node, messageId: "dynamic" });
      },
    };
  },
};

export default {
  meta: { name: "drizzle" },
  rules: { "no-dynamic-sql-raw": noDynamicSqlRaw },
};
