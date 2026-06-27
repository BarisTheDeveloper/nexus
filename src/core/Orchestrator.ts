import { EventEmitter } from "node:events";
import type { AgentConfig, AgentMessage, SessionStatus } from "../config/types.js";
import { Agent } from "../agents/base/Agent.js";
import type { AgentToolResult } from "../agents/base/Agent.js";
import { loadAllAgents, getAgentsSortedByPriority } from "../agents/loader.js";
import { createProvider } from "../providers/index.js";
import { loadConfig, addProviderToConfig, removeProviderFromConfig, loadCustomAgents, saveCustomAgents } from "../config/ConfigLoader.js";
import type { LLMProvider, ToolDefinition, ToolCall } from "../providers/base/LLMProvider.js";
import { ToolRegistry } from "../tools/index.js";
import type { ToolResult } from "../config/types.js";
import { NexusMemory } from "../memory/ChromaMemory.js";
import { SessionManager } from "./SessionManager.js";
import { ProfileManager } from "../memory/ProfileManager.js";
import { EmbeddingService } from "../memory/EmbeddingService.js";
import { AgentWorkspace } from "./AgentWorkspace.js";
import { MCPRegistry } from "./MCPRegistry.js";
import { CostTracker } from "./CostTracker.js";
import { BackgroundAgent } from "./BackgroundAgent.js";
import { GitHubAgent } from "./GitHubAgent.js";

export interface OrchestratorEvents {
  "agent-speaking": (agentId: string, content: string) => void;
  "agent-streaming": (agentId: string, chunk: string) => void;
  "agent-listening": (agentId: string) => void;
  "agent-interjection": (agentId: string, content: string) => void;
  "status-change": (status: SessionStatus) => void;
  "error": (error: Error) => void;
  "final-output": (output: string) => void;
  "tool-executing": (agentId: string, toolName: string) => void;
  "tool-result": (agentId: string, toolName: string, success: boolean) => void;
}

export interface DoctorReport {
  providers: Array<{ id: string; status: "ok" | "error" | "missing_key"; message: string }>;
  agents: Array<{ id: string; hasProvider: boolean; toolCount: number }>;
  memory: { status: "ok" | "error"; message: string; entryCount: number };
  embedding: { status: "ok" | "error"; ollamaAvailable: boolean; message: string };
  tools: Array<{ name: string; registered: boolean }>;
  sessions: { active: string | null; total: number };
  overall: "healthy" | "degraded" | "unhealthy";
}

export class Orchestrator extends EventEmitter {
  private agents: Map<string, Agent> = new Map();
  private providers: Map<string, LLMProvider> = new Map();
  private panelHistory: AgentMessage[] = [];
  private status: SessionStatus = "idle";
  private toolRegistry: ToolRegistry;
  private orchestratorAgent: Agent | null = null;
  private memory: NexusMemory;
  private sessionManager: SessionManager;
  private profileManager: ProfileManager;
  private embeddingService: EmbeddingService;
  private workspace: AgentWorkspace;
  private permissionLevel: "all" | "safe" | "ask" = "ask";
  private mcpRegistry: MCPRegistry;
  private costTracker: CostTracker;
  private backgroundAgent: BackgroundAgent;
  private githubAgent: GitHubAgent;

  constructor() {
    super();
    this.embeddingService = new EmbeddingService();
    this.githubAgent = new GitHubAgent();
    this.backgroundAgent = new BackgroundAgent();
    this.toolRegistry = new ToolRegistry(this.githubAgent, this.backgroundAgent);
    this.memory = new NexusMemory();
    this.sessionManager = new SessionManager();
    this.sessionManager.setMemory(this.memory);  // wire persistence
    this.profileManager = new ProfileManager();
    this.workspace = new AgentWorkspace();
    this.mcpRegistry = new MCPRegistry();
    this.costTracker = new CostTracker();
    this.initialize();
  }

  getMemory(): NexusMemory {
    return this.memory;
  }

  getProfileManager(): ProfileManager {
    return this.profileManager;
  }

  getToolRegistry(): ToolRegistry {
    return this.toolRegistry;
  }

  getEmbeddingService(): EmbeddingService {
    return this.embeddingService;
  }

  getProvidersInfo(): Array<{ id: string; name: string }> {
    return Array.from(this.providers.entries()).map(([id, provider]) => ({
      id,
      name: provider.name,
    }));
  }

