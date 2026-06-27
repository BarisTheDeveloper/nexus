import type { ToolResult } from "../config/types.js";

interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

export class WebSearchTool {
  name = "web_search";
  description = "Search the web for information";

  /**
   * Execute a web search using DuckDuckGo's instant answer API (no API key required).
   * Falls back to alternative sources if unavailable.
   */
  async execute(query: string): Promise<ToolResult> {
    try {
      const result = await this.searchDuckDuckGo(query);
      return {
        success: true,
        stdout: JSON.stringify(result, null, 2),
        stderr: "",
      };
    } catch (error) {
      // Fallback: try a simpler approach
      try {
        const fallback = await this.searchFallback(query);
        return {
          success: true,
          stdout: JSON.stringify(fallback, null, 2),
          stderr: "",
        };
      } catch (fallbackError) {
        return {
          success: false,
          stdout: "",
          stderr: "",
          error: `Web search failed: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    }
  }

  private async searchDuckDuckGo(query: string): Promise<WebSearchResult[]> {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
    const response = await fetch(url);
    const data = await response.json() as {
      AbstractText?: string;
      AbstractSource?: string;
      RelatedTopics?: Array<{ Text?: string; FirstURL?: string; Result?: string }>;
    };

    const results: WebSearchResult[] = [];

    if (data.AbstractText) {
      results.push({
        title: data.AbstractSource ?? "DuckDuckGo Result",
        url: `https://duckduckgo.com/?q=${encodeURIComponent(query)}`,
        snippet: data.AbstractText.slice(0, 500),
      });
    }

    if (data.RelatedTopics) {
      for (const topic of data.RelatedTopics.slice(0, 5)) {
        if (topic.Text) {
          results.push({
            title: topic.Text.split(" - ")[0] ?? topic.Text,
            url: topic.FirstURL ?? "",
            snippet: topic.Text.slice(0, 300),
          });
        }
      }
    }

    return results;
  }

  private async searchFallback(query: string): Promise<WebSearchResult[]> {
    // Minimal fallback: try fetching from a search engine
    const url = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`;
    const response = await fetch(url);
    const html = await response.text();

    // Simple HTML parsing to extract result snippets
    const results: WebSearchResult[] = [];
    const resultRegex = /<a[^>]*rel="nofollow"[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/g;
    let match;

    while ((match = resultRegex.exec(html)) !== null && results.length < 5) {
      results.push({
        title: match[2]?.trim() ?? "Result",
        url: match[1] ?? "",
        snippet: "",
      });
    }

    return results;
  }
}
