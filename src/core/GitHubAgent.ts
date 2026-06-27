/**
 * GitHubAgent — GitHub operations: clone, PR, issue, push.
 * Uses gh CLI when available, falls back to git commands.
 */

import { execa } from "execa";
import { existsSync } from "node:fs";

export interface GitHubRepo {
  owner: string;
  name: string;
  url: string;
  clonePath?: string;
}

export interface PROptions {
  title: string;
  body: string;
  base?: string;
  head?: string;
  draft?: boolean;
}

export interface IssueOptions {
  title: string;
  body: string;
  labels?: string[];
  assignees?: string[];
}

export class GitHubAgent {
  private ghAvailable: boolean | null = null;

  async isGHAvailable(): Promise<boolean> {
    if (this.ghAvailable !== null) return this.ghAvailable;
    try {
      await execa("gh", ["--version"], { reject: true });
      this.ghAvailable = true;
    } catch {
      this.ghAvailable = false;
    }
    return this.ghAvailable;
  }

  /**
   * Clone a GitHub repository.
   */
  async clone(url: string, targetDir?: string): Promise<{ success: boolean; path: string; error?: string }> {
    try {
      const dir = targetDir ?? url.split("/").pop()?.replace(".git", "") ?? "repo";
      if (existsSync(dir)) {
        return { success: false, path: dir, error: `Directory ${dir} already exists` };
      }
      await execa("git", ["clone", url, dir], { timeout: 120_000 });
      return { success: true, path: dir };
    } catch (error) {
      return { success: false, path: "", error: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * Create a Pull Request using gh CLI.
   */
  async createPR(options: PROptions): Promise<{ success: boolean; url?: string; error?: string }> {
    if (!(await this.isGHAvailable())) {
      return { success: false, error: "GitHub CLI (gh) not installed. Run: winget install GitHub.cli" };
    }
    try {
      const args = ["pr", "create", "--title", options.title, "--body", options.body];
      if (options.base) args.push("--base", options.base);
      if (options.head) args.push("--head", options.head);
      if (options.draft) args.push("--draft");
      const result = await execa("gh", args, { timeout: 30_000 });
      return { success: true, url: result.stdout.trim() };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * Create an issue.
   */
  async createIssue(options: IssueOptions): Promise<{ success: boolean; url?: string; error?: string }> {
    if (!(await this.isGHAvailable())) {
      return { success: false, error: "gh CLI not installed" };
    }
    try {
      const args = ["issue", "create", "--title", options.title, "--body", options.body];
      if (options.labels) args.push("--label", options.labels.join(","));
      if (options.assignees) args.push("--assignee", options.assignees.join(","));
      const result = await execa("gh", args, { timeout: 30_000 });
      return { success: true, url: result.stdout.trim() };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * Get current repo info.
   */
  async getCurrentRepo(): Promise<GitHubRepo | null> {
    try {
      const result = await execa("gh", ["repo", "view", "--json", "name,owner,url"], { timeout: 10_000 });
      const data = JSON.parse(result.stdout) as { name: string; owner: { login: string }; url: string };
      return { name: data.name, owner: data.owner.login, url: data.url };
    } catch {
      return null;
    }
  }

  /**
   * List open issues.
   */
  async listIssues(limit: number = 10): Promise<string[]> {
    if (!(await this.isGHAvailable())) return ["gh CLI not available"];
    try {
      const result = await execa("gh", ["issue", "list", "--limit", String(limit), "--json", "title,number,state"], { timeout: 15_000 });
      const issues = JSON.parse(result.stdout) as Array<{ number: number; title: string; state: string }>;
      return issues.map((i) => `  #${i.number} [${i.state}] ${i.title}`);
    } catch {
      return ["Failed to list issues"];
    }
  }

  /**
   * Push current branch and create PR in one flow.
   */
  async pushAndPR(title: string, body: string): Promise<{ success: boolean; message: string }> {
    try {
      // Push
      await execa("git", ["push", "-u", "origin", "HEAD"], { timeout: 30_000 });
      // Create PR
      const pr = await this.createPR({ title, body });
      if (pr.success) {
        return { success: true, message: `Pushed and created PR: ${pr.url}` };
      }
      return { success: true, message: `Pushed, but PR creation failed: ${pr.error}` };
    } catch (error) {
      return { success: false, message: error instanceof Error ? error.message : String(error) };
    }
  }
}
