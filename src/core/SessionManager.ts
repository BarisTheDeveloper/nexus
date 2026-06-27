import { randomUUID } from "node:crypto";
import type { SessionMetadata, SessionStatus, AgentMessage } from "../config/types.js";
import type { NexusMemory, StoredSession } from "../memory/ChromaMemory.js";

export class SessionManager {
  private sessions: Map<string, SessionMetadata> = new Map();
  private activeSessionId: string | null = null;
  private memory: NexusMemory | null = null;

  /**
   * Wire up the memory backend for persistence.
   * Call once during Orchestrator initialization.
   */
  setMemory(memory: NexusMemory): void {
    this.memory = memory;
  }

  createSession(): SessionMetadata {
    const session: SessionMetadata = {
      id: randomUUID(),
      startedAt: Date.now(),
      status: "idle",
      messages: [],
      currentSpeaker: null,
    };
    this.sessions.set(session.id, session);
    this.activeSessionId = session.id;

    // Persist to DB
    this.memory?.storeSessionRecord({
      id: session.id,
      summary: null,
      startedAt: session.startedAt,
      endedAt: null,
      messageCount: 0,
    });

    return session;
  }

  /**
   * Resume an existing session from the database.
   * Loads all stored messages and marks the session as active.
   */
  resumeSession(sessionId: string): SessionMetadata | null {
    if (!this.memory) return null;

    const stored = this.memory.getSession(sessionId);
    if (!stored) return null;

    const messages = this.memory.loadSessionMessages(sessionId);

    const session: SessionMetadata = {
      id: stored.id,
      startedAt: stored.startedAt,
      status: "idle",
      messages,
      currentSpeaker: null,
    };

    this.sessions.set(session.id, session);
    this.activeSessionId = session.id;
    return session;
  }

  getActiveSession(): SessionMetadata | null {
    if (this.activeSessionId) {
      return this.sessions.get(this.activeSessionId) ?? null;
    }
    return null;
  }

  getSession(id: string): SessionMetadata | null {
    return this.sessions.get(id) ?? null;
  }

  setStatus(status: SessionStatus): void {
    const session = this.getActiveSession();
    if (session) {
      session.status = status;
      this.sessions.set(session.id, session);
    }
  }

  setCurrentSpeaker(agentId: string | null): void {
    const session = this.getActiveSession();
    if (session) {
      session.currentSpeaker = agentId;
      this.sessions.set(session.id, session);
    }
  }

  addMessage(message: AgentMessage): void {
    const session = this.getActiveSession();
    if (session) {
      session.messages.push(message);
      this.sessions.set(session.id, session);

      // Persist message to DB
      this.memory?.storeSessionMessage(session.id, message);
    }
  }

  endSession(summary?: string): SessionMetadata | null {
    const session = this.getActiveSession();
    if (session) {
      session.status = "complete";

      // Persist final state
      this.memory?.storeSessionRecord({
        id: session.id,
        summary: summary ?? null,
        startedAt: session.startedAt,
        endedAt: Date.now(),
        messageCount: session.messages.length,
      });

      // Persist all messages in batch
      this.memory?.storeSessionMessages(session.id, session.messages);

      this.sessions.set(session.id, session);
      this.activeSessionId = null;
    }
    return session;
  }

  getAllSessions(): SessionMetadata[] {
    return Array.from(this.sessions.values());
  }

  /**
   * Get list of persisted sessions from the database.
   */
  listPersistedSessions(limit: number = 20) {
    return this.memory?.listSessions(limit) ?? [];
  }

  /**
   * Delete a persisted session.
   */
  deletePersistedSession(id: string): boolean {
    if (!this.memory) return false;
    this.memory.deleteSession(id);
    this.sessions.delete(id);
    if (this.activeSessionId === id) {
      this.activeSessionId = null;
    }
    return true;
  }
}
