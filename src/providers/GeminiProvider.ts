import { GoogleGenerativeAI } from "@google/generative-ai";
import type { Message, ChatOptions } from "../config/types.js";
import type { LLMProvider, ToolDefinition, ChatResponse } from "./base/LLMProvider.js";

export class GeminiProvider implements LLMProvider {
  id = "gemini";
  name = "Google Gemini";
  private genAI: GoogleGenerativeAI;

  constructor(apiKey?: string) {
    this.genAI = new GoogleGenerativeAI(apiKey ?? process.env["GEMINI_API_KEY"] ?? "");
  }

  async chat(messages: Message[], options?: ChatOptions): Promise<string> {
    const model = this.genAI.getGenerativeModel({
      model: options?.model ?? "gemini-1.5-pro",
    });

    const systemMessages = messages.filter((m) => m.role === "system");
    const historyMessages = messages
      .filter((m) => m.role !== "system")
      .slice(0, -1)
      .map((m) => ({
        role: m.role === "assistant" ? "model" : "user" as const,
        parts: [{ text: m.content }],
      }));

    const lastMessage = messages.filter((m) => m.role !== "system").at(-1);

    if (lastMessage) {
      const result = await model.generateContent({
        contents: [
          ...historyMessages,
          {
            role: lastMessage.role === "assistant" ? "model" : "user" as const,
            parts: [{ text: lastMessage.content }],
          },
        ],
        systemInstruction: systemMessages.length > 0
          ? { role: "user" as const, parts: [{ text: systemMessages.map((m) => m.content).join("\n") }] }
          : undefined,
        generationConfig: {
          maxOutputTokens: options?.maxTokens ?? 4096,
          temperature: options?.temperature ?? 0.7,
        },
      });

      return result.response.text();
    }

    return "";
  }

  async chatWithTools(
    messages: Message[],
    tools: ToolDefinition[],
    options?: ChatOptions,
  ): Promise<ChatResponse> {
    // Gemini native function calling via tool config
    const model = this.genAI.getGenerativeModel({
      model: options?.model ?? "gemini-1.5-pro",
      ...(tools.length > 0 ? {
        tools: [{
          functionDeclarations: tools.map((t) => ({
            name: t.name,
            description: t.description,
            parameters: t.parameters,
          })),
        }],
      } : {}),
    } as any);

    const systemMessages = messages.filter((m) => m.role === "system");
    const historyMessages = messages
      .filter((m) => m.role !== "system")
      .slice(0, -1)
      .map((m) => ({
        role: m.role === "assistant" ? "model" : "user" as const,
        parts: [{ text: m.content }],
      }));

    const lastMessage = messages.filter((m) => m.role !== "system").at(-1);

    if (!lastMessage) return { content: "" };

    const result = await model.generateContent({
      contents: [
        ...historyMessages,
        {
          role: lastMessage.role === "assistant" ? "model" : "user" as const,
          parts: [{ text: lastMessage.content }],
        },
      ],
      systemInstruction: systemMessages.length > 0
        ? { role: "user" as const, parts: [{ text: systemMessages.map((m) => m.content).join("\n") }] }
        : undefined,
      generationConfig: {
        maxOutputTokens: options?.maxTokens ?? 4096,
        temperature: options?.temperature ?? 0.7,
      },
    });

    const resp = result.response;
    const content = resp.text();

    const toolCalls = resp.functionCalls()?.map((fc, i) => ({
      id: `gemini-tool-${i}`,
      name: fc.name,
      arguments: fc.args as Record<string, unknown>,
    })) ?? [];

    return { content, toolCalls };
  }

  async *stream(messages: Message[], options?: ChatOptions): AsyncGenerator<string> {
    const model = this.genAI.getGenerativeModel({
      model: options?.model ?? "gemini-1.5-pro",
    });

    const systemMessages = messages.filter((m) => m.role === "system");
    const historyMessages = messages
      .filter((m) => m.role !== "system")
      .slice(0, -1)
      .map((m) => ({
        role: m.role === "assistant" ? "model" : "user" as const,
        parts: [{ text: m.content }],
      }));

    const lastMessage = messages.filter((m) => m.role !== "system").at(-1);

    if (!lastMessage) return;

    const result = await model.generateContentStream({
      contents: [
        ...historyMessages,
        {
          role: lastMessage.role === "assistant" ? "model" : "user" as const,
          parts: [{ text: lastMessage.content }],
        },
      ],
      systemInstruction: systemMessages.length > 0
        ? { role: "user" as const, parts: [{ text: systemMessages.map((m) => m.content).join("\n") }] }
        : undefined,
      generationConfig: {
        maxOutputTokens: options?.maxTokens ?? 4096,
        temperature: options?.temperature ?? 0.7,
      },
    });

    for await (const chunk of result.stream) {
      yield chunk.text();
    }
  }

  async listModels(): Promise<string[]> {
    return [
      "gemini-1.5-pro",
      "gemini-1.5-flash",
      "gemini-2.0-flash",
      "gemini-2.0-pro",
    ];
  }
}
