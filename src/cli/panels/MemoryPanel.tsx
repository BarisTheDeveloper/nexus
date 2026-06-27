import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import type { NexusMemory } from "../../memory/ChromaMemory.js";

interface MemoryPanelProps {
  memory: NexusMemory;
  onClose: () => void;
}

export function MemoryPanel({ memory, onClose }: MemoryPanelProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<string[]>([]);
  const [mode, setMode] = useState<"search" | "list" | "idle">("idle");

  useInput((_input, key) => {
    if (key.escape) {
      onClose();
    } else if (key.return && query) {
      handleSearch(query);
    } else if (key.backspace || key.delete) {
      setQuery((prev) => prev.slice(0, -1));
    } else if (!key.ctrl && !key.meta && _input) {
      setQuery((prev) => prev + _input);
    }
  });

  const handleSearch = async (q: string) => {
    setMode("search");
    try {
      const entries = await memory.query(q, 5);
      setResults(entries.map((e) => `[${e.type}] ${e.content.slice(0, 200)}`));
    } catch {
      setResults(["Error querying memory"]);
    }
  };

  return (
    <Box borderStyle="round" borderColor="blue" padding={1} flexDirection="column">
      <Text bold color="blue">Memory Panel</Text>
      <Box marginY={1}>
        <Text>Search: {query}</Text>
      </Box>
      {results.length > 0 && (
        <Box flexDirection="column">
          {results.map((r, i) => (
            <Text key={i}>{r}</Text>
          ))}
        </Box>
      )}
      <Text color="gray">[Esc] close  [Enter] search</Text>
    </Box>
  );
}
