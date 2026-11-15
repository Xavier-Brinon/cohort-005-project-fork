import { run, claudeCode } from "@ai-hero/sandcastle";
import { podman } from "@ai-hero/sandcastle/sandboxes/podman";

await run({
  agent: claudeCode("claude-opus-4-6"),
  sandbox: podman(),
  prompt: "Hello, how are you?",
});
