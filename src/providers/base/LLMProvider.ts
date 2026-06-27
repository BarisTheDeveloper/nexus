import type { Message, ChatOptions } from "../../config/types.js";

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ChatResponse {
  content: string;
  toolCalls?: ToolCall[];
}

export interface LLMProvider {
  id: string;
  name: string;
  chat(messages: Message[], options?: ChatOptions): Promise<string>;
  chatWithTools(
    messages: Message[],
    tools: ToolDefinition[],
    options?: ChatOptions,
  ): Promise<ChatResponse>;
  stream(messages: Message[], options?: ChatOptions): AsyncGenerator<string>;
  listModels(): Promise<string[]>;
}
