import type { NexusMemory } from "../../memory/ChromaMemory.js";

export async function handleMemoryCommand(
  args: string[],
  memory: NexusMemory,
): Promise<string> {
  const subcommand = args[0]?.toLowerCase();

  switch (subcommand) {
    case "search": {
      const query = args.slice(1).join(" ");
      if (!query) return "Usage: /memory search <query>";
      const results = await memory.query(query, 5);
      if (results.length === 0) return "No results found.";
      return results.map((r) =>
        `[${r.type}] (${new Date(r.timestamp).toLocaleString()}): ${r.content.slice(0, 200)}`
      ).join("\n");
    }

    case "clear": {
      await memory.clear();
      return "Memory cleared.";
    }

    case "list": {
      const type = args[1] ?? "episodic";
      const results = await memory.searchByType(type, 10);
      if (results.length === 0) return `No entries found of type: ${type}`;
      return results.map((r) =>
        `[${r.id.slice(0, 8)}] ${r.content.slice(0, 200)}`
      ).join("\n");
    }

    default:
      return "Usage:\n  /memory search <query>\n  /memory clear\n  /memory list [type]";
  }
}
