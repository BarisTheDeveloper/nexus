/**
 * CostTracker — estimates and tracks API costs per session and agent.
 * Uses approximate pricing per 1K tokens.
 */

interface CostEntry {
  agentId: string;
  model: string;
  tokens: number;
  cost: number;
  timestamp: number;
}

// Approximate pricing per 1K tokens (input+output blended)
const PRICING: Record<string, number> = {
  "deepseek-chat": 0.00027,
  "deepseek-v4-flash": 0.00014,
  "deepseek-v4-pro": 0.00055,
  "gpt-4o": 0.005,
  "gpt-4o-mini": 0.0006,
  "claude-sonnet-4": 0.003,
  "claude-3-5-sonnet": 0.003,
  "gemini-1.5-pro": 0.0035,
  "gemini-1.5-flash": 0.00015,
  "llama3.2": 0,
  default: 0.001,
};

export class CostTracker {
  private entries: CostEntry[] = [];
  private sessionStart = Date.now();

  track(agentId: string, model: string, tokens: number): void {
    const pricePer1K = PRICING[model] ?? PRICING["default"]!;
    const cost = (tokens / 1000) * pricePer1K;
    this.entries.push({ agentId, model, tokens, cost: Math.round(cost * 10000) / 10000, timestamp: Date.now() });
  }

  getSessionCost(): number {
    return Math.round(this.entries.reduce((sum, e) => sum + e.cost, 0) * 10000) / 10000;
  }

  getByAgent(): Array<{ agentId: string; tokens: number; cost: number }> {
    const map = new Map<string, { tokens: number; cost: number }>();
    for (const e of this.entries) {
      const cur = map.get(e.agentId) ?? { tokens: 0, cost: 0 };
      cur.tokens += e.tokens;
      cur.cost += e.cost;
      map.set(e.agentId, cur);
    }
    return Array.from(map).map(([agentId, v]) => ({ agentId, tokens: v.tokens, cost: Math.round(v.cost * 10000) / 10000 }));
  }

  getSummary(): string {
    const total = this.getSessionCost();
    const byAgent = this.getByAgent();
    const lines = [`Session cost: $${total.toFixed(4)}`, `Duration: ${Math.round((Date.now() - this.sessionStart) / 1000)}s`, ""];
    for (const a of byAgent) {
      lines.push(`  ${a.agentId}: ${a.tokens} tok / $${a.cost.toFixed(4)}`);
    }
    return lines.join("\n");
  }

  reset(): void {
    this.entries = [];
    this.sessionStart = Date.now();
  }
}
