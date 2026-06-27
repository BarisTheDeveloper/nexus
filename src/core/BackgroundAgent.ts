/**
 * BackgroundAgent — runs tasks asynchronously and reports back.
 * Uses execa for process management, supports notifications on completion.
 */

import { execa } from "execa";
import { randomUUID } from "node:crypto";

export interface BackgroundTask {
  id: string;
  command: string;
  description: string;
  startedAt: number;
  status: "running" | "completed" | "failed";
  result?: string;
  completedAt?: number;
}

export class BackgroundAgent {
  private tasks: Map<string, BackgroundTask> = new Map();
  private maxConcurrent = 3;
  private running = 0;
  private queue: Array<() => Promise<void>> = [];

  /**
   * Submit a command to run in the background.
   * Returns task ID for status checking.
   */
  async submit(command: string, description: string): Promise<string> {
    const id = randomUUID().slice(0, 8);
    const task: BackgroundTask = { id, command, description, startedAt: Date.now(), status: "running" };
    this.tasks.set(id, task);

    if (this.running >= this.maxConcurrent) {
      // Queue it
      this.queue.push(async () => {
        await this.executeTask(task);
      });
    } else {
      this.running++;
      this.executeTask(task).finally(() => this.processQueue());
    }

    return id;
  }

  private async executeTask(task: BackgroundTask): Promise<void> {
    try {
      const result = await execa(task.command, { shell: true, timeout: 300_000, reject: false });
      task.status = result.exitCode === 0 ? "completed" : "failed";
      task.result = result.stdout || result.stderr || "No output";
    } catch (error) {
      task.status = "failed";
      task.result = error instanceof Error ? error.message : String(error);
    }
    task.completedAt = Date.now();
  }

  private processQueue(): void {
    const next = this.queue.shift();
    if (next) {
      this.running++;
      next().finally(() => this.processQueue());
    } else {
      this.running--;
    }
  }

  getTask(id: string): BackgroundTask | undefined {
    return this.tasks.get(id);
  }

  listTasks(): BackgroundTask[] {
    return Array.from(this.tasks.values()).sort((a, b) => b.startedAt - a.startedAt);
  }

  getCompletedTasks(): BackgroundTask[] {
    return this.listTasks().filter((t) => t.status !== "running");
  }

  /**
   * Get a summary of all tasks for display.
   */
  getSummary(): string {
    const tasks = this.listTasks();
    if (tasks.length === 0) return "No background tasks.";
    const running = tasks.filter((t) => t.status === "running");
    const completed = tasks.filter((t) => t.status === "completed");
    const failed = tasks.filter((t) => t.status === "failed");
    const lines = [
      `Background Tasks: ${tasks.length} total (${running.length} running, ${completed.length} done, ${failed.length} failed)`,
    ];
    for (const t of tasks.slice(0, 10)) {
      const icon = t.status === "running" ? "⏳" : t.status === "completed" ? "✅" : "❌";
      lines.push(`  ${icon} [${t.id}] ${t.description} (${Math.round((Date.now() - t.startedAt) / 1000)}s)`);
    }
    return lines.join("\n");
  }
}
