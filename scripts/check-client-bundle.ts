// Fails when a server secret reaches the browser bundle: either the name of a
// secret environment variable or its value appears in build/client.
// CODING_STANDARDS.md: "Never put a secret in the client bundle."
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

function main() {
  if (!existsSync(CLIENT_BUILD)) {
    console.error(`No ${CLIENT_BUILD}/. Run \`npm run build\` first.`);
    process.exit(1);
  }

  const names = secretNames();
  const leaks = listFiles(CLIENT_BUILD).flatMap((file) => leaksIn(file, names));

  if (leaks.length === 0) {
    console.log(
      `No server secrets in ${CLIENT_BUILD}/ (checked ${names.length} names).`
    );
    return;
  }

  for (const leak of leaks) {
    console.error(`${leak.file}: the ${leak.kind} of ${leak.name}`);
  }
  console.error(`${leaks.length} server secret(s) found in the client bundle.`);
  process.exit(1);
}

main();
