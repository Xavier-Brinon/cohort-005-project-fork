// Fails when server code reaches the browser bundle: the name of a secret
// environment variable, its value, or a server-only package appears in
// build/client. CODING_STANDARDS.md: "Never put a secret in the client bundle."
// A server-only package in the browser also breaks hydration for the whole page.
// Run after `react-router build`. Prints names only, never values.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const CLIENT_BUILD = "build/client";
const ENV_FILE = ".env";

// Secrets the server reads today, whether or not this machine has them set.
const KNOWN_SECRET_NAMES = [
  "KNOCK_SECRET_API_KEY",
  "KNOCK_SIGNING_KEY",
  "POSTMARK_SERVER_TOKEN",
];

const SECRET_NAME_PATTERN = /SECRET|TOKEN|PASSWORD|PRIVATE|SIGNING|_KEY$/;
const PUBLIC_NAME_PATTERN = /PUBLIC|^VITE_/;

// A string each server-only package carries that survives minification. Found
// by building with the package imported into a component and diffing the
// output; a module path or package name does not survive.
const SERVER_PACKAGE_MARKERS: Record<string, string> = {
  "better-sqlite3": "Cannot open database because the directory does not exist",
  "@knocklabs/node":
    "The KNOCK_API_KEY environment variable is missing or empty",
};

// A value shorter than this matches by accident ("true", "1234").
const MINIMUM_VALUE_LENGTH = 8;

interface Leak {
  file: string;
  name: string;
  kind: "name" | "value";
}

function isSecretName(name: string) {
  return SECRET_NAME_PATTERN.test(name) && !PUBLIC_NAME_PATTERN.test(name);
}

function secretNames() {
  if (existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);
  const fromEnvironment = Object.keys(process.env).filter(isSecretName);
  return [...new Set([...KNOWN_SECRET_NAMES, ...fromEnvironment])];
}

function listFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory() ? listFiles(entryPath) : [entryPath];
  });
}

function leaksIn(file: string, names: string[]): Leak[] {
  const content = readFileSync(file, "utf8");
  return names.flatMap((name): Leak[] => {
    const value = process.env[name];
    const hasValue =
      value !== undefined &&
      value.length >= MINIMUM_VALUE_LENGTH &&
      content.includes(value);
    return [
      ...(content.includes(name)
        ? [{ file, name, kind: "name" as const }]
        : []),
      ...(hasValue ? [{ file, name, kind: "value" as const }] : []),
    ];
  });
}

function serverPackagesIn(file: string) {
  const content = readFileSync(file, "utf8");
  return Object.entries(SERVER_PACKAGE_MARKERS)
    .filter(([, marker]) => content.includes(marker))
    .map(([name]) => ({ file, name }));
}

function main() {
  if (!existsSync(CLIENT_BUILD)) {
    console.error(`No ${CLIENT_BUILD}/. Run \`npm run build\` first.`);
    process.exit(1);
  }

  const names = secretNames();
  const files = listFiles(CLIENT_BUILD);
  const leaks = files.flatMap((file) => leaksIn(file, names));
  const packages = files.flatMap(serverPackagesIn);

  if (leaks.length === 0 && packages.length === 0) {
    console.log(
      `No server secrets or server-only packages in ${CLIENT_BUILD}/ (checked ${names.length} names, ${Object.keys(SERVER_PACKAGE_MARKERS).length} packages).`
    );
    return;
  }

  for (const leak of leaks) {
    console.error(`${leak.file}: the ${leak.kind} of ${leak.name}`);
  }
  for (const found of packages) {
    console.error(`${found.file}: the server-only package ${found.name}`);
  }
  if (leaks.length > 0) {
    console.error(
      `${leaks.length} server secret(s) found in the client bundle.`
    );
  }
  if (packages.length > 0) {
    console.error(
      `${packages.length} server-only package(s) found in the client bundle. Import them from a .server file and call them from a loader or action.`
    );
  }
  process.exit(1);
}

main();
