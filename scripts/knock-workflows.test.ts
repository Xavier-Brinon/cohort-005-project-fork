import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { findDrift, loadLocalWorkflows } from "./knock-workflows";

function workflowsDirectory(files: Record<string, string>): string {
  const directory = mkdtempSync(join(tmpdir(), "knock-workflows-"));
  for (const [path, contents] of Object.entries(files)) {
    mkdirSync(join(directory, path, ".."), { recursive: true });
    writeFileSync(join(directory, path), contents);
  }
  return directory;
}

describe("loadLocalWorkflows", () => {
  it("inlines @ file references the way the Knock CLI does", () => {
    const directory = workflowsDirectory({
      "greeting/workflow.json": JSON.stringify({
        name: "Greeting",
        steps: [
          {
            ref: "in_app_feed_1",
            type: "channel",
            template: { "markdown_body@": "in_app_feed_1/markdown_body.md" },
          },
        ],
      }),
      "greeting/in_app_feed_1/markdown_body.md":
        "Hello **{{ recipient.name }}**\n",
    });

    expect(loadLocalWorkflows(directory)).toEqual([
      {
        key: "greeting",
        workflow: {
          name: "Greeting",
          steps: [
            {
              ref: "in_app_feed_1",
              type: "channel",
              template: { markdown_body: "Hello **{{ recipient.name }}**\n" },
            },
          ],
        },
      },
    ]);
  });

  it("drops the metadata `knock workflow pull` writes, so a pulled workflow shows no drift", () => {
    const directory = workflowsDirectory({
      "greeting/workflow.json": JSON.stringify({
        $schema: "https://schemas.knock.app/cli/workflow.json",
        name: "Greeting",
        steps: [
          {
            ref: "in_app_feed_1",
            type: "channel",
            template: { markdown_body: "Hello" },
            __readonly: { channel_type: "in_app_feed" },
          },
        ],
        __readonly: { key: "greeting", active: true, valid: true },
      }),
    });
    const [{ workflow }] = loadLocalWorkflows(directory);

    expect(workflow).toEqual({
      name: "Greeting",
      steps: [
        {
          ref: "in_app_feed_1",
          type: "channel",
          template: { markdown_body: "Hello" },
        },
      ],
    });
    const remote = {
      key: "greeting",
      active: true,
      valid: true,
      sha: "abc",
      name: "Greeting",
      steps: [
        {
          ref: "in_app_feed_1",
          type: "channel",
          channel_type: "in_app_feed",
          template: { markdown_body: "Hello" },
        },
      ],
    };
    expect(findDrift(workflow, remote)).toEqual([]);
  });

  it("rejects a workflow.json without a name or steps", () => {
    const directory = workflowsDirectory({ "broken/workflow.json": "{}" });
    expect(() => loadLocalWorkflows(directory)).toThrow("broken/workflow.json");
  });

  it("loads every workflow in the repo with its template inlined", () => {
    const workflows = loadLocalWorkflows(
      join(import.meta.dirname, "../.knock/workflows")
    );

    expect(workflows.map(({ key }) => key)).toEqual([
      "lesson-question-posted",
      "lesson-reply-posted",
      "refund-request-decided",
      "refund-request-opened",
    ]);
    expect(JSON.stringify(workflows)).not.toContain("@");
  });
});

describe("findDrift", () => {
  const local = {
    name: "Greeting",
    steps: [{ ref: "in_app_feed_1", template: { markdown_body: "Hello\n" } }],
  };

  it("ignores fields only Knock sets and a trailing newline", () => {
    const remote = {
      name: "Greeting",
      sha: "abc",
      steps: [
        {
          ref: "in_app_feed_1",
          channel_type: "in_app_feed",
          template: { markdown_body: "Hello" },
        },
      ],
    };
    expect(findDrift(local, remote)).toEqual([]);
  });

  it("reports the path of a field changed in Knock", () => {
    const remote = {
      name: "Greeting",
      steps: [{ ref: "in_app_feed_1", template: { markdown_body: "Hi" } }],
    };
    expect(findDrift(local, remote)).toEqual([
      {
        path: "steps[0].template.markdown_body",
        local: "Hello\n",
        remote: "Hi",
      },
    ]);
  });

  it("reports a step added or removed in Knock", () => {
    const remote = { name: "Greeting", steps: [] };
    expect(findDrift(local, remote).map(({ path }) => path)).toEqual(["steps"]);
  });
});
