// Fails when a staged file is too big for an agent to read comfortably.
// Estimates tokens cheaply as bytes / 4 and checks the staged content
// (what will be committed), not the working tree.
// Run by .githooks/pre-commit. Pass paths to check them instead of the index.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

export const MAX_TOKENS = 5000;
const BYTES_PER_TOKEN = 4;

// Generated or vendored files: nobody splits these by hand.
const SKIPPED_PATTERNS = [
  /(^|\/)package-lock\.json$/,
  /(^|\/)aube-lock\.yaml$/,
  /(^|\/)skills-lock\.json$/,
  /^drizzle\//,
  /^oxlint-suppressions\.json$/,
  /^\.dependency-cruiser-known-violations\.json$/,
  /^(\.agents|\.claude|\.sandcastle|\.grill|_internal)\//,
];

export interface Oversized {
  file: string;
  tokens: number;
}

export function estimateTokens(content: Buffer) {
  return Math.ceil(content.length / BYTES_PER_TOKEN);
}

export function isSkipped(file: string) {
  return SKIPPED_PATTERNS.some((pattern) => pattern.test(file));
}

// A NUL byte in the first 8 KB is how git itself spots binary files.
function isBinary(content: Buffer) {
  return content.subarray(0, 8000).includes(0);
}

export function findOversized(
  files: string[],
  read: (file: string) => Buffer
): Oversized[] {
  return files
    .filter((file) => !isSkipped(file))
    .flatMap((file) => {
      const content = read(file);
      if (isBinary(content)) return [];
      const tokens = estimateTokens(content);
      return tokens > MAX_TOKENS ? [{ file, tokens }] : [];
    });
}

export function splitGuidance(file: string) {
  const general = [
    "Split by responsibility, not by line count: each new file should have one reason to change.",
    "Keep the public interface small. Callers import what they need from the new files directly; do not add a barrel index.ts that re-exports everything.",
    "Move code, do not rewrite it, so the diff stays reviewable. Then run `npm run check`.",
  ];
  if (/\.test\.tsx?$/.test(file)) {
    return [
      "Split the test file along its top-level `describe` blocks: one file per behaviour under test, named after it (e.g. `refunds.eligibility.test.ts`).",
      "Move shared fixtures and builders into a `*.fixtures.ts` file next to the tests and import them from each new file.",
      ...general,
    ];
  }
  if (file.startsWith("app/routes/")) {
    return [
      "Move the `loader` and `action` logic into a server module (`*.server.ts`, or a deep module under app/modules/; see app/modules/README.md). Keep the route a thin adapter.",
      "Extract large JSX sections into components in app/components/ (or the route's module), one component per file.",
      "Move zod schemas, constants and pure helpers into their own files next to the code that uses them.",
      ...general,
    ];
  }
  if (file.startsWith("app/")) {
    return [
      "Group related functions into a deep module under app/modules/<name>/: entry points at the root, implementation in lib/ (see app/modules/README.md).",
      "Pull pure helpers, types and constants into separate files so the main file holds only the core behaviour.",
      ...general,
    ];
  }
  if (/\.(md|org)$/.test(file)) {
    return [
      "Split the document at its top-level headings into one file per topic, and leave a short index that links to each.",
    ];
  }
  return [
    "Move static data (seed rows, fixtures, tables) into separate data files, and keep the logic that uses it in the original file.",
    "Extract independent steps or helpers into their own files.",
    ...general,
  ];
}

function stagedFiles() {
  const output = execFileSync(
    "git",
    ["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"],
    { encoding: "utf8" }
  );
  return output.split("\0").filter(Boolean);
}

function readStaged(file: string) {
  return execFileSync("git", ["show", `:${file}`], {
    maxBuffer: 64 * 1024 * 1024,
  });
}

function main() {
  const paths = process.argv.slice(2);
  const files = paths.length > 0 ? paths : stagedFiles();
  const read =
    paths.length > 0 ? (file: string) => readFileSync(file) : readStaged;
  const oversized = findOversized(files, read);

  if (oversized.length === 0) return;

  for (const { file, tokens } of oversized) {
    console.error(
      `\n${file}: about ${tokens} tokens (limit ${MAX_TOKENS}, estimated as bytes / ${BYTES_PER_TOKEN}).`
    );
    console.error("How to split it:");
    for (const step of splitGuidance(file)) console.error(`  - ${step}`);
  }
  console.error(
    `\n${oversized.length} file(s) over ${MAX_TOKENS} tokens. Split them before committing; large files are hard for agents to read and edit.`
  );
  process.exit(1);
}

if (import.meta.main) main();
