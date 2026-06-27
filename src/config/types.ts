// ─── Message ───────────────────────────────────────────────
export interface Message {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
}

// ─── Provider ──────────────────────────────────────────────
export interface ProviderConfig {
  id: string;
  apiKey?: string;
  baseUrl?: string;
}

// ─── Agent ─────────────────────────────────────────────────
export type Capability =
  | "coding"
  | "thinking"
  | "command_execution"
  | "computer_control"
  | "research"
  | "summarization"
  | "criticism";

export interface AgentConfig {
  id: string;
  name: string;
  role: string;
  provider: string;
  model: string;
  systemPrompt: string;
  capabilities: Capability[];
  priority: number;
}

export interface AgentMessage {
  agentId: string;
  role: "speaker" | "listener" | "interjection";
  content: string;
  timestamp: number;
  tokensUsed?: number;
  elapsedMs?: number;
}

// ─── Panel / Orchestrator ──────────────────────────────────
export type SessionStatus = "idle" | "analyzing" | "running" | "awaiting_input" | "complete" | "error";

export interface SessionMetadata {
  id: string;
  startedAt: number;
  status: SessionStatus;
  messages: AgentMessage[];
  currentSpeaker: string | null;
}

// ─── Memory / Profile ──────────────────────────────────────
export interface UserProfile {
  language: string;
  preferredProviders: string[];
  preferredModels: Record<string, string>;
  responseStyle: "short" | "detailed" | "technical";
  projectContexts: ProjectContext[];
  shortcuts: Record<string, string>;
}

export interface ProjectContext {
  path: string;
  description: string;
  techStack: string[];
  lastAccessed: number;
}

export interface MemoryEntry {
  id: string;
  type: "episodic" | "semantic" | "code_snippet";
  content: string;
  metadata: Record<string, unknown>;
  timestamp: number;
  embedding?: Float32Array;
}

// ─── Tools ─────────────────────────────────────────────────
export interface ToolResult {
  success: boolean;
  stdout: string;
  stderr: string;
  error?: string;
}

// ─── Config File Structure ─────────────────────────────────
export interface NexusConfig {
  providers: ProviderConfig[];
  defaultProvider?: string;
  defaultModel?: string;
  memoryPath?: string;
  criticApproval?: boolean;
}

// ─── Critic Review ─────────────────────────────────────────
export type CriticReview = {
  approved: true;
} | {
  approved: false;
  reason: string;
  severity: "info" | "warning" | "danger";
};
