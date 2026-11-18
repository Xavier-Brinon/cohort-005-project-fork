// Runs the automated checks at the same time and reports each one's result.
//
//   node scripts/check.ts           every check but the client bundle (pre-commit budget: 3 s)
//   node scripts/check.ts --full    every check, client bundle included (pre-push)
//   node scripts/check.ts --staged  lint, format and size-check only the staged files (pre-commit)
//
// Most checks are a package.json script, so `node --run <name>` still runs
// one on its own. `typecheck` is split here: route typegen runs once, then
// tsc and the boolean-name check, which both read its types, run side by side.
// A check's output is held back and printed only if it fails.
import { execFileSync, spawn } from "node:child_process";

interface Check {
  name: string;
  command: string;
  args: string[];
  /** The check whose files this one reads; it waits, and fails if that fails. */
  needs?: string;
}

interface Result {
  check: Check;
  exitCode: number;
  output: string;
  seconds: number;
}

const LINTED = /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/;

function stagedFiles() {
  const output = execFileSync(
    "git",
    ["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"],
    { encoding: "utf8" }
  );
  return output.split("\0").filter(Boolean);
}

function script(name: string): Check {
  return { name, command: "node", args: ["--run", name] };
}

export function checksFor(flags: string[], staged: string[]): Check[] {
  const isStaged = flags.includes("--staged");
  const lintTargets = staged.filter((file) => LINTED.test(file));
  const checks: Check[] = [
    {
      name: "typegen",
      command: "node_modules/.bin/react-router",
      args: ["typegen"],
    },
    {
      name: "tsc",
      command: "node",
      args: ["node_modules/typescript7/bin/tsc"],
      needs: "typegen",
    },
    { ...script("lint:boolean-names"), needs: "typegen" },
    script("lint:boundaries"),
    script("test"),
    isStaged
      ? {
          name: "lint (staged)",
          command: "node_modules/.bin/oxlint",
          args: ["--no-error-on-unmatched-pattern", ...lintTargets],
        }
      : script("lint"),
    isStaged
      ? {
          name: "format:check (staged)",
          command: "node_modules/.bin/oxfmt",
          args: ["--check", "--no-error-on-unmatched-pattern", ...staged],
        }
      : script("format:check"),
  ];
  // With nothing staged to lint, oxlint would lint the whole tree instead.
  const skipped = new Set<string>();
  if (isStaged && lintTargets.length === 0) skipped.add("lint (staged)");
  if (isStaged && staged.length === 0) skipped.add("format:check (staged)");
  if (isStaged) {
    checks.push({
      name: "file tokens (staged)",
      command: "node",
      args: ["scripts/check-file-tokens.ts"],
    });
  }
  if (flags.includes("--full")) checks.push(script("check:client-bundle"));
  return checks.filter((check) => !skipped.has(check.name));
}

function spawnCheck(check: Check) {
  const started = performance.now();
  return new Promise<Result>((resolve) => {
    const child = spawn(check.command, check.args, {
      env: { ...process.env, FORCE_COLOR: "1" },
    });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => (output += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (output += chunk.toString()));
    child.on("close", (code) => {
      const seconds = (performance.now() - started) / 1000;
      resolve({ check, exitCode: code ?? 1, output, seconds });
    });
  });
}

/** Starts every check at once, except that one waits for the check it needs. */
function runAll(checks: Check[]) {
  const running = new Map<string, Promise<Result>>();
  for (const check of checks) {
    const needed = check.needs ? running.get(check.needs) : undefined;
    const result = needed
      ? needed.then((first) =>
          first.exitCode === 0
            ? spawnCheck(check)
            : {
                check,
                exitCode: 1,
                output: `skipped: ${first.check.name} failed`,
                seconds: 0,
              }
        )
      : spawnCheck(check);
    running.set(check.name, result);
  }
  return Promise.all(running.values());
}

async function main() {
  const flags = process.argv.slice(2);
  const staged = flags.includes("--staged") ? stagedFiles() : [];
  const started = performance.now();
  const results = await runAll(checksFor(flags, staged));
  const failed = results.filter((result) => result.exitCode !== 0);

  for (const { check, output } of failed) {
    console.error(`\n── ${check.name} failed ──\n${output.trimEnd()}`);
  }
  console.error("");
  for (const { check, exitCode, seconds } of results) {
    const mark = exitCode === 0 ? "✓" : "✗";
    console.error(`${mark} ${check.name.padEnd(24)} ${seconds.toFixed(2)}s`);
  }
  const total = (performance.now() - started) / 1000;
  console.error(`  ${"total (in parallel)".padEnd(24)} ${total.toFixed(2)}s`);
  if (failed.length > 0) process.exit(1);
}

if (import.meta.main) await main();
