import type { Message, AgentConfig, AgentMessage, ChatOptions, Capability, CriticReview } from "../../config/types.js";
import type { LLMProvider, ToolDefinition, ToolCall, ChatResponse } from "../../providers/base/LLMProvider.js";

export interface AgentToolResult {
  toolCallId: string;
  name: string;
  result: string;
  success: boolean;
}

export class Agent {
  public config: AgentConfig;
  public provider: LLMProvider | null = null;
  private availableTools: ToolDefinition[] = [];

  constructor(config: AgentConfig) {
    this.config = config;
  }

  get id(): string {
    return this.config.id;
  }

  get name(): string {
    return this.config.name;
  }

  get role(): string {
    return this.config.role;
  }

  get systemPrompt(): string {
    return this.config.systemPrompt;
  }

  get capabilities(): Capability[] {
    return this.config.capabilities;
  }

  get priority(): number {
    return this.config.priority;
  }

  setProvider(provider: LLMProvider): void {
    this.provider = provider;
  }

  setTools(tools: ToolDefinition[]): void {
    this.availableTools = tools;
  }

  getTools(): ToolDefinition[] {
    return [...this.availableTools];
  }

  async think(
    userMessage: string,
    panelHistory: AgentMessage[] = [],
    options?: ChatOptions,
  ): Promise<string> {
    if (!this.provider) {
      throw new Error(`No provider set for agent: ${this.id}`);
    }

    const { messages, panelContext } = this.buildMessages(userMessage, panelHistory);

    // If agent has tools and the capability, use tool-aware chat
    if (this.availableTools.length > 0) {
      return this.thinkWithTools(messages, options);
    }

    return this.provider.chat(messages, options);
  }

  /**
   * Stream thinking — yields content chunks as they arrive.
   */
  async *thinkStream(
    userMessage: string,
    panelHistory: AgentMessage[] = [],
    options?: ChatOptions,
  ): AsyncGenerator<{ type: "content"; text: string } | { type: "tool_call"; call: ToolCall } | { type: "done"; fullText: string }> {
    if (!this.provider) {
      throw new Error(`No provider set for agent: ${this.id}`);
    }

    const { messages } = this.buildMessages(userMessage, panelHistory);
    let fullText = "";

    // If tools available, use tool-aware flow (non-streaming for now, then stream result)
    if (this.availableTools.length > 0) {
      const result = await this.thinkWithToolsFull(messages, options);
      // Simulate streaming by yielding word by word
      const words = result.split(/(\s+)/);
      for (const word of words) {
        fullText += word;
        yield { type: "content", text: word };
      }
      yield { type: "done", fullText };
      return;
    }

    // Regular streaming
    try {
      for await (const chunk of this.provider.stream(messages, options)) {
        fullText += chunk;
        yield { type: "content", text: chunk };
      }
    } catch {
      // Fallback to non-streaming
      fullText = await this.provider.chat(messages, options);
      yield { type: "content", text: fullText };
    }

    yield { type: "done", fullText };
  }

  private async thinkWithTools(messages: Message[], options?: ChatOptions): Promise<string> {
    const maxIterations = 5;
    let currentMessages = [...messages];

    for (let i = 0; i < maxIterations; i++) {
      const response = await this.provider!.chatWithTools(currentMessages, this.availableTools, options);

      if (!response.toolCalls || response.toolCalls.length === 0) {
        return response.content;
      }

      // Execute tool calls and append results
      for (const call of response.toolCalls) {
        const result = await this.executeToolCall(call);
        currentMessages.push({
          role: "assistant",
          content: response.content || `Calling tool: ${call.name}`,
        });
        currentMessages.push({
          role: "user",
          content: `[TOOL RESULT] ${call.name}: ${result.result}\n${result.success ? "✓ Success" : "✗ Failed"}`,
        });
      }
    }

    // Final response after tool loop
    return this.provider!.chat(currentMessages, options);
  }

  private async thinkWithToolsFull(messages: Message[], options?: ChatOptions): Promise<string> {
    return this.thinkWithTools(messages, options);
  }

