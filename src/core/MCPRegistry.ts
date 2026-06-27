/**
 * MCP & Skill Registry — bridges external MCP servers and skills
 * into Nexus' tool system so agents can discover and use them.
 */

import { existsSync, readdirSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface MCPToolInfo {
  server: string;
  name: string;
  description: string;
}

export interface SkillInfo {
  name: string;
  description: string;
  category: string;
  path: string;
}

export class MCPRegistry {
  private tools: MCPToolInfo[] = [];
  private skills: SkillInfo[] = [];
  private loaded = false;

  /**
   * Scan for available MCP servers and their tools.
   * Reads from Hermes' config.yaml MCP section.
   */
  load(): void {
    if (this.loaded) return;
    this.loaded = true;

    // Try to read Hermes MCP config
    const hermesConfigPath = join(homedir(), ".hermes", "config.yaml");
    if (existsSync(hermesConfigPath)) {
      try {
        const raw = readFileSync(hermesConfigPath, "utf-8");
        this.parseMCPConfig(raw);
      } catch {
        // Config unreadable, skip
      }
    }

    // Always add known local MCPs as fallback
    this.addBuiltinMCPs();
  }

  private parseMCPConfig(raw: string): void {
    // Simple YAML parsing for mcp_servers section
    const mcpMatch = raw.match(/mcp_servers:\s*\n([\s\S]*?)(?:\n\w|$)/);
    if (!mcpMatch) return;

    // We don't need to parse the full config — just detect which servers exist
    // by checking for server names in the config
    const serverNames = ["pc-control", "clipboard", "computer-control-mcp", "weather", "roblox-studio"];
    for (const name of serverNames) {
      if (raw.includes(name)) {
        this.registerMCPServer(name);
      }
    }
  }

  private addBuiltinMCPs(): void {
    // Check common MCP paths
    const knownServers: Array<{ name: string; tools: MCPToolInfo[] }> = [
      {
        name: "pc-control",
        tools: [
          { server: "pc-control", name: "screen_take_screenshot", description: "Take a screenshot of the primary monitor" },
          { server: "pc-control", name: "system_execute_command", description: "Execute a shell command on the host" },
          { server: "pc-control", name: "system_get_status", description: "Get CPU, Memory, Disk usage" },
          { server: "pc-control", name: "system_launch_app", description: "Launch an application by name or path" },
        ],
      },
      {
        name: "clipboard",
        tools: [
          { server: "clipboard", name: "clipboard_copy", description: "Copy text to system clipboard" },
          { server: "clipboard", name: "clipboard_paste", description: "Paste from system clipboard" },
        ],
      },
      {
        name: "weather",
        tools: [
          { server: "weather", name: "get_current_weather", description: "Get current weather for a city" },
          { server: "weather", name: "get_air_quality", description: "Get air quality for a city" },
        ],
      },
    ];

    for (const server of knownServers) {
      if (!this.tools.some((t) => t.server === server.name)) {
        this.tools.push(...server.tools);
      }
    }
  }

  private registerMCPServer(name: string): void {
    // Already registered
    if (this.tools.some((t) => t.server === name)) return;
    this.tools.push({ server: name, name: `${name}:*`, description: `MCP server: ${name}` });
  }

  /**
   * Get all known MCP tools for agent discovery.
   */
  getTools(): MCPToolInfo[] {
    this.load();
    return [...this.tools];
  }

  /**
   * Get a summary string for agent prompts.
   */
  getAgentContext(): string {
    this.load();
    if (this.tools.length === 0) return "";
    const byServer = new Map<string, MCPToolInfo[]>();
    for (const t of this.tools) {
      const list = byServer.get(t.server) ?? [];
      list.push(t);
      byServer.set(t.server, list);
    }
    const lines: string[] = ["Available MCP servers:"];
    for (const [server, tools] of Array.from(byServer)) {
      lines.push(`  ${server} (${tools.length} tools)`);
    }
    lines.push("To use: call the tool by name. Ask before using destructive ones.");
    return lines.join("\n");
  }

  // ─── Skills ──────────────────────────────────────────

  /**
   * Scan for available skills from .nexus/skills/ directory.
   */
  loadSkills(): SkillInfo[] {
    const skillsDir = join(homedir(), ".nexus", "skills");
    if (!existsSync(skillsDir)) {
      mkdirSync(skillsDir, { recursive: true });
      return [];
    }

    const entries = readdirSync(skillsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const skillPath = join(skillsDir, entry.name);
        const skillFile = join(skillPath, "SKILL.md");
        if (existsSync(skillFile)) {
          try {
            const raw = readFileSync(skillFile, "utf-8");
            const name = entry.name;
            const desc = raw.split("\n").find((l) => l.startsWith("description:"))?.replace("description:", "").trim() ?? "No description";
            const category = raw.split("\n").find((l) => l.startsWith("category:"))?.replace("category:", "").trim() ?? "general";
            if (!this.skills.some((s) => s.name === name)) {
              this.skills.push({ name, description: desc, category, path: skillPath });
            }
          } catch {
            // Skip unreadable skills
          }
        }
      }
    }

    return [...this.skills];
  }

  /**
   * Create a new skill from a description. Agents can call this.
   */
  createSkill(name: string, description: string, category: string, content: string): string {
    const skillsDir = join(homedir(), ".nexus", "skills");
    mkdirSync(skillsDir, { recursive: true });
    const skillDir = join(skillsDir, name);
    mkdirSync(skillDir, { recursive: true });

    const skillFile = join(skillDir, "SKILL.md");
    const markdown = [
      "---",
      `name: ${name}`,
      `description: ${description}`,
      `category: ${category}`,
      "---",
      "",
      content,
    ].join("\n");

    writeFileSync(skillFile, markdown, "utf-8");
    this.skills.push({ name, description, category, path: skillDir });
    return skillFile;
  }

  getSkills(): SkillInfo[] {
    this.loadSkills();
    return [...this.skills];
  }

  getSkillsContext(): string {
    const skills = this.getSkills();
    if (skills.length === 0) return "";
    return [
      "Available skills:",
      ...skills.map((s) => `  ${s.name} — ${s.description}`),
      "To create a skill, write a SKILL.md file in ~/.nexus/skills/<name>/",
    ].join("\n");
  }
}
