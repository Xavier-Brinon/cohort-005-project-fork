import { run, claudeCode } from "@ai-hero/sandcastle";
import { podman } from "@ai-hero/sandcastle/sandboxes/podman";
import { agentIdentity } from "./agent-workflows/shared/common.ts";

const [prd, plan] = process.argv.slice(2);

if (!prd || !plan) {
  console.error("Usage: main.ts <prd> <plan>");
  process.exit(1);
}

await run({
  agent: claudeCode(agentIdentity().model),
  sandbox: podman(),
  promptFile: "./.sandcastle/prompt.md",
  maxIterations: 3,
  completionSignal: "<promise>NO MORE TASKS</promise>",
  promptArgs: {
    PRD_LOCATION: prd,
    PLAN_LOCATION: plan,
  },
});
