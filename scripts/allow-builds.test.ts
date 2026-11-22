import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";

// aube only runs the install scripts of packages listed under `allowBuilds`
// in aube-workspace.yaml. A package with a build that is missing from the list
// installs without it: better-sqlite3 then fails at runtime with "Could not
// locate the bindings file". Every package in the lockfile that needs a build
// must be on the list: `true` to run its build, or `false` when its build was
// reviewed and is not needed.
//
// aube-lock.yaml does not record which packages need a build, so this reads
// each locked package's installed package.json from node_modules/.aube.
// Optional packages for another platform are not installed and are skipped.

const ROOT = new URL("../", import.meta.url);
const STORE = new URL("node_modules/.aube/", ROOT);
const BUILD_SCRIPTS = ["preinstall", "install", "postinstall"];

const manifestSchema = z.object({
  scripts: z.record(z.string()).optional(),
});

function readText(path: string): string {
  return readFileSync(new URL(path, ROOT), "utf8");
}

function unquote(key: string): string {
  return key.replace(/^(['"])(.*)\1$/, "$2");
}

// The keys of the lockfile's top-level `packages:` map, e.g. "esbuild@0.25.12".
function lockedPackages(): string[] {
  const keys: string[] = [];
  let isInPackages = false;
  for (const line of readText("aube-lock.yaml").split("\n")) {
    if (/^\S/.test(line)) isInPackages = line === "packages:";
    const match = isInPackages ? /^ {2}(\S.*):$/.exec(line) : null;
    if (match?.[1]) keys.push(unquote(match[1]));
  }
  return keys;
}

function listedBuilds(): Set<string> {
  const listed = new Set<string>();
  let isInAllowBuilds = false;
  for (const line of readText("aube-workspace.yaml").split("\n")) {
    if (/^\S/.test(line)) isInAllowBuilds = line === "allowBuilds:";
    const match = isInAllowBuilds
      ? /^ {2}(\S+):\s*(?:true|false)\b/.exec(line)
      : null;
    if (match?.[1]) listed.add(unquote(match[1]));
  }
  return listed;
}

function splitKey(key: string): { name: string; version: string } {
  const at = key.lastIndexOf("@");
  return { name: key.slice(0, at), version: key.slice(at + 1) };
}

// node_modules/.aube/<name, "/" as "+">@<version>[_<peers>]/node_modules/<name>/
function installedDirectory(
  name: string,
  version: string,
  storeEntries: string[]
): URL | undefined {
  const prefix = `${name.replace("/", "+")}@${version}`;
  const entry = storeEntries.find(
    (entryName) => entryName === prefix || entryName.startsWith(`${prefix}_`)
  );
  return entry ? new URL(`${entry}/node_modules/${name}/`, STORE) : undefined;
}

function needsBuild(directory: URL): boolean {
  const manifest = manifestSchema.parse(
    JSON.parse(readFileSync(new URL("package.json", directory), "utf8"))
  );
  const hasScript = BUILD_SCRIPTS.some((script) => manifest.scripts?.[script]);
  return hasScript || existsSync(new URL("binding.gyp", directory));
}

function packagesThatNeedABuild(): string[] {
  const storeEntries = readdirSync(STORE);
  const names = lockedPackages().flatMap((key) => {
    const { name, version } = splitKey(key);
    const directory = installedDirectory(name, version, storeEntries);
    return directory && needsBuild(directory) ? [name] : [];
  });
  return [...new Set(names)].sort();
}

describe("allowBuilds", () => {
  it("finds the locked packages that need a build", () => {
    expect(packagesThatNeedABuild()).toContain("better-sqlite3");
  });

  it("lists every lockfile package that needs a build", () => {
    const listed = listedBuilds();
    const missing = packagesThatNeedABuild().filter(
      (name) => !listed.has(name)
    );
    expect(missing).toEqual([]);
  });
});
