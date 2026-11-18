// Checks "Name a boolean so it reads as a question" (CODING_STANDARDS.md):
// every variable, parameter and destructured name whose type is boolean
// starts with one of PREFIXES. It replaces @typescript-eslint/naming-convention,
// which needs type information that oxlint gives no JS plugin.
//
//   node scripts/check-boolean-names.ts                 fail on a new name or a stale suppression
//   node scripts/check-boolean-names.ts --prune         lower the suppressions to what is left
//   node scripts/check-boolean-names.ts --suppress-all  suppress every name found now
//
// Existing names live in boolean-names-suppressions.json as a count per file,
// the way oxlint-suppressions.json counts lint problems: the count only goes
// down. Run react-router typegen first, or route loader data has no type.
//
// Types come from TypeScript 7's checker, through an API TypeScript marks
// unstable. `typescript7` is pinned to an exact version, and
// check-boolean-names.test.ts fails if an upgrade changes what the API returns.
import { readFileSync, writeFileSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import {
  isBindingElement,
  isIdentifier,
  isParameterDeclaration,
  isVariableDeclaration,
  type Node,
  type SourceFile,
} from "typescript7/unstable/ast";
import {
  API,
  isUnionType,
  type Project,
  type Type,
  TypeFlags,
} from "typescript7/unstable/sync";

export const PREFIXES = [
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
const PREFIXED = new RegExp(`^(${PREFIXES.join("|")})[A-Z]`);

// The directories oxlint ignores, plus generated route types.
const IGNORED_DIRECTORIES = new Set([
  "node_modules",
  "build",
  ".react-router",
  "drizzle",
  "public",
  ".agents",
  ".claude",
  ".sandcastle",
  ".grill",
  "_internal",
]);

export const SUPPRESSIONS_FILE = "boolean-names-suppressions.json";

export interface Finding {
  file: string;
  line: number;
  column: number;
  name: string;
}

/** Suppressed names per file, keyed by the path from the project root. */
export type Suppressions = Record<string, number>;

export interface FileCount {
  file: string;
  found: number;
  allowed: number;
}

function isBooleanType(type: Type | undefined): boolean {
  if (!type) return false;
  if (type.flags & TypeFlags.BooleanLike) return true;
  if (!isUnionType(type)) return false;
  const members = type
    .getTypes()
    .filter(
      (member) => !(member.flags & (TypeFlags.Null | TypeFlags.Undefined))
    );
  return (
    members.length > 0 &&
    members.every((member) => member.flags & TypeFlags.BooleanLike)
  );
}

/** Every name a variable, parameter or destructuring pattern binds. */
function boundNames(file: SourceFile) {
  const names: Node[] = [];
  const visit = (node: Node): void => {
    const isBinder =
      isVariableDeclaration(node) ||
      isParameterDeclaration(node) ||
      isBindingElement(node);
    if (isBinder && node.name && isIdentifier(node.name)) names.push(node.name);
    node.forEachChild(visit);
  };
  file.forEachChild(visit);
  return names;
}

function isChecked(root: string, fileName: string) {
  const path = relative(root, fileName);
  if (path.startsWith("..")) return false;
  return !path.split(sep).some((part) => IGNORED_DIRECTORIES.has(part));
}

function findInFile(project: Project, fileName: string, root: string) {
  const file = project.program.getSourceFile(fileName);
  const names = file ? boundNames(file) : [];
  if (!file || names.length === 0) return { names: 0, findings: [] };
  const starts = names.map((name) => name.getStart(file));
  const types = project.checker.getTypeAtPosition(fileName, starts);
  const findings = names.flatMap((name, index): Finding[] => {
    const text = file.text.slice(starts[index], name.end);
    if (!isBooleanType(types[index]) || PREFIXED.test(text)) return [];
    const { line, character } = file.getLineAndCharacterOfPosition(
      starts[index] ?? 0
    );
    const path = relative(root, fileName);
    return [{ file: path, line: line + 1, column: character + 1, name: text }];
  });
  return { names: names.length, findings };
}

/** What a scan read, and the boolean names without a prefix it found. */
export interface Scan {
  files: number;
  names: number;
  findings: Finding[];
}

/** Reads every checked file in the project at `root`. */
export function scanProject(root: string): Scan {
  const api = new API({ cwd: root });
  try {
    const snapshot = api.updateSnapshot({
      openProject: resolve(root, "tsconfig.json"),
    });
    const [project] = snapshot.getProjects();
    if (!project) throw new Error(`No TypeScript project in ${root}`);
    const fileNames = project.program
      .getSourceFileNames()
      .filter((fileName) => isChecked(root, fileName));
    const results = fileNames.map((name) => findInFile(project, name, root));
    return {
      files: fileNames.length,
      names: results.reduce((total, result) => total + result.names, 0),
      findings: results.flatMap((result) => result.findings),
    };
  } finally {
    api.close();
  }
}

/**
 * Why a scan that read nothing cannot be trusted, or undefined if it read
 * something. A broken tsconfig, a missing typegen or an API change can all
 * read zero names; passing then, or pruning to match, would empty the check.
 */
export function emptyScanError({ files, names }: Scan) {
  if (files === 0) return "read 0 files; is tsconfig.json's include right?";
  if (names === 0)
    return `read ${files} files but 0 names; has the TypeScript 7 API changed?`;
  return undefined;
}

export function countByFile(findings: Finding[]): Suppressions {
  const counts: Suppressions = {};
  for (const { file } of findings) counts[file] = (counts[file] ?? 0) + 1;
  return sortedByFile(counts);
}

/** Files with more names than they suppress, and files with fewer. */
export function compare(findings: Finding[], suppressions: Suppressions) {
  const counts = countByFile(findings);
  const files = [
    ...new Set([...Object.keys(counts), ...Object.keys(suppressions)]),
  ];
  const rows = files.sort().map((file): FileCount => ({
    file,
    found: counts[file] ?? 0,
    allowed: suppressions[file] ?? 0,
  }));
  return {
    over: rows.filter((row) => row.found > row.allowed),
    stale: rows.filter((row) => row.found < row.allowed),
  };
}

/** Suppressions lowered to the names still found; never raised. */
export function prune(findings: Finding[], suppressions: Suppressions) {
  const counts = countByFile(findings);
  const pruned: Suppressions = {};
  for (const [file, allowed] of Object.entries(suppressions)) {
    const kept = Math.min(allowed, counts[file] ?? 0);
    if (kept > 0) pruned[file] = kept;
  }
  return sortedByFile(pruned);
}

function sortedByFile(counts: Suppressions) {
  return Object.fromEntries(
    Object.entries(counts).sort(([a], [b]) => a.localeCompare(b))
  );
}

function readSuppressions(path: string): Suppressions {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Suppressions;
  } catch (error) {
    const isMissing = (error as NodeJS.ErrnoException).code === "ENOENT";
    if (isMissing) return {};
    throw error;
  }
}

function report(findings: Finding[], suppressions: Suppressions) {
  const { over, stale } = compare(findings, suppressions);
  const prefixes = PREFIXES.join(", ");
  for (const { file, found, allowed } of over) {
    console.error(
      `${file}: ${found} boolean names without a prefix, ${allowed} suppressed`
    );
    for (const finding of findings.filter((each) => each.file === file)) {
      console.error(
        `  ${finding.line}:${finding.column}  \`${finding.name}\` is a boolean; start it with ${prefixes}`
      );
    }
  }
  for (const { file, found, allowed } of stale) {
    console.error(
      `${file}: ${allowed} suppressed but ${found} found; run \`npm run lint:prune\``
    );
  }
  return over.length + stale.length === 0;
}

function main() {
  const root = process.cwd();
  const path = resolve(root, SUPPRESSIONS_FILE);
  const flags = process.argv.slice(2);
  const scan = scanProject(root);
  const empty = emptyScanError(scan);
  if (empty) {
    // Checked before any write, so neither --prune nor --suppress-all can
    // wipe the suppressions after a scan that saw nothing.
    console.error(`check-boolean-names: ${empty} Nothing written.`);
    process.exit(1);
  }
  const { findings } = scan;
  const suppressions = readSuppressions(path);
  if (flags.includes("--suppress-all") || flags.includes("--prune")) {
    const written = flags.includes("--prune")
      ? prune(findings, suppressions)
      : countByFile(findings);
    writeFileSync(path, `${JSON.stringify(written, null, 2)}\n`);
    console.error(`Wrote ${SUPPRESSIONS_FILE}`);
    return;
  }
  if (!report(findings, suppressions)) process.exit(1);
}

if (import.meta.main) main();
