import ollama from "ollama";
import type { Message, ChatOptions } from "../config/types.js";
import type { LLMProvider, ToolDefinition, ChatResponse } from "./base/LLMProvider.js";

export class OllamaProvider implements LLMProvider {
  id = "ollama";
  name = "Ollama";
  private baseUrl: string;

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl ?? "http://localhost:11434";
  }

  /**
   * Create a properly configured ollama client with the configured base URL.
   * Uses environment variable OLLAMA_HOST for the host setting.
   */
  private async chatInternal(messages: Message[], options?: ChatOptions, streamMode?: boolean): Promise<any> {
    // Set the OLLAMA_HOST env var so the ollama client connects to the right host
    const originalHost = process.env["OLLAMA_HOST"];
    process.env["OLLAMA_HOST"] = this.baseUrl;

    try {
      if (streamMode) {
        return await ollama.chat({
          model: options?.model ?? "llama3.2",
          messages: messages.map((m) => ({
            role: m.role as "user" | "assistant" | "system",
            content: m.content,
          })),
          options: {
            temperature: options?.temperature ?? 0.7,
            num_predict: options?.maxTokens ?? 4096,
          },
          stream: true,
        });
      }

      return await ollama.chat({
        model: options?.model ?? "llama3.2",
        messages: messages.map((m) => ({
          role: m.role as "user" | "assistant" | "system",
          content: m.content,
        })),
        options: {
          temperature: options?.temperature ?? 0.7,
          num_predict: options?.maxTokens ?? 4096,
        },
      });
    } finally {
      if (originalHost) {
        process.env["OLLAMA_HOST"] = originalHost;
      } else {
        delete process.env["OLLAMA_HOST"];
      }
    }
  }

  async chat(messages: Message[], options?: ChatOptions): Promise<string> {
    const response = await this.chatInternal(messages, options, false);
    return response.message.content;
  }

  async chatWithTools(
    messages: Message[],
    tools: ToolDefinition[],
    options?: ChatOptions,
  ): Promise<ChatResponse> {
    // Ollama supports tools natively when model supports it.
    // For models without native tool support, fall back to prompt-based.
    const originalHost = process.env["OLLAMA_HOST"];
    process.env["OLLAMA_HOST"] = this.baseUrl;

    try {
      const response = await ollama.chat({
        model: options?.model ?? "llama3.2",
        messages: messages.map((m) => ({
          role: m.role as "user" | "assistant" | "system",
          content: m.content,
        })),
        tools: tools.map((t) => ({
          type: "function",
          function: {
            name: t.name,
            description: t.description,
            parameters: t.parameters,
          },
        })),
        options: {
          temperature: options?.temperature ?? 0.7,
          num_predict: options?.maxTokens ?? 4096,
        },
      });

      const toolCalls = response.message.tool_calls?.map((tc) => ({
        id: `ollama-tool-${tc.function.name}`,
        name: tc.function.name,
        arguments: tc.function.arguments as unknown as Record<string, unknown>,
      })) ?? [];

      return { content: response.message.content, toolCalls };
    } finally {
      if (originalHost) {
        process.env["OLLAMA_HOST"] = originalHost;
      } else {
        delete process.env["OLLAMA_HOST"];
      }
    }
  }

  async *stream(messages: Message[], options?: ChatOptions): AsyncGenerator<string> {
    const stream = await this.chatInternal(messages, options, true);

    for await (const chunk of stream) {
      yield chunk.message.content;
    }
  }

  async listModels(): Promise<string[]> {
    const originalHost = process.env["OLLAMA_HOST"];
    process.env["OLLAMA_HOST"] = this.baseUrl;

    try {
      const models = await ollama.list();
      return models.models.map((m) => m.name);
    } catch {
      return ["llama3.2", "mistral", "mixtral", "nomic-embed-text"];
    } finally {
      if (originalHost) {
        process.env["OLLAMA_HOST"] = originalHost;
      } else {
        delete process.env["OLLAMA_HOST"];
      }
    }
  }
}
