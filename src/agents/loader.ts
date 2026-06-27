import { Agent } from "./base/Agent.js";
import { loadCustomAgents } from "../config/ConfigLoader.js";
import type { AgentConfig } from "../config/types.js";
import {
  createPlannerAgent,
  createCoderAgent,
  createExecutorAgent,
  createResearcherAgent,
  createCriticAgent,
  createSummarizerAgent,
} from "./builtin/index.js";

export type AgentRegistry = Map<string, Agent>;

const BUILTIN_AGENT_IDS = new Set([
  "planner", "coder", "executor", "researcher", "critic", "summarizer",
]);

export function createBuiltinAgents(): AgentRegistry {
  const agents: AgentRegistry = new Map();

  const planner = createPlannerAgent();
  const coder = createCoderAgent();
  const executor = createExecutorAgent();
  const researcher = createResearcherAgent();
  const critic = createCriticAgent();
  const summarizer = createSummarizerAgent();

  agents.set(planner.id, planner);
  agents.set(coder.id, coder);
  agents.set(executor.id, executor);
  agents.set(researcher.id, researcher);
  agents.set(critic.id, critic);
  agents.set(summarizer.id, summarizer);

  return agents;
}

export function loadAllAgents(): AgentRegistry {
  const agents = createBuiltinAgents();
  const customConfigs = loadCustomAgents();

  for (const config of customConfigs) {
    if (BUILTIN_AGENT_IDS.has(config.id)) {
      console.warn(`[Nexus] Warning: Custom agent "${config.id}" overrides built-in agent`);
    }
    const agent = new Agent(config);
    agents.set(agent.id, agent);
  }

  return agents;
}

export function getAgentsSortedByPriority(agents: AgentRegistry): Agent[] {
  return Array.from(agents.values()).sort((a, b) => a.priority - b.priority);
}
