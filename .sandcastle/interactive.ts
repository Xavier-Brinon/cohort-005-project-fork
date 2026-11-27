import { claudeCode, interactive } from "@ai-hero/sandcastle";
import { noSandbox } from "@ai-hero/sandcastle/sandboxes/no-sandbox";
import { agentIdentity } from "./agent-workflows/shared/common.ts";

await interactive({
  agent: claudeCode(agentIdentity().model),
  sandbox: noSandbox(),
  promptFile: "./.sandcastle/prompt.md",
});
