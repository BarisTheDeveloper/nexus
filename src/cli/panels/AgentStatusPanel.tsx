import React from "react";
import { Box, Text } from "ink";
import type { Agent } from "../../agents/base/Agent.js";

interface AgentStatusPanelProps {
  agents: Agent[];
  status: string;
}

export function AgentStatusPanel({ agents, status }: AgentStatusPanelProps) {
  const isRunning = status === "analyzing" || status === "running" || status.startsWith("pick");

  return (
    <Box borderStyle="single" borderColor="gray" paddingX={1}>
      <Box gap={1} flexWrap="wrap">
        {agents.slice(0, 8).map((agent) => (
          <Text key={agent.id} color={isRunning ? "yellow" : "gray"}>
            {isRunning ? "●" : "○"}{" "}
            <Text bold color="white">{agent.id.slice(0, 10)}</Text>
          </Text>
        ))}
      </Box>
    </Box>
  );
}
