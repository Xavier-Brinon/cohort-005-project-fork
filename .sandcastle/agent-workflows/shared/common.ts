import * as fs from "node:fs";
import * as path from "node:path";
import * as sandcastle from "@ai-hero/sandcastle";

export interface AgentIdentity {
  readonly provider: string;
  readonly model: string;
}

// Single source of truth for the factory's agent provider and model.
// Workflows may override either via AGENT_PROVIDER / AGENT_MODEL.
export const DEFAULT_AGENT: AgentIdentity = {
  provider: "claude-code",
  model: "claude-opus-5-5",
};

export const agentIdentity = (): AgentIdentity => ({
  provider: process.env.AGENT_PROVIDER || DEFAULT_AGENT.provider,
  model: process.env.AGENT_MODEL || DEFAULT_AGENT.model,
});

export const outputDir = (): string => process.env.OUTPUT_DIR ?? "/tmp";

export const required = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return value;
};

export const writeJson = (filename: string, value: unknown): void => {
  fs.mkdirSync(outputDir(), { recursive: true });
  fs.writeFileSync(
    path.join(outputDir(), filename),
    JSON.stringify(value, null, 2)
  );
};

export const writeAgentJson = (): AgentIdentity => {
  const identity = agentIdentity();
  writeJson("agent.json", identity);
  return identity;
};

// The one agent every factory workflow runs. It authenticates with a Claude
// subscription. To bill the API instead, pass ANTHROPIC_API_KEY here and in
// the workflow's env in place of CLAUDE_CODE_OAUTH_TOKEN.
//
// Sandcastle runs every agent with its permission checks skipped, so it can
// use any tool. Claude Code also accepts `permissionMode: "auto"` here for
// AI-mediated approvals instead (Claude only; other agents don't offer it).
export const claudeAgent = () =>
  sandcastle.claudeCode(agentIdentity().model, {
    env: {
      CLAUDE_CODE_OAUTH_TOKEN: required("CLAUDE_CODE_OAUTH_TOKEN"),
    },
  });

if (import.meta.main) {
  if (process.argv.includes("--write")) {
    writeAgentJson();
  } else {
    console.log(JSON.stringify(agentIdentity()));
  }
}
