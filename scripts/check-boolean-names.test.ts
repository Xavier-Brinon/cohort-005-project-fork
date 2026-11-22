import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  compare,
  type Finding,
  prune,
  scanProject,
  SUPPRESSIONS_FILE,
} from "./check-boolean-names";

// Each line names one binding. The ones the checker must flag hold a boolean
// that only its type shows: none has a boolean annotation or literal.
const SOURCE = `
declare function toggle(): boolean;
declare function maybe(): boolean | undefined;
declare function label(): string;
declare const loose: any;

export const toggled = toggle();
export const maybeOpen = maybe();
export const isToggled = toggle();
export const title = label();
export const anything = loose;

export function Panel({ open }: { open: boolean }) {
  return open;
}

export const flags = [true, false].map((flag) => flag);
`;

const finding = (file: string, name: string): Finding => ({
  file,
  name,
  line: 1,
  column: 1,
});

const SCRIPT = resolve(import.meta.dirname, "check-boolean-names.ts");
const roots: string[] = [];

/** A throwaway TypeScript project holding `files`, by name. */
function makeProject(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), "boolean-names-"));
  roots.push(root);
  const compilerOptions = { strict: true, noEmit: true, lib: ["ES2022"] };
  const tsconfig = { include: ["*.ts"], compilerOptions };
  writeFileSync(join(root, "tsconfig.json"), JSON.stringify(tsconfig));
  for (const [name, source] of Object.entries(files)) {
    writeFileSync(join(root, name), source);
  }
  return root;
}

function runScript(root: string, flags: string[] = []) {
  return spawnSync("node", [SCRIPT, ...flags], { cwd: root, encoding: "utf8" });
}

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

describe("scanProject", () => {
  it("finds booleans from call results, destructured props and callbacks", () => {
    const scan = scanProject(makeProject({ "panel.ts": SOURCE }));
    const names = scan.findings.map((each) => `${each.line}:${each.name}`);
    expect(names).toEqual(["7:toggled", "8:maybeOpen", "13:open", "17:flag"]);
    expect(scan.files).toBe(1);
    expect(scan.names).toBe(9);
  });
});

// A scan that reads nothing would pass, and --prune would then empty the
// suppressions file. Both must fail instead and leave the file as it was.
describe.each([
  ["0 files", {}, "read 0 files"],
  ["0 names", { "empty.ts": "export {};\n" }, "0 names"],
])("a scan that reads %s", (_label, files, message) => {
  const suppressions = `${JSON.stringify({ "panel.ts": 2 }, null, 2)}\n`;
  let root = "";

  beforeAll(() => {
    root = makeProject(files);
    writeFileSync(join(root, SUPPRESSIONS_FILE), suppressions);
  });

  it("exits non-zero", () => {
    const result = runScript(root);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(message);
  });

  it("refuses to prune", () => {
    const result = runScript(root, ["--prune"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Nothing written");
    const written = readFileSync(join(root, SUPPRESSIONS_FILE), "utf8");
    expect(written).toBe(suppressions);
  });
});

describe("compare", () => {
  it("fails a file with more names than it suppresses", () => {
    const findings = [finding("a.ts", "open"), finding("a.ts", "done")];
    expect(compare(findings, { "a.ts": 1 }).over).toEqual([
      { file: "a.ts", found: 2, allowed: 1 },
    ]);
  });

  it("fails a suppression that no longer matches a name", () => {
    expect(compare([], { "a.ts": 1 }).stale).toEqual([
      { file: "a.ts", found: 0, allowed: 1 },
    ]);
  });

  it("passes when every name is suppressed", () => {
    const result = compare([finding("a.ts", "open")], { "a.ts": 1 });
    expect(result).toEqual({ over: [], stale: [] });
  });
});

describe("prune", () => {
  it("lowers counts and drops files with none left, but never raises", () => {
    const findings = [finding("a.ts", "open"), finding("c.ts", "new")];
    expect(prune(findings, { "a.ts": 3, "b.ts": 2 })).toEqual({ "a.ts": 1 });
  });
});
