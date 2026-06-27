import OpenAI from "openai";
import type { Message, ChatOptions } from "../config/types.js";
import type { LLMProvider, ToolDefinition, ChatResponse } from "./base/LLMProvider.js";

export class OpenAIProvider implements LLMProvider {
  id = "openai-compatible";
  name = "OpenAI Compatible";
  private client: OpenAI;
  private defaultModel: string;

  constructor(config?: { id?: string; name?: string; apiKey?: string; baseUrl?: string; defaultModel?: string }) {
    this.defaultModel = config?.defaultModel ?? "gpt-4o";
    this.client = new OpenAI({
      apiKey: config?.apiKey ?? process.env["OPENAI_API_KEY"] ?? "sk-placeholder",
      baseURL: config?.baseUrl ?? process.env["OPENAI_BASE_URL"] ?? undefined,
    });

    if (config?.id) this.id = config.id;
    if (config?.name) this.name = config.name;
  }

  async chat(messages: Message[], options?: ChatOptions): Promise<string> {
    const response = await this.client.chat.completions.create({
      model: options?.model ?? this.defaultModel,
      max_tokens: options?.maxTokens ?? 4096,
      temperature: options?.temperature ?? 0.7,
      messages,
    });

    return response.choices[0]?.message?.content ?? "";
  }

  async chatWithTools(
    messages: Message[],
    tools: ToolDefinition[],
    options?: ChatOptions,
  ): Promise<ChatResponse> {
    const response = await this.client.chat.completions.create({
      model: options?.model ?? this.defaultModel,
      max_tokens: options?.maxTokens ?? 4096,
      temperature: options?.temperature ?? 0.7,
      messages,
      tools: tools.map((t) => ({
        type: "function" as const,
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      })),
      tool_choice: "auto",
    });

    const choice = response.choices[0];
    const message = choice?.message;

    const content = message?.content ?? "";

    const toolCalls = message?.tool_calls?.map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      arguments: JSON.parse(tc.function.arguments) as Record<string, unknown>,
    })) ?? [];

    return { content, toolCalls };
  }

  async *stream(messages: Message[], options?: ChatOptions): AsyncGenerator<string> {
    const stream = await this.client.chat.completions.create({
      model: options?.model ?? this.defaultModel,
      max_tokens: options?.maxTokens ?? 4096,
      temperature: options?.temperature ?? 0.7,
      messages,
      stream: true,
    });

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) yield content;
    }
  }

  async listModels(): Promise<string[]> {
    try {
      const models = await this.client.models.list();
      return models.data.map((m) => m.id);
    } catch {
      return [this.defaultModel];
    }
  }
}
