import { ShellTool } from "./ShellTool.js";
import { FileTool } from "./FileTool.js";
import { WebSearchTool } from "./WebSearchTool.js";
import type { ToolResult, CriticReview } from "../config/types.js";

export interface Tool {
  name: string;
  description: string;
  execute(args: Record<string, unknown>): Promise<ToolResult>;
}

export type CommandReviewer = (command: string) => Promise<CriticReview>;

export class ToolRegistry {
  private tools: Map<string, Tool> = new Map();
  private commandReviewer: CommandReviewer | null = null;
  private criticEnabled: boolean = true;

  constructor() {
    this.register(new ShellToolAdapter(this));
    this.register(new FileToolAdapter());
    this.register(new WebSearchToolAdapter());
  }

  setCommandReviewer(reviewer: CommandReviewer | null): void {
    this.commandReviewer = reviewer;
  }

  setCriticEnabled(enabled: boolean): void {
    this.criticEnabled = enabled;
  }

  register(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  list(): Tool[] {
    return Array.from(this.tools.values());
  }

  getCommandReviewer(): CommandReviewer | null {
    return this.criticEnabled ? this.commandReviewer : null;
  }
}

class ShellToolAdapter implements Tool {
  private inner = new ShellTool();
  private registry: ToolRegistry;
  name = "shell_exec";
  description = "Execute shell commands (with optional safety review)";

  constructor(registry: ToolRegistry) {
    this.registry = registry;
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const command = args["command"] as string;
    if (!command) {
      return { success: false, stdout: "", stderr: "", error: "Missing 'command' argument" };
    }

    // Check with the Critic before executing
    const reviewer = this.registry.getCommandReviewer();
    if (reviewer) {
      try {
        const review = await reviewer(command);
        if (!review.approved) {
          const severityLabel = review.severity === "danger" ? "🔴 DANGER" :
            review.severity === "warning" ? "🟡 WARNING" : "🔵 INFO";
          return {
            success: false,
            stdout: "",
            stderr: "",
            error: `[Critic Review] ${severityLabel}: ${review.reason}\n\nCommand blocked: \`${command}\`\n\nTo disable critic approval, set criticApproval: false in ~/.nexus/config.yaml`,
          };
        }
      } catch (error) {
        // Critic unavailable - block by default for safety
        return {
          success: false,
          stdout: "",
          stderr: "",
          error: `[Critic Review] Critic agent unavailable - command blocked for safety: ${error instanceof Error ? error.message : String(error)}\n\nCommand: \`${command}\`\n\nTo disable critic approval, set criticApproval: false in ~/.nexus/config.yaml`,
        };
      }
    }

    return this.inner.execute(command);
  }
}

class WebSearchToolAdapter implements Tool {
  private inner = new WebSearchTool();
  name = "web_search";
  description = "Search the web for information";

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const query = args["query"] as string;
    if (!query) {
      return { success: false, stdout: "", stderr: "", error: "Missing 'query' argument" };
    }
    return this.inner.execute(query);
  }
}

class FileToolAdapter implements Tool {
  private inner = new FileTool();
  name = "file_tool";
  description = "Read, write, and list files on the filesystem";

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const action = args["action"] as string;
    const path = args["path"] as string;

    if (!action || !path) {
      return { success: false, stdout: "", stderr: "", error: "Missing 'action' or 'path' argument" };
    }

    switch (action) {
      case "read":
        return this.inner.read(path);
      case "write":
        return this.inner.write(path, args["content"] as string ?? "");
      case "list":
        return this.inner.list(path);
      default:
        return { success: false, stdout: "", stderr: "", error: `Unknown action: ${action}` };
    }
  }
}
