// Checks the Knock workflows in .knock/workflows against Knock itself, through
// the Management API. The Knock CLI pushes and validates; this adds the drift
// check it lacks: does an environment still hold what the repo says?
//
//   node scripts/knock-workflows.ts check [--environment development]
//
// Needs KNOCK_SERVICE_TOKEN. Exits 1 when a workflow is invalid, missing, or
// differs from the repo, or when Knock holds a workflow the repo does not.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import KnockMgmt from "@knocklabs/mgmt";

type WorkflowRequest = KnockMgmt.WorkflowRequest;

export type LocalWorkflow = { key: string; workflow: WorkflowRequest };

export type Drift = { path: string; local: unknown; remote: unknown };

const FILE_REFERENCE_SUFFIX = "@";

// The CLI layout stores long fields in files: `"markdown_body@": "in_app_feed_1/markdown_body.md"`.
// The API wants the contents inline under the key without the `@`.
function inlineFileReferences(value: unknown, workflowDir: string): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => inlineFileReferences(item, workflowDir));
  }
  if (value === null || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, field]) => {
      if (key.endsWith(FILE_REFERENCE_SUFFIX) && typeof field === "string") {
        return [
          key.slice(0, -FILE_REFERENCE_SUFFIX.length),
          readFileSync(join(workflowDir, field), "utf8"),
        ];
      }
      return [key, inlineFileReferences(field, workflowDir)];
    })
  );
}

export function loadLocalWorkflows(workflowsDir: string): LocalWorkflow[] {
  return readdirSync(workflowsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .map((key) => {
      const workflowDir = join(workflowsDir, key);
      const raw: unknown = JSON.parse(
        readFileSync(join(workflowDir, "workflow.json"), "utf8")
      );
      const workflow = inlineFileReferences(raw, workflowDir);
      if (!isWorkflowRequest(workflow)) {
        throw new Error(`${key}/workflow.json needs a name and a steps array`);
      }
      return { key, workflow };
    });
}

function isWorkflowRequest(value: unknown): value is WorkflowRequest {
  return (
    typeof value === "object" &&
    value !== null &&
    "name" in value &&
    typeof value.name === "string" &&
    "steps" in value &&
    Array.isArray(value.steps)
  );
}

// Every field the repo sets must match Knock. Fields only Knock sets (sha,
// timestamps, defaults such as channel_type) are not drift. Trailing
// whitespace is ignored: an editor's final newline is not a change.
export function findDrift(local: unknown, remote: unknown, path = ""): Drift[] {
  if (Array.isArray(local)) {
    if (!Array.isArray(remote) || remote.length !== local.length) {
      return [{ path, local, remote }];
    }
    return local.flatMap((item, index) =>
      findDrift(item, remote[index], `${path}[${index}]`)
    );
  }
  if (local !== null && typeof local === "object") {
    if (remote === null || typeof remote !== "object") {
      return [{ path, local, remote }];
    }
    const remoteFields = new Map(Object.entries(remote));
    return Object.entries(local).flatMap(([key, field]) =>
      findDrift(field, remoteFields.get(key), path ? `${path}.${key}` : key)
    );
  }
  if (typeof local === "string" && typeof remote === "string") {
    return local.trimEnd() === remote.trimEnd()
      ? []
      : [{ path, local, remote }];
  }
  return Object.is(local, remote) ? [] : [{ path, local, remote }];
}

function readEnvironment(args: string[]): string {
  const flag = args.indexOf("--environment");
  return flag === -1 ? "development" : (args[flag + 1] ?? "development");
}

async function check(environment: string): Promise<boolean> {
  const client = new KnockMgmt({ maxRetries: 1 });
  const local = loadLocalWorkflows(
    join(import.meta.dirname, "../.knock/workflows")
  );
  let ok = true;
  const fail = (message: string) => {
    ok = false;
    console.error(`✗ ${message}`);
  };

  for (const { key, workflow } of local) {
    // Knock validates in Development only, whatever environment is checked.
    await client.workflows
      .validate(key, { workflow, environment: "development" })
      .catch((error: unknown) => fail(`${key}: invalid. ${String(error)}`));

    const remote = await client.workflows
      .retrieve(key, {
        environment,
        hide_uncommitted_changes: environment !== "development",
      })
      .catch((error: unknown) => {
        if (error instanceof KnockMgmt.NotFoundError) return undefined;
        throw error;
      });
    if (!remote) {
      fail(`${key}: missing in ${environment}`);
      continue;
    }

    const drift = findDrift(workflow, remote);
    for (const { path } of drift)
      fail(`${key}: ${path} differs in ${environment}`);
    if (drift.length === 0) console.log(`✓ ${key}`);
  }

  const localKeys = new Set(local.map(({ key }) => key));
  for await (const remote of client.workflows.list({ environment })) {
    if (!localKeys.has(remote.key)) {
      fail(`${remote.key}: in ${environment} but not in .knock/workflows`);
    }
  }
  return ok;
}

if (import.meta.main) {
  const [command, ...args] = process.argv.slice(2);
  if (command !== "check") {
    console.error(
      "Usage: node scripts/knock-workflows.ts check [--environment <slug>]"
    );
    process.exit(2);
  }
  if (!process.env.KNOCK_SERVICE_TOKEN) {
    console.error(
      "KNOCK_SERVICE_TOKEN is not set. Create one in the Knock dashboard (Settings, Service tokens)."
    );
    process.exit(2);
  }
  const environment = readEnvironment(args);
  console.log(`Checking .knock/workflows against Knock ${environment}`);
  process.exit((await check(environment)) ? 0 : 1);
}
