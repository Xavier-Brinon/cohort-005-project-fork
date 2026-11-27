import { run, claudeCode } from "@ai-hero/sandcastle";
import { podman } from "@ai-hero/sandcastle/sandboxes/podman";
import { agentIdentity } from "./agent-workflows/shared/common.ts";

await run({
  agent: claudeCode(agentIdentity().model),
  sandbox: podman(),
  prompt: "Hello, how are you?",
});
