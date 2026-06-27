/**
 * AgentWorkspace — shared state for multi-agent coordination.
 * Tracks file operations, agent locks, and inter-agent messages
 * to prevent conflicts when multiple agents work on the same task.
 */

export interface FileEntry {
  path: string;
  agentId: string;
  action: "read" | "write" | "create";
  timestamp: number;
  content?: string;
}

export interface AgentNote {
  from: string;
  to?: string; // undefined = broadcast
  message: string;
  timestamp: number;
}

export interface WorkspaceState {
  files: FileEntry[];
  notes: AgentNote[];
  locks: Map<string, string>; // path → agentId
}

export class AgentWorkspace {
  private files: FileEntry[] = [];
  private notes: AgentNote[] = [];
  private locks: Map<string, string> = new Map();

  /**
   * Track a file operation by an agent.
   * Returns a warning if another agent already modified this file.
   */
  trackFile(agentId: string, path: string, action: FileEntry["action"], content?: string): string | null {
    // Normalize path
    const normalized = path.replace(/\\/g, "/");

    // Check for conflicts
    const existing = this.files.find((f) => f.path === normalized);
    if (existing && existing.agentId !== agentId && existing.action === "write") {
      const warning = `⚠️ File "${normalized}" was previously modified by [${existing.agentId}] at ${new Date(existing.timestamp).toLocaleTimeString()}. Coordinate to avoid overwriting.`;
      this.addNote("system", agentId, warning);
      this.files.push({ path: normalized, agentId, action, timestamp: Date.now(), content });
      return warning;
    }

    this.files.push({ path: normalized, agentId, action, timestamp: Date.now(), content });
    return null;
  }

  /**
   * Lock a file for exclusive access by an agent.
   * Returns true if lock acquired, false if already locked by another agent.
   */
  lockFile(agentId: string, path: string): boolean {
    const normalized = path.replace(/\\/g, "/");
    const existing = this.locks.get(normalized);
    if (existing && existing !== agentId) {
      this.addNote("system", agentId, `🔒 File "${normalized}" is locked by [${existing}]`);
      return false;
    }
    this.locks.set(normalized, agentId);
    return true;
  }

  /**
   * Release a file lock.
   */
  unlockFile(agentId: string, path: string): void {
    const normalized = path.replace(/\\/g, "/");
    if (this.locks.get(normalized) === agentId) {
      this.locks.delete(normalized);
    }
  }

  /**
   * Add a note/message (agent-to-agent or broadcast).
   */
  addNote(from: string, to: string | undefined, message: string): void {
    this.notes.push({ from, to, message, timestamp: Date.now() });
    // Keep only last 100 notes
    if (this.notes.length > 100) {
      this.notes = this.notes.slice(-100);
    }
  }

  /**
   * Get all notes visible to a specific agent.
   */
  getNotesFor(agentId: string): AgentNote[] {
    return this.notes.filter((n) => !n.to || n.to === agentId || n.to === "all");
  }

  /**
   * Get all broadcast notes.
   */
  getBroadcastNotes(): AgentNote[] {
    return this.notes.filter((n) => !n.to || n.to === "all");
  }

  /**
   * Get a summary of all files touched in this session.
   */
  getFileSummary(): string {
    if (this.files.length === 0) return "No files modified.";
    const byAgent = new Map<string, FileEntry[]>();
    for (const f of this.files) {
      const list = byAgent.get(f.agentId) ?? [];
      list.push(f);
      byAgent.set(f.agentId, list);
    }
    const lines: string[] = [];
    for (const [agentId, entries] of Array.from(byAgent)) {
      const files = Array.from(new Set(entries.map((e) => e.path)));
      lines.push(`  [${agentId}]: ${files.join(", ")}`);
    }
    return lines.join("\n");
  }

  /**
   * Get workspace context for an agent's system prompt.
   */
  getContextFor(agentId: string): string {
    const parts: string[] = [];

    // File awareness
    if (this.files.length > 0) {
      const otherFiles = this.files.filter((f) => f.agentId !== agentId);
      if (otherFiles.length > 0) {
        const fileList = Array.from(new Set(otherFiles.map((f) => `${f.path} (by ${f.agentId})`)));
        parts.push(`[WORKSPACE FILES]\nOther agents have touched these files:\n${fileList.map((f) => `  • ${f}`).join("\n")}\nAvoid overwriting without coordination.`);
      }
    }

    // Recent notes
    const agentNotes = this.getNotesFor(agentId).slice(-10);
    if (agentNotes.length > 0) {
      parts.push(`[WORKSPACE NOTES]\n${agentNotes.map((n) => `  [${n.from}] → ${n.to ?? "all"}: ${n.message.slice(0, 200)}`).join("\n")}`);
    }

    // Locks
    const relevantLocks: string[] = [];
    for (const [path, owner] of Array.from(this.locks)) {
      if (owner !== agentId) {
        relevantLocks.push(`  🔒 ${path} (locked by ${owner})`);
      }
    }
    if (relevantLocks.length > 0) {
      parts.push(`[FILE LOCKS]\n${relevantLocks.join("\n")}`);
    }

    return parts.length > 0 ? parts.join("\n\n") : "";
  }

  /**
   * Reset workspace for a new session.
   */
  reset(): void {
    this.files = [];
    this.notes = [];
    this.locks.clear();
  }
}
