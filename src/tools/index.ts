import { ShellTool } from "./ShellTool.js";
import { FileTool } from "./FileTool.js";
import { WebSearchTool } from "./WebSearchTool.js";
import type { ToolResult, CriticReview } from "../config/types.js";
import type { GitHubAgent } from "../core/GitHubAgent.js";
import type { BackgroundAgent } from "../core/BackgroundAgent.js";

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

  constructor(githubAgent?: GitHubAgent, backgroundAgent?: BackgroundAgent) {
    this.register(new ShellToolAdapter(this));
    this.register(new FileToolAdapter());
    this.register(new WebSearchToolAdapter());
    if (githubAgent) this.registerGitHubTools(githubAgent);
    if (backgroundAgent) this.register(new BackgroundToolAdapter(backgroundAgent));
  }

  private registerGitHubTools(gh: GitHubAgent): void {
    this.register(new GitHubPRTool(gh));
    this.register(new GitHubIssueTool(gh));
    this.register(new GitHubCloneTool(gh));
    this.register(new GitHubListIssuesTool(gh));
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

// ── Shell Tool ─────────────────────────────────────────

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

    const reviewer = this.registry.getCommandReviewer();
    if (reviewer) {
      try {
        const review = await reviewer(command);
        if (!review.approved) {
          const severityLabel = review.severity === "danger" ? "🔴 DANGER" :
            review.severity === "warning" ? "🟡 WARNING" : "🔵 INFO";
          return {
            success: false, stdout: "", stderr: "",
            error: `[Critic Review] ${severityLabel}: ${review.reason}\n\nCommand blocked: \`${command}\``,
          };
        }
      } catch (error) {
        return {
          success: false, stdout: "", stderr: "",
          error: `[Critic Review] Critic agent unavailable - command blocked`,
        };
      }
    }

    return this.inner.execute(command);
  }
}

// ── File Tool ──────────────────────────────────────────

class FileToolAdapter implements Tool {
  private inner = new FileTool();
  name = "file_tool";
  description = "Read, write, and list files on the filesystem";

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const action = args["action"] as string;
    const path = args["path"] as string;
    if (!action || !path) return { success: false, stdout: "", stderr: "", error: "Missing 'action' or 'path'" };
    switch (action) {
      case "read": return this.inner.read(path);
      case "write": return this.inner.write(path, (args["content"] as string) ?? "");
      case "list": return this.inner.list(path);
      default: return { success: false, stdout: "", stderr: "", error: `Unknown action: ${action}` };
    }
  }
}

// ── Web Search ─────────────────────────────────────────

class WebSearchToolAdapter implements Tool {
  private inner = new WebSearchTool();
  name = "web_search";
  description = "Search the web for information";
  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const query = args["query"] as string;
    return query ? this.inner.execute(query) : { success: false, stdout: "", stderr: "", error: "Missing 'query'" };
  }
}

// ── GitHub Tools ───────────────────────────────────────

class GitHubPRTool implements Tool {
  name = "github_create_pr";
  description = "Create a Pull Request on GitHub. Pushes current branch and opens PR.";
  constructor(private gh: GitHubAgent) {}
  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const title = (args["title"] as string) || "Automated PR";
    const body = (args["body"] as string) || "Created by Nexus agent";
    const result = await this.gh.pushAndPR(title, body);
    return { success: result.success, stdout: result.message, stderr: "" };
  }
}

class GitHubIssueTool implements Tool {
  name = "github_create_issue";
  description = "Create a GitHub issue. Needs title and optional body, labels, assignees.";
  constructor(private gh: GitHubAgent) {}
  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const title = args["title"] as string;
    if (!title) return { success: false, stdout: "", stderr: "", error: "Missing 'title'" };
    const result = await this.gh.createIssue({
      title,
      body: (args["body"] as string) || "",
      labels: args["labels"] ? (args["labels"] as string).split(",") : undefined,
      assignees: args["assignees"] ? (args["assignees"] as string).split(",") : undefined,
    });
    return { success: result.success, stdout: result.url ?? result.error ?? "", stderr: "" };
  }
}

class GitHubCloneTool implements Tool {
  name = "github_clone";
  description = "Clone a GitHub repository by URL.";
  constructor(private gh: GitHubAgent) {}
  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const url = args["url"] as string;
    if (!url) return { success: false, stdout: "", stderr: "", error: "Missing 'url'" };
    const result = await this.gh.clone(url, args["directory"] as string | undefined);
    return { success: result.success, stdout: result.path, stderr: result.error ?? "" };
  }
}

class GitHubListIssuesTool implements Tool {
  name = "github_list_issues";
  description = "List open GitHub issues in the current repo.";
  constructor(private gh: GitHubAgent) {}
  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const issues = await this.gh.listIssues((args["limit"] as number) ?? 10);
    return { success: true, stdout: issues.join("\n"), stderr: "" };
  }
}

// ── Background Agent Tool ──────────────────────────────

class BackgroundToolAdapter implements Tool {
  name = "background_run";
  description = "Run a command in the background. Returns task ID.";
  constructor(private bg: BackgroundAgent) {}
  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const command = args["command"] as string;
    if (!command) return { success: false, stdout: "", stderr: "", error: "Missing 'command'" };
    const id = await this.bg.submit(command, command.slice(0, 60));
    return { success: true, stdout: `Task [${id}] started`, stderr: "" };
  }
}
