import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import type { NexusConfig, AgentConfig, ProviderConfig } from "./types.js";

const NEXUS_DIR = join(homedir(), ".nexus");
const CONFIG_PATH = join(NEXUS_DIR, "config.yaml");
const AGENTS_PATH = join(NEXUS_DIR, "agents.yaml");

const DEFAULT_CONFIG: NexusConfig = {
  providers: [
    { id: "deepseek", apiKey: "placeholder" },
  ],
  defaultProvider: "deepseek",
  defaultModel: "deepseek-chat",
  memoryPath: join(NEXUS_DIR, "memory.db"),
  criticApproval: true,
};

export function ensureNexusDir(): void {
  if (!existsSync(NEXUS_DIR)) {
    mkdirSync(NEXUS_DIR, { recursive: true });
  }
}

export function loadConfig(): NexusConfig {
  ensureNexusDir();
  if (!existsSync(CONFIG_PATH)) {
    writeFileSync(CONFIG_PATH, stringify(DEFAULT_CONFIG), "utf-8");
    return { ...DEFAULT_CONFIG };
  }
  const raw = readFileSync(CONFIG_PATH, "utf-8");
  const parsed = parse(raw) as NexusConfig;
  return { ...DEFAULT_CONFIG, ...parsed };
}

export function saveConfig(config: NexusConfig): void {
  ensureNexusDir();
  writeFileSync(CONFIG_PATH, stringify(config), "utf-8");
}

/**
 * Add a provider to the config file. Returns true if added, false if ID exists.
 */
export function addProviderToConfig(provider: ProviderConfig): boolean {
  const config = loadConfig();
  const existing = config.providers.findIndex((p) => p.id === provider.id);
  if (existing >= 0) {
    // Update existing
    config.providers[existing] = provider;
  } else {
    config.providers.push(provider);
  }
  // Auto-set as default if it's the first
  if (!config.defaultProvider || config.providers.length === 1) {
    config.defaultProvider = provider.id;
  }
  saveConfig(config);
  return true;
}

/**
 * Remove a provider from the config file by ID.
 */
export function removeProviderFromConfig(providerId: string): boolean {
  const config = loadConfig();
  const idx = config.providers.findIndex((p) => p.id === providerId);
  if (idx < 0) return false;
  config.providers.splice(idx, 1);
  if (config.defaultProvider === providerId) {
    config.defaultProvider = config.providers[0]?.id;
  }
  saveConfig(config);
  return true;
}

export function loadCustomAgents(): AgentConfig[] {
  ensureNexusDir();
  if (!existsSync(AGENTS_PATH)) {
    return [];
  }
  const raw = readFileSync(AGENTS_PATH, "utf-8");
  const parsed = parse(raw) as { agents?: AgentConfig[] };
  return parsed.agents ?? [];
}

export function saveCustomAgents(agents: AgentConfig[]): void {
  ensureNexusDir();
  writeFileSync(AGENTS_PATH, stringify({ agents }), "utf-8");
}

export function resolveEnvVars(value: string): string {
  return value.replace(/\$\{(\w+)\}/g, (_, key) => process.env[key] ?? "");
}
