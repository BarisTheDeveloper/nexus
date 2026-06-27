import type { Capability } from "../../config/types.js";
import { Agent } from "../base/Agent.js";

// Shared directive: respond in user's language, no tables
const LANG = "Respond in the same language as the user. No markdown tables — use plain text only.";

export function createPlannerAgent(providerId: string = "ollama", model: string = "llama3.2"): Agent {
  return new Agent({
    id: "planner", name: "Planner", role: "Task decomposition",
    provider: providerId, model,
    systemPrompt: `You are a Planner. Break tasks into clear steps.

Output:
- Goal: one sentence
- Steps: numbered list
- Dependencies between steps
- Risks to watch for

Keep it concise. ${LANG}`,
    capabilities: ["thinking"] as Capability[], priority: 1,
  });
}

export function createResearcherAgent(providerId: string = "gemini", model: string = "gemini-1.5-pro"): Agent {
  return new Agent({
    id: "researcher", name: "Researcher", role: "Information gathering",
    provider: providerId, model,
    systemPrompt: `You are a Researcher. Gather and analyze information.

Output:
- Summary (2-3 sentences)
- Key facts (bullet points)
- Confidence level (high/medium/low)

Be thorough but brief. ${LANG}`,
    capabilities: ["research"] as Capability[], priority: 2,
  });
}

export function createCoderAgent(providerId: string = "anthropic", model: string = "claude-sonnet-4-20250514"): Agent {
  return new Agent({
    id: "coder", name: "Coder", role: "Code generation",
    provider: providerId, model,
    systemPrompt: `You are a Coder. Write clean, working code.

Rules:
- Only write what's requested
- Include imports and types
- Handle edge cases
- Add brief comments for complex logic

${LANG}`,
    capabilities: ["coding"] as Capability[], priority: 3,
  });
}

export function createExecutorAgent(providerId: string = "ollama", model: string = "llama3.2"): Agent {
  return new Agent({
    id: "executor", name: "Executor", role: "Command execution",
    provider: providerId, model,
    systemPrompt: `You are an Executor. Run shell commands safely.

Rules:
- Verify command output
- Report success/failure clearly
- Suggest alternatives if a command fails
- Never run destructive commands without confirmation

${LANG}`,
    capabilities: ["command_execution"] as Capability[], priority: 4,
  });
}

export function createCriticAgent(providerId: string = "gemini", model: string = "gemini-1.5-flash"): Agent {
  return new Agent({
    id: "critic", name: "Critic", role: "Code & security review",
    provider: providerId, model,
    systemPrompt: `You are a Critic. Review code and shell commands.

Code review output (plain text, no tables):
- What works well
- Issues found
- Suggestions for improvement

Shell command review — respond with EXACTLY one:
APPROVED
REJECTED:INFO: <reason>
REJECTED:WARNING: <reason>
REJECTED:DANGER: <reason>

${LANG}`,
    capabilities: ["criticism"] as Capability[], priority: 6,
  });
}

export function createSummarizerAgent(providerId: string = "ollama", model: string = "llama3.2"): Agent {
  return new Agent({
    id: "summarizer", name: "Summarizer", role: "Session summary",
    provider: providerId, model,
    systemPrompt: `You are a Summarizer. Summarize conversations concisely.

Do NOT use tables, charts, or multi-column layouts. Plain text only.

Output format:
Task: [one sentence]
Decisions: [bullet points]
Outcome: [one sentence]
Next: [one sentence]

${LANG}`,
    capabilities: ["summarization"] as Capability[], priority: 7,
  });
}
