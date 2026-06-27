import Anthropic from "@anthropic-ai/sdk";
import type { Message, ChatOptions } from "../config/types.js";
import type { LLMProvider, ToolDefinition, ChatResponse } from "./base/LLMProvider.js";

export class AnthropicProvider implements LLMProvider {
  id = "anthropic";
  name = "Anthropic";
  private client: Anthropic;

  constructor(apiKey?: string) {
    this.client = new Anthropic({
      apiKey: apiKey ?? process.env["ANTHROPIC_API_KEY"],
    });
  }

  async chat(messages: Message[], options?: ChatOptions): Promise<string> {
    const systemMessages = messages.filter((m) => m.role === "system");
    const nonSystemMessages = messages.filter((m) => m.role !== "system");

    const response = await this.client.messages.create({
      model: options?.model ?? "claude-sonnet-4-20250514",
      max_tokens: options?.maxTokens ?? 4096,
      temperature: options?.temperature ?? 0.7,
      system: systemMessages.map((m) => m.content).join("\n"),
      messages: nonSystemMessages.map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
    });

    return response.content
      .map((block) => (block.type === "text" ? block.text : ""))
      .join("");
  }

  async chatWithTools(
    messages: Message[],
    _tools: ToolDefinition[],
    options?: ChatOptions,
  ): Promise<ChatResponse> {
    // Anthropic tools require different SDK call shape.
    // For now, fall back to regular chat with tool-use prompting.
    const systemMessages = messages.filter((m) => m.role === "system");
    const nonSystemMessages = messages.filter((m) => m.role !== "system");

    const toolDescriptions = _tools
      .map((t) => `- ${t.name}: ${t.description}`)
      .join("\n");

    const augmentedSystem = systemMessages.length > 0
      ? `${systemMessages.map((m) => m.content).join("\n")}\n\nAvailable tools:\n${toolDescriptions}\n\nTo use a tool, respond with a JSON block: {"tool": "<name>", "args": {...}}`
      : `Available tools:\n${toolDescriptions}\n\nTo use a tool, respond with a JSON block: {"tool": "<name>", "args": {...}}`;

    const response = await this.client.messages.create({
      model: options?.model ?? "claude-sonnet-4-20250514",
      max_tokens: options?.maxTokens ?? 4096,
      temperature: options?.temperature ?? 0.7,
      system: augmentedSystem,
      messages: nonSystemMessages.map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
    });

    const content = response.content
      .map((block) => (block.type === "text" ? block.text : ""))
      .join("");

    // Parse potential JSON tool call from response
    const toolMatch = content.match(/\{"tool"\s*:\s*"(\w+)"\s*,\s*"args"\s*:\s*(\{[^}]+\})\s*\}/);
    if (toolMatch) {
      try {
        const args = JSON.parse(toolMatch[2]!) as Record<string, unknown>;
        return {
          content: content.replace(toolMatch[0]!, "").trim(),
          toolCalls: [{ id: "claude-tool-0", name: toolMatch[1]!, arguments: args }],
        };
      } catch {
        // Parse failed, return as plain content
      }
    }

    return { content };
  }

  async *stream(messages: Message[], options?: ChatOptions): AsyncGenerator<string> {
    const systemMessages = messages.filter((m) => m.role === "system");
    const nonSystemMessages = messages.filter((m) => m.role !== "system");

    const stream = await this.client.messages.create({
      model: options?.model ?? "claude-sonnet-4-20250514",
      max_tokens: options?.maxTokens ?? 4096,
      temperature: options?.temperature ?? 0.7,
      system: systemMessages.map((m) => m.content).join("\n"),
      messages: nonSystemMessages.map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
      stream: true,
    });

    for await (const chunk of stream) {
      if (chunk.type === "content_block_delta" && chunk.delta?.type === "text_delta") {
        yield chunk.delta.text;
      }
    }
  }

  async listModels(): Promise<string[]> {
    return [
      "claude-sonnet-4-20250514",
      "claude-3-5-sonnet-20241022",
      "claude-3-5-haiku-20241022",
      "claude-3-opus-20240229",
    ];
  }
}
