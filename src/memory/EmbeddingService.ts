/**
 * Embedding service with Ollama nomic-embed-text as primary backend,
 * falling back to hash-based bag-of-words for offline/no-Ollama scenarios.
 */

export interface EmbeddingConfig {
  /** Ollama base URL (default: http://localhost:11434) */
  ollamaUrl?: string;
  /** Embedding model name (default: nomic-embed-text) */
  model?: string;
  /** Embedding dimension (default: 768 for nomic-embed-text, 384 for hash) */
  dimension?: number;
}

export class EmbeddingService {
  private dimension: number;
  private ollamaUrl: string;
  private model: string;
  private ollamaAvailable: boolean | null = null;

  constructor(config?: EmbeddingConfig) {
    this.ollamaUrl = config?.ollamaUrl ?? "http://localhost:11434";
    this.model = config?.model ?? "nomic-embed-text";
    this.dimension = config?.dimension ?? 768;
  }

  /**
   * Check if Ollama is reachable and has the embedding model.
   * Result is cached after first check.
   */
  async isOllamaAvailable(): Promise<boolean> {
    if (this.ollamaAvailable !== null) return this.ollamaAvailable;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);

      const resp = await fetch(`${this.ollamaUrl}/api/tags`, {
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!resp.ok) {
        this.ollamaAvailable = false;
        return false;
      }

      const data = await resp.json() as { models?: Array<{ name: string }> };
      const hasModel = data.models?.some(
        (m) => m.name.startsWith(this.model)
      ) ?? false;

      this.ollamaAvailable = hasModel;
      return hasModel;
    } catch {
      this.ollamaAvailable = false;
      return false;
    }
  }

  /**
   * Generate embedding vector from text.
   * Uses Ollama if available, otherwise hash-based fallback.
   */
  async embed(text: string): Promise<Float32Array> {
    const available = await this.isOllamaAvailable();

    if (available) {
      return this.embedOllama(text);
    }

    return this.embedHash(text);
  }

  /**
   * Generate embeddings for multiple texts (batch Ollama or sequential hash).
   */
  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    const available = await this.isOllamaAvailable();

    if (available) {
      // Ollama supports batch embedding
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);

      try {
        const resp = await fetch(`${this.ollamaUrl}/api/embed`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: this.model, input: texts }),
          signal: controller.signal,
        });
        clearTimeout(timeout);

        if (resp.ok) {
          const data = await resp.json() as { embeddings?: number[][] };
          if (data.embeddings) {
            return data.embeddings.map((e) => new Float32Array(e));
          }
        }
      } catch {
        // Fall through to hash
      }
    }

    return Promise.all(texts.map((t) => this.embedHash(t)));
  }

  /**
   * Compute cosine similarity between two vectors.
   */
  cosineSimilarity(a: Float32Array, b: Float32Array): number {
    // If dimensions differ (Ollama 768 vs hash 384), pad to max
    const len = Math.max(a.length, b.length);
    let dot = 0;
    let magA = 0;
    let magB = 0;

    for (let i = 0; i < len; i++) {
      const av = i < a.length ? (a[i] ?? 0) : 0;
      const bv = i < b.length ? (b[i] ?? 0) : 0;
      dot += av * bv;
      magA += av * av;
      magB += bv * bv;
    }

    const magnitude = Math.sqrt(magA) * Math.sqrt(magB);
    return magnitude === 0 ? 0 : dot / magnitude;
  }

  // ─── Ollama embedding ───────────────────────────────────

  private async embedOllama(text: string): Promise<Float32Array> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    try {
      const resp = await fetch(`${this.ollamaUrl}/api/embed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: this.model, input: text }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!resp.ok) {
        throw new Error(`Ollama embed failed: ${resp.status}`);
      }

      const data = await resp.json() as { embeddings?: number[][] };
      const embedding = data.embeddings?.[0];
      if (!embedding) {
        throw new Error("Ollama returned no embedding");
      }

      // Update dimension to match actual output
      this.dimension = embedding.length;
      return new Float32Array(embedding);
    } catch (error) {
      clearTimeout(timeout);
      throw error;
    }
  }

  // ─── Hash-based fallback embedding ──────────────────────

  private embedHash(text: string): Float32Array {
    // Use 384-dim hash for fallback (smaller, faster)
    const dim = 384;
    const vector = new Float32Array(dim);
    const words = text.toLowerCase().split(/\W+/).filter(Boolean);

    // Bag-of-words with TF-IDF-like weighting via positional hashing
    for (let pos = 0; pos < words.length; pos++) {
      const word = words[pos]!;
      const hash = this.hashString(word);
      const index = Math.abs(hash) % dim;
      // Position-weighted: earlier words get slightly more weight
      const weight = 1.0 / Math.sqrt(pos + 1);
      vector[index]! += weight / Math.sqrt(words.length);
    }

    // L2 normalize
    let magnitude = 0;
    for (let i = 0; i < dim; i++) {
      magnitude += vector[i]! * vector[i]!;
    }
    magnitude = Math.sqrt(magnitude);

    if (magnitude > 0) {
      for (let i = 0; i < dim; i++) {
        vector[i] = (vector[i] ?? 0) / magnitude;
      }
    }

    return vector;
  }

  private hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash;
  }
}