  async executeToolCall(call: ToolCall): Promise<AgentToolResult> {
    // Tool calls are executed by the orchestrator via ToolRegistry.
    // This method is a stub — actual execution happens in Orchestrator.
    return {
      toolCallId: call.id,
      name: call.name,
      result: `Tool "${call.name}" called with args: ${JSON.stringify(call.arguments)}`,
      success: true,
    };
  }

  private buildMessages(userMessage: string, panelHistory: AgentMessage[] = []): {
    messages: Message[];
    panelContext: string;
  } {
    const panelContext = panelHistory.length > 0
      ? `[PANEL CONTEXT]\nSo far in this conversation:\n${panelHistory
          .map((m) => `- ${m.agentId}: "${m.content.slice(0, 500)}"`)
          .join("\n")}\n\n[QUESTION]: ${userMessage}`
      : userMessage;

    const messages: Message[] = [
      { role: "system", content: this.systemPrompt },
      { role: "user", content: panelContext },
    ];

    return { messages, panelContext };
  }

  async interject(
    conversation: AgentMessage[],
    options?: ChatOptions,
  ): Promise<string | null> {
    if (!this.provider || conversation.length === 0) return null;

    const context = conversation.map((m) =>
      `[${m.agentId}] (${m.role}): "${m.content.slice(0, 300)}"`
    ).join("\n");

    const messages: Message[] = [
      {
        role: "system",
        content: `${this.systemPrompt}\n\nYou are in a panel discussion. Review the conversation below and decide if you have anything valuable to add. If you do, respond with your addition. If you have nothing to add, respond with "NO_INTERJECTION".`,
      },
      {
        role: "user",
        content: `Current conversation:\n${context}\n\nDo you have anything to add?`,
      },
    ];

    const response = await this.provider.chat(messages, options);
    return response.includes("NO_INTERJECTION") ? null : response;
  }

  /**
   * Review a shell command for safety/security before execution.
   * Only the Critic agent performs a meaningful review; other agents return approved.
   */
  async reviewShellCommand(command: string): Promise<CriticReview> {
    if (!this.provider) {
      return { approved: true };
    }

    const messages: Message[] = [
      {
        role: "system",
        content: `${this.systemPrompt}\n\nYou are reviewing a shell command for safety. Analyze the command and decide if it should be allowed. Consider:\n\n1. **Destructive operations**: rm -rf, dd, format, mkfs, > /dev/sda, etc.\n2. **Data loss risk**: Overwriting files, deleting data, dangerous git operations\n3. **Network operations**: curl/wget to unknown hosts, data exfiltration\n4. **Privilege escalation**: sudo, su, chmod 777, setuid\n5. **Installation**: Package installs, global npm/pip installs\n6. **Side effects**: Commands that modify system state in unexpected ways\n\nRespond in EXACTLY one of these formats:\n- APPROVED — if the command is safe to run\n- REJECTED:INFO: <reason> — low risk, minor concern\n- REJECTED:WARNING: <reason> — moderate risk, should be reviewed\n- REJECTED:DANGER: <reason> — high risk, do NOT run\n\nBe thorough but practical. Common commands like ls, cat, echo, git status, npm install (without -g) are typically safe. Commands that delete, overwrite, or modify system files are not.`,
      },
      {
        role: "user",
        content: `Review this shell command:\n\n\`${command}\`\n\nRespond with APPROVED or REJECTED:SEVERITY: reason`,
      },
    ];

    const response = await this.provider.chat(messages, { temperature: 0.1 });
    const trimmed = response.trim();

    if (trimmed.startsWith("APPROVED")) {
      return { approved: true };
    }

    // Parse REJECTED:SEVERITY: reason
    const rejectedMatch = trimmed.match(/^REJECTED:(INFO|WARNING|DANGER):\s*([\s\S]+)/);
    if (rejectedMatch) {
      return {
        approved: false,
        reason: rejectedMatch[2]!.trim(),
        severity: rejectedMatch[1]!.toLowerCase() as "info" | "warning" | "danger",
      };
    }

    // Fallback: if response contains "REJECTED" but unparseable, treat as warning
    if (trimmed.includes("REJECTED")) {
      return {
        approved: false,
        reason: trimmed.slice(0, 200),
        severity: "warning",
      };
    }

    // Default: approve
    return { approved: true };
  }
}