  setAgentModel(agentId: string, model: string): boolean {
    const agent = this.agents.get(agentId);
    if (!agent) return false;
    agent.config.model = model;
    return true;
  }

  exportSession(): { json: string; markdown: string } {
    const session = this.sessionManager.getActiveSession();
    const history = session?.messages ?? this.panelHistory;

    const json = JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        messageCount: history.length,
        messages: history.map((m) => ({
          agent: m.agentId,
          role: m.role,
          content: m.content,
          timestamp: new Date(m.timestamp).toISOString(),
        })),
      },
      null,
      2,
    );

    const markdown = `# Nexus Session Export\n\nExported: ${new Date().toISOString()}\nMessages: ${history.length}\n\n---\n\n${history
      .map(
        (m) =>
          `### [${m.agentId}] (${m.role})\n${new Date(m.timestamp).toLocaleString()}\n\n${m.content}\n\n---\n`,
      )
      .join("\n")}`;

    return { json, markdown };
  }

  async processWithSpecificAgents(
    userMessage: string,
    agentIds: string[],
  ): Promise<string> {
    this.setStatus("analyzing");
    this.panelHistory = [];
    const session = this.sessionManager.createSession();

    try {
      let memoryContext = "";
      try {
        const memoryResults = await this.memory.query(userMessage, 3);
        if (memoryResults.length > 0) {
          memoryContext = "\n[RELEVANT MEMORY]\n" +
            memoryResults.map((r) => `[${r.type}] ${r.content.slice(0, 300)}`).join("\n");
        }
      } catch {
        // Memory query is best-effort
      }

      this.setStatus("running");
      const allAgents = getAgentsSortedByPriority(this.agents);

      for (const agent of allAgents) {
        if (agentIds.includes(agent.id)) {
          this.emit("agent-speaking", agent.id, "Generating response...");
          this.sessionManager.setCurrentSpeaker(agent.id);
          try {
            const augmentedMessage = memoryContext
              ? `${userMessage}\n\n${memoryContext}`
              : userMessage;
            const response = await agent.think(augmentedMessage, this.panelHistory, {
              model: agent.config.model,
            });
            const msg: AgentMessage = {
              agentId: agent.id,
              role: "speaker",
              content: response,
              timestamp: Date.now(),
            };
            this.panelHistory.push(msg);
            this.sessionManager.addMessage(msg);
            this.emit("agent-speaking", agent.id, response);
          } catch (error) {
            const errorMsg = `[Error] ${error instanceof Error ? error.message : String(error)}`;
            this.emit("error", error instanceof Error ? error : new Error(String(error)));
            this.panelHistory.push({
              agentId: agent.id,
              role: "speaker",
              content: errorMsg,
              timestamp: Date.now(),
            });
          }
        }
      }

      const conversation = this.panelHistory
        .map((m) => `[${m.agentId}]: ${m.content}`)
        .join("\n\n");

      this.setStatus("complete");
      this.sessionManager.endSession();

      await this.memory.store({
        id: session.id,
        type: "episodic",
        content: `User: ${userMessage}\nAgents: ${agentIds.join(", ")}\nResponse: ${conversation.slice(0, 500)}`,
        metadata: { agentIds, mode: "direct" },
        timestamp: Date.now(),
      });

      this.emit("final-output", conversation);
      return conversation;
    } catch (error) {
      this.setStatus("error");
      this.sessionManager.setStatus("error");
      this.emit("error", error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  private initialize(): void {
    const config = loadConfig();

    // Initialize providers
    for (const providerConfig of config.providers) {
      try {
        const provider = createProvider(providerConfig);
        this.providers.set(providerConfig.id, provider);
      } catch (error) {
        console.warn(`[Nexus] Failed to initialize provider "${providerConfig.id}":`, error);
      }
    }

    // Load agents and assign providers + tools
    const agentRegistry = loadAllAgents();
    const toolDefs = this.getToolDefinitions();
    const fallbackProvider = this.providers.values().next().value; // first available

    for (const [id, agent] of agentRegistry) {
      const providerId = agent.config.provider;
      let provider = this.providers.get(providerId);
      // Fallback: if configured provider isn't available, use default
      if (!provider && fallbackProvider) {
        provider = fallbackProvider;
        agent.config.provider = fallbackProvider.id;
        agent.config.model = config.defaultModel ?? "deepseek-chat";
      }
      if (provider) {
        agent.setProvider(provider);
      }
      // Give tools to capable agents
      if (agent.capabilities.includes("command_execution") ||
          agent.capabilities.includes("coding") ||
          agent.capabilities.includes("research")) {
        agent.setTools(toolDefs);
      }
      this.agents.set(id, agent);
    }

    // Create orchestrator agent (uses the first available provider)
    const defaultProvider = this.providers.values().next().value;
    if (defaultProvider) {
      this.orchestratorAgent = new Agent({
        id: "orchestrator",
        name: "Orchestrator",
        role: "Task analysis and agent coordination",
        provider: defaultProvider.id,
        model: config.defaultModel ?? "claude-sonnet-4-20250514",
        systemPrompt: `You are the Orchestrator agent. Your role is to:
