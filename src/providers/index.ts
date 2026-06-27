import type { ProviderConfig } from "../config/types.js";
import type { LLMProvider } from "./base/LLMProvider.js";
import { AnthropicProvider } from "./AnthropicProvider.js";
import { OpenAIProvider } from "./OpenAIProvider.js";
import { OllamaProvider } from "./OllamaProvider.js";
import { GeminiProvider } from "./GeminiProvider.js";
import { resolveEnvVars } from "../config/ConfigLoader.js";

export function createProvider(config: ProviderConfig): LLMProvider {
  switch (config.id) {
    case "anthropic":
      return new AnthropicProvider(resolveEnvVars(config.apiKey ?? ""));
    case "openai":
      return new OpenAIProvider({
        id: "openai",
        name: "OpenAI",
        apiKey: resolveEnvVars(config.apiKey ?? ""),
        baseUrl: config.baseUrl,
        defaultModel: "gpt-4o",
      });
    case "groq":
      return new OpenAIProvider({
        id: "groq",
        name: "Groq",
        apiKey: resolveEnvVars(config.apiKey ?? ""),
        baseUrl: config.baseUrl ?? "https://api.groq.com/openai/v1",
        defaultModel: "llama-3.1-70b-versatile",
      });
    case "fireworks":
      return new OpenAIProvider({
        id: "fireworks",
        name: "Fireworks AI",
        apiKey: resolveEnvVars(config.apiKey ?? ""),
        baseUrl: config.baseUrl ?? "https://api.fireworks.ai/inference/v1",
        defaultModel: "accounts/fireworks/models/llama-v3p1-70b-instruct",
      });
    case "lmstudio":
      return new OpenAIProvider({
        id: "lmstudio",
        name: "LM Studio",
        apiKey: config.apiKey ?? "lm-studio",
        baseUrl: config.baseUrl ?? "http://localhost:1234/v1",
        defaultModel: "local-model",
      });
    case "openai-compatible":
      return new OpenAIProvider({
        id: "openai-compatible",
        name: config.id,
        apiKey: resolveEnvVars(config.apiKey ?? ""),
        baseUrl: config.baseUrl,
        defaultModel: "gpt-4o",
      });
    case "ollama":
      return new OllamaProvider(config.baseUrl);
    case "gemini":
      return new GeminiProvider(resolveEnvVars(config.apiKey ?? ""));
    case "deepseek":
      return new OpenAIProvider({
        id: "deepseek",
        name: "DeepSeek",
        apiKey: resolveEnvVars(config.apiKey ?? ""),
        baseUrl: config.baseUrl ?? "https://api.deepseek.com",
        defaultModel: "deepseek-chat",
      });
    case "zai":
      return new OpenAIProvider({
        id: "zai",
        name: "Z.AI",
        apiKey: resolveEnvVars(config.apiKey ?? ""),
        baseUrl: config.baseUrl ?? "https://api.z.ai/v1",
        defaultModel: "glm-5",
      });
    default:
      throw new Error(`Unknown provider: ${config.id}`);
  }
}

export { AnthropicProvider, OpenAIProvider, OllamaProvider, GeminiProvider };
export type { LLMProvider };
