interface AgentIdentity {
  readonly provider: string;
  readonly model: string;
}

// Single source of truth for the factory's agent provider and model.
// Workflows may override the model via AGENT_MODEL; provider is fixed to the
// Sandcastle claudeCode provider actually invoked by common.ts.
const DEFAULT_AGENT: AgentIdentity = {
  provider: "someone-else",
  model: "claude-opus-5-5",
};

export const agentIdentity = (): AgentIdentity => ({
  provider: DEFAULT_AGENT.provider,
  model: process.env.AGENT_MODEL || DEFAULT_AGENT.model,
});

if (import.meta.main) {
  console.log(JSON.stringify(agentIdentity()));
}
