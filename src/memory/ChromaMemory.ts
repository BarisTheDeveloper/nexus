import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { EmbeddingService } from "./EmbeddingService.js";
import type { MemoryEntry, AgentMessage } from "../config/types.js";

const DEFAULT_DB_PATH = join(homedir(), ".nexus", "memory.db");

export interface StoredSession {
  id: string;
  summary: string | null;
  startedAt: number;
  endedAt: number | null;
  messageCount: number;
}

export interface SessionListItem {
  id: string;
  number: number;
  summary: string | null;
  startedAt: number;
  messageCount: number;
  preview: string;
}

export class NexusMemory {
  private db: Database.Database;
  private embedder: EmbeddingService;
  private dbPath: string;

  constructor(dbPath?: string) {
    this.dbPath = dbPath ?? DEFAULT_DB_PATH;
    this.embedder = new EmbeddingService();

    const dir = join(homedir(), ".nexus");
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(this.dbPath);
    this.db.exec("PRAGMA journal_mode=WAL");
    this.initializeSchema();
  }

  private initializeSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        content TEXT NOT NULL,
        metadata TEXT DEFAULT '{}',
        timestamp INTEGER NOT NULL,
        embedding BLOB
      );

      CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type);
      CREATE INDEX IF NOT EXISTS idx_memories_timestamp ON memories(timestamp);

      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        summary TEXT,
        started_at INTEGER NOT NULL,
        ended_at INTEGER,
        message_count INTEGER DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS idx_sessions_started ON sessions(started_at);

      CREATE TABLE IF NOT EXISTS session_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_session_msgs ON session_messages(session_id);
    `);
  }

  // ─── Memory (embedding-based) ────────────────────────────

  async store(entry: MemoryEntry): Promise<void> {
    const embedding = entry.embedding ?? await this.embedder.embed(entry.content);

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO memories (id, type, content, metadata, timestamp, embedding)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      entry.id,
      entry.type,
      entry.content,
      JSON.stringify(entry.metadata),
      entry.timestamp,
      Buffer.from(embedding.buffer),
    );
  }

  async query(text: string, topK: number = 5, type?: string): Promise<MemoryEntry[]> {
    const queryEmbedding = await this.embedder.embed(text);

    let rows: Array<{
      id: string;
      type: string;
      content: string;
      metadata: string;
      timestamp: number;
      embedding: Buffer | null;
    }>;

    if (type) {
      rows = this.db.prepare(
        "SELECT * FROM memories WHERE type = ? ORDER BY timestamp DESC LIMIT 100"
      ).all(type) as typeof rows;
    } else {
      rows = this.db.prepare(
        "SELECT * FROM memories ORDER BY timestamp DESC LIMIT 100"
      ).all() as typeof rows;
    }

    const scored: Array<{ entry: MemoryEntry; score: number }> = [];

    for (const row of rows) {
      let score = 0;
      if (row.embedding) {
        const emb = new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.byteLength / 4);
        score = this.embedder.cosineSimilarity(queryEmbedding, emb);
      } else {
        const words = text.toLowerCase().split(/\W+/).filter(Boolean);
        const contentWords = row.content.toLowerCase().split(/\W+/).filter(Boolean);
        score = words.filter((w) => contentWords.includes(w)).length / Math.max(words.length, 1);
      }

      scored.push({
        entry: {
          id: row.id,
          type: row.type as MemoryEntry["type"],
          content: row.content,
          metadata: JSON.parse(row.metadata || "{}"),
          timestamp: row.timestamp,
        },
        score,
      });
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK).map((s) => s.entry);
  }

  async searchByType(type: string, limit: number = 20): Promise<MemoryEntry[]> {
    const rows = this.db.prepare(
      "SELECT * FROM memories WHERE type = ? ORDER BY timestamp DESC LIMIT ?"
    ).all(type, limit) as Array<{
      id: string;
      type: string;
      content: string;
      metadata: string;
      timestamp: number;
    }>;

    return rows.map((row) => ({
      id: row.id,
      type: row.type as MemoryEntry["type"],
      content: row.content,
      metadata: JSON.parse(row.metadata || "{}"),
      timestamp: row.timestamp,
    }));
  }

  async delete(id: string): Promise<void> {
    this.db.prepare("DELETE FROM memories WHERE id = ?").run(id);
  }

  async clear(): Promise<void> {
    this.db.exec("DELETE FROM memories");
  }

  // ─── Session persistence ─────────────────────────────────

  /**
   * Store a session record. Creates or updates.
   */
  storeSessionRecord(session: StoredSession): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO sessions (id, summary, started_at, ended_at, message_count)
      VALUES (?, ?, ?, ?, ?)
    `).run(session.id, session.summary ?? null, session.startedAt, session.endedAt ?? null, session.messageCount);
  }

  /**
   * Store a single message for a session.
   */
  storeSessionMessage(sessionId: string, msg: AgentMessage): void {
    this.db.prepare(`
      INSERT INTO session_messages (session_id, agent_id, role, content, timestamp)
      VALUES (?, ?, ?, ?, ?)
    `).run(sessionId, msg.agentId, msg.role, msg.content, msg.timestamp);
  }

  /**
   * Store multiple messages in a batch (single transaction).
   */
  storeSessionMessages(sessionId: string, messages: AgentMessage[]): void {
    const insert = this.db.prepare(`
      INSERT INTO session_messages (session_id, agent_id, role, content, timestamp)
      VALUES (?, ?, ?, ?, ?)
    `);

    const tx = this.db.transaction(() => {
      // Clear old messages for this session first
      this.db.prepare("DELETE FROM session_messages WHERE session_id = ?").run(sessionId);
      for (const msg of messages) {
        insert.run(sessionId, msg.agentId, msg.role, msg.content, msg.timestamp);
      }
    });

    tx();
  }

  /**
   * Load all messages for a session, ordered by timestamp.
   */
  loadSessionMessages(sessionId: string): AgentMessage[] {
    const rows = this.db.prepare(
      "SELECT agent_id, role, content, timestamp FROM session_messages WHERE session_id = ? ORDER BY timestamp ASC"
    ).all(sessionId) as Array<{
      agent_id: string;
      role: string;
      content: string;
      timestamp: number;
    }>;

    return rows.map((r) => ({
      agentId: r.agent_id,
      role: r.role as AgentMessage["role"],
      content: r.content,
      timestamp: r.timestamp,
    }));
  }

  /**
   * Get a session record by ID.
   */
  getSession(id: string): StoredSession | null {
    const row = this.db.prepare(
      "SELECT * FROM sessions WHERE id = ?"
    ).get(id) as {
      id: string;
      summary: string | null;
      started_at: number;
      ended_at: number | null;
      message_count: number;
    } | undefined;

    if (!row) return null;

    return {
      id: row.id,
      summary: row.summary,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      messageCount: row.message_count,
    };
  }

  /**
   * List all sessions ordered by most recent first.
   * Each item includes a short content preview from the first user message.
   */
  listSessions(limit: number = 20): SessionListItem[] {
    const rows = this.db.prepare(
      "SELECT * FROM sessions ORDER BY started_at DESC LIMIT ?"
    ).all(limit) as Array<{
      id: string;
      summary: string | null;
      started_at: number;
      ended_at: number | null;
      message_count: number;
    }>;

    return rows.map((row, index) => {
      // Get first user message as preview
      const firstMsg = this.db.prepare(
        "SELECT content FROM session_messages WHERE session_id = ? AND agent_id = 'user' ORDER BY timestamp ASC LIMIT 1"
      ).get(row.id) as { content: string } | undefined;

      return {
        id: row.id,
        number: rows.length - index,  // 1-based, newest=1
        summary: row.summary,
        startedAt: row.started_at,
        messageCount: row.message_count,
        preview: firstMsg?.content.slice(0, 120) ?? "(no messages)",
      };
    });
  }

  /**
   * Delete a session and all its messages.
   */
  deleteSession(id: string): void {
    const tx = this.db.transaction(() => {
      this.db.prepare("DELETE FROM session_messages WHERE session_id = ?").run(id);
      this.db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
    });
    tx();
  }

  /**
   * Get total session count.
   */
  sessionCount(): number {
    const row = this.db.prepare("SELECT COUNT(*) as cnt FROM sessions").get() as { cnt: number };
    return row.cnt;
  }

  // ─── Legacy session store (kept for backward compat) ─────

  async storeSession(id: string, summary?: string): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO sessions (id, summary, started_at, ended_at, message_count)
      VALUES (?, ?, ?, ?, ?)
    `);
    stmt.run(id, summary ?? "", Date.now(), Date.now(), 0);
  }

  async close(): Promise<void> {
    this.db.close();
  }
}