1. Analyze user requests and determine which specialist agents are needed
2. Coordinate the panel discussion between multiple AI agents
3. Synthesize final responses from agent contributions

When analyzing a task, consider:
- What type of expertise is needed? (coding, research, planning, etc.)
- Which agents should be the primary speaker?
- Which agents should listen and potentially interject?
- How to merge multiple agent contributions into a coherent response.`,
        capabilities: ["thinking"],
        priority: 0,
      });
      this.orchestratorAgent.setProvider(defaultProvider);
    }

    // Wire up Critic for shell command approval
    const criticAgent = this.agents.get("critic");
    this.toolRegistry.setCriticEnabled(config.criticApproval ?? true);
    if (criticAgent?.provider) {
      this.toolRegistry.setCommandReviewer((command: string) =>
        criticAgent.reviewShellCommand(command),
      );
    }
  }

  /**
   * Build tool definitions from the tool registry for agent use.
   */
  private getToolDefinitions(): ToolDefinition[] {
    const tools = this.toolRegistry.list();
    return tools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: {
        type: "object",
        properties: this.getToolParameters(t.name),
        required: this.getToolRequired(t.name),
      },
    }));
  }

  private getToolParameters(toolName: string): Record<string, unknown> {
    switch (toolName) {
      case "shell_exec":
        return {
          command: { type: "string", description: "Shell command to execute" },
        };
      case "file_tool":
        return {
          action: {
            type: "string",
            enum: ["read", "write", "list"],
            description: "File operation: read, write, or list",
          },
          path: { type: "string", description: "File path" },
          content: { type: "string", description: "Content to write (only for write action)" },
        };
      case "web_search":
        return {
          query: { type: "string", description: "Search query" },
        };
      case "github_create_pr":
        return {
          title: { type: "string", description: "PR title" },
          body: { type: "string", description: "PR description" },
        };
      case "github_create_issue":
        return {
          title: { type: "string", description: "Issue title" },
          body: { type: "string", description: "Issue body" },
          labels: { type: "string", description: "Comma-separated labels" },
          assignees: { type: "string", description: "Comma-separated usernames" },
        };
      case "github_clone":
        return {
          url: { type: "string", description: "GitHub repo URL" },
          directory: { type: "string", description: "Target directory (optional)" },
        };
      case "github_list_issues":
        return {
          limit: { type: "number", description: "Max issues to list (default 10)" },
        };
      case "background_run":
        return {
          command: { type: "string", description: "Command to run in background" },
        };
      default:
        return {};
    }
  }

  private getToolRequired(toolName: string): string[] {
    switch (toolName) {
      case "shell_exec": return ["command"];
      case "file_tool": return ["action", "path"];
      case "web_search": return ["query"];
      case "github_create_pr": return ["title"];
      case "github_create_issue": return ["title"];
      case "github_clone": return ["url"];
      case "github_list_issues": return [];
      case "background_run": return ["command"];
      default: return [];
    }
  }

  /**
   * Execute a tool call from an agent. Uses the tool registry directly.
   */
  async executeAgentTool(agentId: string, call: ToolCall): Promise<AgentToolResult> {
    this.emit("tool-executing", agentId, call.name);
    const tool = this.toolRegistry.get(call.name);
    if (!tool) {
      this.emit("tool-result", agentId, call.name, false);
      return {
        toolCallId: call.id,
        name: call.name,
        result: `Tool "${call.name}" not found`,
        success: false,
      };
    }

    try {
      const result = await tool.execute(call.arguments);
      this.emit("tool-result", agentId, call.name, result.success);
      return {
        toolCallId: call.id,
        name: call.name,
        result: result.success ? result.stdout : (result.error ?? result.stderr),
        success: result.success,
      };
    } catch (error) {
      this.emit("tool-result", agentId, call.name, false);
      return {
        toolCallId: call.id,
        name: call.name,
        result: error instanceof Error ? error.message : String(error),
        success: false,
      };
    }
  }

  getStatus(): SessionStatus {
    return this.status;
  }

  getPanelHistory(): AgentMessage[] {
    return [...this.panelHistory];
  }

  getAgents(): Agent[] {
    return getAgentsSortedByPriority(this.agents);
  }

  getAgent(id: string): Agent | undefined {
    return this.agents.get(id);
  }

  private setStatus(status: SessionStatus): void {
    this.status = status;
    this.emit("status-change", status);
  }

  async processUserMessage(userMessage: string): Promise<string> {
    this.panelHistory = [];
    const session = this.sessionManager.createSession();
    const msgLen = userMessage.length;

    // ── Fast path: simple conversation ──
    // Skip heavy orchestration for short, non-technical messages
    const technicalKeywords = /code|implement|function|class|api|script|build|deploy|search|research|shell|terminal|command|config|install|error|bug|fix|test|debug|refactor|optimize|docker|kubernetes|database|sql|server|endpoint|route|component/i;
    // Force full pipeline for conversation/multi-agent requests
    const conversationKeywords = /sohbet|muhabbet|konuş|tartış|hep.?beraber|hepiniz|herkes|birlikte|digerleri|diğerleri|siz.?de|sen.?de|naber|selam|selamun|beyler|millet|arkadaşlar|discuss|chat.?together|all.?agents|everyone|multi.?agent/i;
    const isTechnical = technicalKeywords.test(userMessage);
    const wantsMultiAgent = conversationKeywords.test(userMessage);
    const isShort = msgLen < 120;
    const isCasual = !isTechnical && isShort && !wantsMultiAgent;

    if (isCasual) {
      // Fast path: use a single agent directly, no analysis, no interjections
      this.setStatus("running");
      const fastAgent = this.agents.get("planner") ?? this.orchestratorAgent;
      if (fastAgent?.provider) {
        try {
          this.sessionManager.setCurrentSpeaker(fastAgent.id);
          let fullResponse = "";
          for await (const event of fastAgent.thinkStream(userMessage, [], { model: fastAgent.config.model })) {
            if (event.type === "content") {
              fullResponse += event.text;
              this.emit("agent-streaming", fastAgent.id, event.text);
            } else if (event.type === "done") {
              fullResponse = event.fullText;
            }
          }
          const msg: AgentMessage = { agentId: fastAgent.id, role: "speaker", content: fullResponse, timestamp: Date.now() };
          this.panelHistory.push(msg);
          this.sessionManager.addMessage(msg);
          this.emit("agent-speaking", fastAgent.id, fullResponse);
          this.setStatus("complete");
          this.sessionManager.endSession();
          await this.memory.store({ id: session.id, type: "episodic",
            content: `User: ${userMessage}\nResponse: ${fullResponse.slice(0, 500)}`,
            metadata: { mode: "fast" }, timestamp: Date.now() });
          this.emit("final-output", fullResponse);
          return fullResponse;
        } catch (error) {
          // Fall through to full pipeline on error
        }
      }
    }

    // ── Full pipeline ──
    this.setStatus("analyzing");

    try {
      // Step 0: Query memory for relevant context
      let memoryContext = "";
      try {
        const memoryResults = await this.memory.query(userMessage, 5);
        if (memoryResults.length > 0) {
          memoryContext = "\n[RELEVANT MEMORY]\n" +
            memoryResults.map((r) => `[${r.type}] ${r.content.slice(0, 300)}`).join("\n");
        }
      } catch {
        // Memory query is best-effort
      }

      // Step 1: Orchestrator analyzes the task
      this.emit("agent-speaking", "orchestrator", "Analyzing task...");
      const analysis = await this.orchestratorAgent!.think(
        `Analyze this user request and determine which agents should be involved:\n\n${userMessage}${memoryContext}\n\nAvailable agents: ${Array.from(this.agents.values()).map((a) => `${a.id} (${a.config.role})`).join(", ")}\n\nRespond with a plan listing which agents should speak and in what order.`,
      );
      this.panelHistory.push({
        agentId: "orchestrator",
        role: "speaker",
        content: analysis,
        timestamp: Date.now(),
      });
      this.sessionManager.setCurrentSpeaker("orchestrator");

      this.setStatus("running");

      // Step 2: Get all agents sorted by priority
      const allAgents = getAgentsSortedByPriority(this.agents);

      // Step 3: Let primary agents speak IN PARALLEL
      // For conversation mode, include ALL agents as primary
      let primaryAgentIds = this.selectPrimaryAgents(analysis);
      const isConversationMode = /sohbet|muhabbet|konuş|tartış|hep.?beraber|hepiniz|herkes|digerleri|diğerleri|siz.?de|sen.?de|naber|selam|selamun|beyler|millet|arkadaşlar/i.test(userMessage);
      if (isConversationMode && primaryAgentIds.length < 3) {
        // Force all agents to participate in conversation
        primaryAgentIds = Array.from(allAgents.map((a) => a.id));
      }
      const primaryAgents = allAgents.filter((a) => primaryAgentIds.includes(a.id));

      // ── Run all agents in PARALLEL (for speed) but buffer output ──
      this.emit("agent-speaking", "orchestrator", `Dispatching ${primaryAgents.length} agents...`);

      const agentResults = await Promise.allSettled(
        primaryAgents.map(async (agent) => {
          if (!agent.provider) return { agentId: agent.id, content: "[No provider]", elapsed: 0, tokens: 0 };
          const start = Date.now();
          let fullResponse = "";
          const wsContext = this.workspace.getContextFor(agent.id);
          const augmentedMessage = wsContext ? `${userMessage}\n\n${wsContext}` : userMessage;
          for await (const event of agent.thinkStream(augmentedMessage, this.panelHistory, {
            model: agent.config.model,
          })) {
            if (event.type === "content") fullResponse += event.text;
            else if (event.type === "done") fullResponse = event.fullText;
          }
          const elapsed = Date.now() - start;
          const tokens = Math.round(fullResponse.length / 3.5);
          return { agentId: agent.id, content: fullResponse, elapsed, tokens };
        })
      );

      // ── Show results SEQUENTIALLY with simulated streaming ──
      for (const agent of allAgents) {
        if (!primaryAgentIds.includes(agent.id)) {
          this.emit("agent-listening", agent.id);
          continue;
        }
        const result = agentResults.find((r) => r.status === "fulfilled" && r.value.agentId === agent.id);
        if (result?.status === "fulfilled") {
          const { content } = result.value;
          // Simulate streaming: emit word by word for typewriter effect
          let shown = "";
          const words = content.split(/(\s+)/);
          for (const word of words) {
            shown += word;
            this.emit("agent-streaming", agent.id, word);
            // Tiny delay for visual effect (non-blocking)
            await new Promise((r) => setTimeout(r, 1));
          }
          const msg: AgentMessage = { agentId: agent.id, role: "speaker", content, timestamp: Date.now(),
            tokensUsed: (result?.status === "fulfilled" ? (result.value as any).tokens : 0) ?? 0,
            elapsedMs: (result?.status === "fulfilled" ? (result.value as any).elapsed : 0) ?? 0 };
          // Track cost
          const tokens = (result?.status === "fulfilled" ? (result.value as any).tokens : 0) ?? 0;
          if (tokens > 0) this.costTracker.track(agent.id, agent.config.model, tokens);
          this.panelHistory.push(msg);
          this.sessionManager.addMessage(msg);
          this.emit("agent-speaking", agent.id, content);
        } else {
          const err = result?.status === "rejected" ? result.reason : new Error("Unknown");
          const errorMsg = `[Error] ${err instanceof Error ? err.message : String(err)}`;
          this.emit("error", err instanceof Error ? err : new Error(String(err)));
          this.panelHistory.push({ agentId: agent.id, role: "speaker", content: errorMsg, timestamp: Date.now() });
        }
      }

      // Step 4: Interjections — only for complex tasks (skip if <2 primary agents spoken)
      if (primaryAgentIds.length >= 2) {
        for (const agent of allAgents) {
          if (!primaryAgentIds.includes(agent.id) && agent.provider) {
            try {
              const interjection = await agent.interject(this.panelHistory);
              if (interjection) {
                const msg: AgentMessage = { agentId: agent.id, role: "interjection", content: interjection, timestamp: Date.now() };
                this.panelHistory.push(msg);
                this.sessionManager.addMessage(msg);
                this.emit("agent-interjection", agent.id, interjection);
              }
            } catch {
              // Silently skip interjection failures
            }
          }
        }
      }

      // Step 4b: Dialogue loop — agents can respond to each other
      if (primaryAgentIds.length >= 2) {
        this.workspace.addNote("orchestrator", "all",
          `Primary agents spoke: ${primaryAgentIds.join(", ")}. Each can reply to others.`);
        // One round: each agent gets to respond to the discussion
        for (const agent of allAgents) {
          if (!agent.provider) continue;
          try {
            const discussionContext = this.panelHistory
              .slice(-6)  // last 6 messages
              .map((m) => `[${m.agentId}]: ${m.content.slice(0, 200)}`)
              .join("\n\n");
            const wsNotes = this.workspace.getBroadcastNotes()
              .slice(-5)
              .map((n) => `[${n.from}] note: ${n.message.slice(0, 150)}`)
              .join("\n");
            const dialoguePrompt = wsNotes
              ? `Discussion so far:\n${discussionContext}\n\nWorkspace notes:\n${wsNotes}\n\nYou may respond to any agent or add value. If nothing to add, reply "NO_INTERJECTION".`
              : `Discussion so far:\n${discussionContext}\n\nYou may respond to any agent or add value. If nothing to add, reply "NO_INTERJECTION".`;
            const response = await agent.interject(
              this.panelHistory.map((m) => ({ ...m, content: m.content.slice(0, 300) }))
            );
            if (response && !response.includes("NO_INTERJECTION")) {
              const msg: AgentMessage = { agentId: agent.id, role: "interjection", content: response, timestamp: Date.now() };
              this.panelHistory.push(msg);
              this.sessionManager.addMessage(msg);
              this.emit("agent-interjection", agent.id, response);
              this.workspace.addNote(agent.id, "all", response.slice(0, 200));
            }
          } catch {
            // Skip on failure
          }
        }
      }

      // Step 5: Orchestrator synthesizes final response
      this.setStatus("awaiting_input");
      const finalResponse = await this.synthesizeResponse(userMessage);
      this.setStatus("complete");
      this.emit("final-output", finalResponse);

      // Store session with summary
      this.sessionManager.endSession();

      // Store episodic memory
      await this.memory.store({
        id: session.id,
        type: "episodic",
        content: `User: ${userMessage}\nResponse: ${finalResponse.slice(0, 500)}`,
        metadata: { agentCount: allAgents.length, primaryAgents: primaryAgentIds },
        timestamp: Date.now(),
      });

      return finalResponse;
    } catch (error) {
      this.setStatus("error");
      this.sessionManager.setStatus("error");
      this.emit("error", error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  private selectPrimaryAgents(analysis: string): string[] {
    const agentKeywords: Record<string, string[]> = {
      planner: ["plan", "step", "break down", "decompose", "approach", "strategy"],
      coder: ["code", "implement", "function", "class", "api", "program", "script", "build", "develop"],
      executor: ["run", "execute", "command", "terminal", "shell", "install", "deploy"],
      researcher: ["search", "find", "research", "look up", "documentation", "learn", "what is"],
      critic: ["review", "check", "audit", "security", "bug", "error", "vulnerability", "safe"],
      summarizer: ["summarize", "recap", "overview", "brief", "extract"],
    };

    const selected: string[] = [];
    const analysisLower = analysis.toLowerCase();

    for (const [agentId, keywords] of Object.entries(agentKeywords)) {
      if (keywords.some((kw) => analysisLower.includes(kw))) {
        selected.push(agentId);
      }
    }

    if (analysisLower.length > 50 && !selected.includes("planner")) {
      selected.unshift("planner");
    }

    return selected.length > 0 ? selected : ["planner", "coder"];
  }

  private async synthesizeResponse(userMessage: string): Promise<string> {
    const conversation = this.panelHistory
      .map((m) => `[${m.agentId}]: ${m.content}`)
      .join("\n\n");

    const synthesis = await this.orchestratorAgent!.think(
      `User request: ${userMessage}\n\nPanel discussion:\n${conversation}\n\nSynthesize the above panel discussion into a clear, comprehensive response for the user. Combine insights from all agents, resolve any contradictions, and present the final answer.`,
    );

    return synthesis;
  }

  async getOrchestratorResponse(userMessage: string): Promise<string> {
    if (!this.orchestratorAgent) {
      throw new Error("Orchestrator agent not initialized");
    }

    return this.orchestratorAgent.think(userMessage);
  }

  /**
   * Execute a shell command directly through the critic-gated ShellToolAdapter.
   */
  async executeShellCommand(command: string): Promise<ToolResult> {
    const shellTool = this.toolRegistry.get("shell_exec");
    if (!shellTool) {
      return {
        success: false,
        stdout: "",
        stderr: "",
        error: "Shell tool not found in registry",
      };
    }
    return shellTool.execute({ command });
  }

  /**
   * Resume a session from the database. Loads all stored messages.
   * Returns the loaded AgentMessage[] or null if session not found.
   */
  resumeSession(sessionId: string): AgentMessage[] | null {
    const session = this.sessionManager.resumeSession(sessionId);
    if (!session) return null;
    this.panelHistory = session.messages;
    this.status = "idle";
    return session.messages;
  }

  /**
   * List all persisted sessions (newest first).
   */
  listSessions(limit?: number) {
    return this.sessionManager.listPersistedSessions(limit);
  }

  /**
   * Delete a persisted session.
   */
  deleteSession(id: string): boolean {
    return this.sessionManager.deletePersistedSession(id);
  }

  /**
   * Fetch available models from a specific provider by ID.
   * Returns the model list or an error message.
   */
  async listProviderModels(providerId: string): Promise<{ provider: string; models: string[]; error?: string }> {
    const provider = this.providers.get(providerId);
    if (!provider) {
      return { provider: providerId, models: [], error: `Provider "${providerId}" not found` };
    }
    try {
      const models = await provider.listModels();
      return { provider: providerId, models };
    } catch (error) {
      return {
        provider: providerId,
        models: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Add a new provider dynamically. Persists to config.yaml and initializes.
   */
  async addProvider(id: string, type: string, apiKey?: string, baseUrl?: string): Promise<{ success: boolean; message: string; models?: string[] }> {
    // Validate type
    const validTypes = ["openai", "anthropic", "gemini", "ollama", "groq", "fireworks", "lmstudio", "deepseek", "zai", "openai-compatible"];
    if (!validTypes.includes(type)) {
      return { success: false, message: `Unknown provider type "${type}". Valid: ${validTypes.join(", ")}` };
    }

    const config: import("../config/types.js").ProviderConfig = { id, apiKey, baseUrl };

    // Try to create and test the provider
    try {
      const provider = createProvider({ ...config, id: type });
      // Test connection by listing models
      const models = await provider.listModels();
      // If successful, save to config
      addProviderToConfig({ id: type, apiKey, baseUrl });
      // Register in our map
      this.providers.set(type, provider);
      // Wire to agents that need a provider
      for (const [, agent] of this.agents) {
        if (!agent.provider && agent.config.provider === type) {
          agent.setProvider(provider);
        }
      }
      return { success: true, message: `Provider "${type}" added (${models.length} models available)`, models };
    } catch (error) {
      // Still save the config so user can fix later
      addProviderToConfig({ id: type, apiKey, baseUrl });
      return {
        success: false,
        message: `Provider config saved but connection failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Remove a provider.
   */
  removeProvider(id: string): boolean {
    if (removeProviderFromConfig(id)) {
      this.providers.delete(id);
      return true;
    }
    return false;
  }

  /**
   * Get all provider IDs configured.
   */
  getProviderIds(): string[] {
    return Array.from(this.providers.keys());
  }

  /**
   * Get the shared workspace.
   */
  getWorkspace(): AgentWorkspace {
    return this.workspace;
  }

  /**
   * Permission level: all = full access, safe = critic-gated, ask = prompt before each action
   */
  setPermission(level: "all" | "safe" | "ask"): void {
    this.permissionLevel = level;
    this.toolRegistry.setCriticEnabled(level !== "all");
  }

  getPermission(): "all" | "safe" | "ask" {
    return this.permissionLevel;
  }

  getCostTracker(): CostTracker { return this.costTracker; }
  getBackgroundAgent(): BackgroundAgent { return this.backgroundAgent; }
  getGitHubAgent(): GitHubAgent { return this.githubAgent; }

  /**
   * MCP & Skills registry.
   */
  getMCPRegistry(): MCPRegistry {
    return this.mcpRegistry;
  }

  /**
   * Get full context for agent system prompts (MCP + skills + workspace).
   */
  getAgentFullContext(agentId: string): string {
    const parts: string[] = [];
    const ws = this.workspace.getContextFor(agentId);
    if (ws) parts.push(ws);
    const mcp = this.mcpRegistry.getAgentContext();
    if (mcp) parts.push(mcp);
    return parts.join("\n\n");
  }

  /**
   * Add a custom agent at runtime. Persists to agents.yaml.
   */
  addCustomAgent(config: AgentConfig): boolean {
    const agent = new Agent(config);
    const provider = this.providers.get(config.provider) ?? this.providers.values().next().value;
    if (provider) {
      agent.setProvider(provider);
    }
    // Give tools
    if (config.capabilities.includes("command_execution") || config.capabilities.includes("coding") || config.capabilities.includes("research")) {
      agent.setTools(this.getToolDefinitions());
    }
    this.agents.set(config.id, agent);

    // Save to agents.yaml
    const existing = loadCustomAgents();
    const idx = existing.findIndex((a) => a.id === config.id);
    if (idx >= 0) existing[idx] = config;
    else existing.push(config);
    saveCustomAgents(existing);
    return true;
  }

  /**
   * Remove a custom agent.
   */
  removeCustomAgent(id: string): boolean {
    if (!this.agents.has(id)) return false;
    this.agents.delete(id);
    const existing = loadCustomAgents();
    saveCustomAgents(existing.filter((a) => a.id !== id));
    return true;
  }

  /**
   * Run a full diagnostic health check on the system.
   */
  async runDoctor(): Promise<DoctorReport> {
    const report: DoctorReport = {
      providers: [],
      agents: [],
      memory: { status: "ok", message: "", entryCount: 0 },
      embedding: { status: "ok", ollamaAvailable: false, message: "" },
      tools: [],
      sessions: { active: null, total: 0 },
      overall: "healthy",
    };

    // Check providers
    for (const [id, provider] of this.providers) {
      try {
        const models = await provider.listModels();
        report.providers.push({
          id,
          status: "ok",
          message: `${models.length} models available (${models.slice(0, 3).join(", ")}${models.length > 3 ? "..." : ""})`,
        });
      } catch {
        report.providers.push({
          id,
          status: "error",
          message: "Failed to connect or list models",
        });
      }
    }

    // Check agents
    for (const [id, agent] of this.agents) {
      report.agents.push({
        id,
        hasProvider: agent.provider !== null,
        toolCount: agent.getTools().length,
      });
    }

    // Check memory
    try {
      const entries = await this.memory.searchByType("episodic", 1);
      report.memory = {
        status: "ok",
        message: "Memory operational",
        entryCount: entries.length,
      };
    } catch {
      report.memory = {
        status: "error",
        message: "Memory query failed",
        entryCount: 0,
      };
    }

    // Check embedding
    try {
      const ollamaAvailable = await this.embeddingService.isOllamaAvailable();
      report.embedding = {
        status: "ok",
        ollamaAvailable,
        message: ollamaAvailable
          ? "Ollama nomic-embed-text available (768-dim semantic embeddings)"
          : "Hash-based fallback (384-dim). Install Ollama + nomic-embed-text for better results.",
      };
    } catch {
      report.embedding = {
        status: "error",
        message: "Embedding service check failed",
        ollamaAvailable: false,
      };
    }

    // Check tools
    for (const tool of this.toolRegistry.list()) {
      report.tools.push({ name: tool.name, registered: true });
    }

    // Sessions
    const activeSession = this.sessionManager.getActiveSession();
    const persistedCount = this.memory.sessionCount();
    report.sessions = {
      active: activeSession?.id ?? null,
      total: persistedCount,
    };

    // Determine overall health
    const providerErrors = report.providers.filter((p) => p.status === "error").length;
    const agentWithoutProviders = report.agents.filter((a) => !a.hasProvider).length;

    if (providerErrors === report.providers.length && report.providers.length > 0) {
      report.overall = "unhealthy";
    } else if (providerErrors > 0 || agentWithoutProviders > 0 || report.memory.status === "error") {
      report.overall = "degraded";
    } else {
      report.overall = "healthy";
    }

    return report;
  }
}
