import React, { useState, useEffect, useCallback, useRef } from "react";
import { Box, Text, useInput, useApp } from "ink";
import { Orchestrator } from "../../core/Orchestrator.js";
import type { AgentMessage } from "../../config/types.js";
import { AgentStatusPanel } from "./AgentStatusPanel.js";
import { handleMemoryCommand } from "../commands/index.js";
import { MarkdownText } from "./MarkdownText.js";
import type { DoctorReport } from "../../core/Orchestrator.js";

interface ChatPanelProps {
  orchestrator: Orchestrator;
}

interface UIMessage {
  id: number;
  agentId: string;
  role: string;
  content: string;
  timestamp: number;
  isStreaming?: boolean;
  isPasted?: boolean;
  pasteSummary?: string;
  tokensUsed?: number;
  elapsedMs?: number;
}

const COMMAND_LIST = [
  { name: "/new", usage: "agent | provider", desc: "🧙 Guided wizard" },
  { name: "/help", usage: "", desc: "Toggle help overlay" },
  { name: "/agents", usage: "", desc: "List active agents and their models/tools" },
  { name: "/providers", usage: "", desc: "Show configured providers" },
  { name: "/model", usage: "<agent> <model>", desc: "Change an agent's model" },
  { name: "/config", usage: "show | model <a> <m> | agent <id>", desc: "View/change configuration" },
  { name: "/models", usage: "[provider]", desc: "List agent models or fetch from provider API" },
  { name: "/doctor", usage: "", desc: "Run system health check" },
  { name: "/sessions", usage: "", desc: "List saved sessions" },
  { name: "/resume", usage: "<id-or-number>", desc: "Resume a past session" },
  { name: "/profile", usage: "", desc: "Show user profile" },
  { name: "/think", usage: "<query>", desc: "Use Planner + Critic" },
  { name: "/code", usage: "<request>", desc: "Use Coder agent only" },
  { name: "/exec", usage: "<command>", desc: "Run shell command (Critic-gated)" },
  { name: "/memory", usage: "search <q> | clear | list [type]", desc: "Memory operations" },
  { name: "/export", usage: "[json]", desc: "Export session" },
  { name: "/status", usage: "", desc: "Show system status" },
  { name: "/clear", usage: "", desc: "Clear chat" },
  { name: "/redraw", usage: "", desc: "Force screen redraw (fix display glitches)" },
  { name: "/exit", usage: "", desc: "Exit Nexus" },
] as const;

export function ChatPanel({ orchestrator }: ChatPanelProps) {
  const { exit } = useApp();
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [status, setStatus] = useState<string>("idle");
  const [showHelp, setShowHelp] = useState(false);
  const [suggestionIndex, setSuggestionIndex] = useState(-1);
  const inputRef = useRef<string>("");
  const msgCounter = useRef(0);

  // Interactive model picker state
  interface PendingPick {
    mode: "model" | "agent";
    models: string[];
    provider: string;
    selectedModelIndex?: number;
  }
  const pendingPickRef = useRef<PendingPick | null>(null);
  const [pendingPrompt, setPendingPrompt] = useState<string>("");

  // ── Wizard mode: guided step-by-step flows ──
  interface WizardStep { prompt: string; key: string; options?: string[]; }
  interface WizardState { flow: string; steps: WizardStep[]; index: number; data: Record<string, string>; }
  const wizardRef = useRef<WizardState | null>(null);
  const [wizardPrompt, setWizardPrompt] = useState("");
  const [wizardOptions, setWizardOptions] = useState<string[]>([]);

  const startWizard = (flow: string, steps: WizardStep[]) => {
    wizardRef.current = { flow, steps, index: 0, data: {} };
    setWizardPrompt(steps[0]!.prompt);
    setWizardOptions(steps[0]!.options ?? []);
    setInput(""); inputRef.current = "";
  };

  const cancelWizard = () => {
    wizardRef.current = null;
    setWizardPrompt("");
    setWizardOptions([]);
    setInput(""); inputRef.current = "";
  };

  const agents = orchestrator.getAgents();

  useEffect(() => {
    const handleAgentSpeaking = (agentId: string, content: string) => {
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.agentId === agentId && last.isStreaming) {
          const updated = [...prev];
          updated[updated.length - 1] = { ...last, content, isStreaming: false };
          return updated;
        }
        return [
          ...prev,
          { id: ++msgCounter.current, agentId, role: "speaker", content, timestamp: Date.now() },
        ];
      });
    };

    const handleAgentStreaming = (agentId: string, chunk: string) => {
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.agentId === agentId && last.isStreaming) {
          const updated = [...prev];
          updated[updated.length - 1] = { ...last, content: last.content + chunk };
          return updated;
        }
        return [
          ...prev,
          { id: ++msgCounter.current, agentId, role: "speaker", content: chunk, timestamp: Date.now(), isStreaming: true },
        ];
      });
    };

    const handleAgentListening = (agentId: string) => {
      setStatus(`Agent "${agentId}" listening...`);
    };

    const handleAgentInterjection = (agentId: string, content: string) => {
      setMessages((prev) => [
        ...prev,
        { id: ++msgCounter.current, agentId, role: "interjection", content, timestamp: Date.now() },
      ]);
    };

    const handleStatusChange = (newStatus: string) => setStatus(newStatus);

    const handleToolExecuting = (agentId: string, toolName: string) => {
      setMessages((prev) => [
        ...prev,
        { id: ++msgCounter.current, agentId, role: "tool", content: `🔧 Calling: ${toolName}`, timestamp: Date.now() },
      ]);
    };

    const handleToolResult = (agentId: string, toolName: string, success: boolean) => {
      setMessages((prev) => [
        ...prev,
        { id: ++msgCounter.current, agentId, role: "tool",
          content: `${success ? "✅" : "❌"} Tool ${toolName} ${success ? "completed" : "failed"}`, timestamp: Date.now() },
      ]);
    };

    const handleFinalOutput = () => setStatus("complete");
    const handleError = (error: Error) => {
      // Mask API keys in error messages
      const msg = error.message.replace(/(sk-[a-zA-Z0-9]{10})[a-zA-Z0-9]+/g, "***NED");
      setStatus(`error: ${msg}`);
    };

    orchestrator.on("agent-speaking", handleAgentSpeaking);
    orchestrator.on("agent-streaming", handleAgentStreaming);
    orchestrator.on("agent-listening", handleAgentListening);
    orchestrator.on("agent-interjection", handleAgentInterjection);
    orchestrator.on("status-change", handleStatusChange);
    orchestrator.on("tool-executing", handleToolExecuting);
    orchestrator.on("tool-result", handleToolResult);
    orchestrator.on("final-output", handleFinalOutput);
    orchestrator.on("error", handleError);

    return () => {
      orchestrator.removeListener("agent-speaking", handleAgentSpeaking);
      orchestrator.removeListener("agent-streaming", handleAgentStreaming);
      orchestrator.removeListener("agent-listening", handleAgentListening);
      orchestrator.removeListener("agent-interjection", handleAgentInterjection);
      orchestrator.removeListener("status-change", handleStatusChange);
      orchestrator.removeListener("tool-executing", handleToolExecuting);
      orchestrator.removeListener("tool-result", handleToolResult);
      orchestrator.removeListener("final-output", handleFinalOutput);
      orchestrator.removeListener("error", handleError);
    };
  }, [orchestrator]);

  // ─── Command suggestions ─────────────────────────────────

  const lastWord = input.split(" ")[0] ?? "";
  const showSuggestions = input.startsWith("/") && input.length > 0;
  const matchingSuggestions = showSuggestions
    ? COMMAND_LIST.filter((c) => c.name.startsWith(lastWord) && c.name !== lastWord)
    : [];

  // Reset suggestion index when input/filter changes
  useEffect(() => {
    setSuggestionIndex(-1);
  }, [lastWord]);

  const acceptSuggestion = useCallback((idx: number) => {
    if (idx >= 0 && idx < matchingSuggestions.length) {
      const cmd = matchingSuggestions[idx]!.name;
      inputRef.current = cmd + " ";
      setInput(cmd + " ");
      setSuggestionIndex(-1);
    }
  }, [matchingSuggestions]);

  // ─── Paste detection ────────────────────────────────────

  const detectPaste = (newText: string, oldText: string): { isPaste: boolean; summary: string } | null => {
    const added = newText.length - oldText.length;
    if (added > 300 && newText.includes("\n")) {
      const lines = newText.split("\n").length;
      const kb = Math.round(newText.length / 1024);
      const mb = kb >= 1024 ? `${(kb / 1024).toFixed(1)}MB` : `${kb}KB`;
      return { isPaste: true, summary: `[pasted: ${lines} lines, ${mb}]` };
    }
    return null;
  };

  // ─── Handle submit ──────────────────────────────────────

  const handleSubmit = useCallback(async () => {
    const userInput = inputRef.current.trim();
    if (!userInput) return;

    // ── Wizard mode: step-by-step guided flow ──
    const wizard = wizardRef.current;
    if (wizard) {
      if (userInput === "/cancel" || userInput.toLowerCase() === "cancel") {
        cancelWizard();
        setMessages((prev) => [...prev, { id: ++msgCounter.current, agentId: "system", role: "speaker", content: "❎ Wizard cancelled.", timestamp: Date.now() }]);
        return;
      }
      const step = wizard.steps[wizard.index]!;
      wizard.data[step.key] = userInput;
      wizard.index++;
      if (wizard.index >= wizard.steps.length) {
        // Wizard complete — execute
        await executeWizard(wizard);
        return;
      }
      const next = wizard.steps[wizard.index]!;
      setWizardPrompt(next.prompt);
      setWizardOptions(next.options ?? []);
      setInput(""); inputRef.current = "";
      return;
    }

    // ── Interactive pick mode: intercept number inputs ──
    const pending = pendingPickRef.current;
    if (pending) {
      const num = parseInt(userInput, 10);
      if (pending.mode === "model" && !isNaN(num) && num > 0 && num <= pending.models.length) {
        // User picked a model — move to agent selection
        pending.mode = "agent";
        pending.selectedModelIndex = num - 1;
        const modelName = pending.models[num - 1]!;
        const agentList = agents.map((a, i) => `  ${i + 1}. ${a.id} (${a.config.model})`).join("\n");
        setMessages((prev) => [
          ...prev,
          { id: ++msgCounter.current, agentId: "system", role: "speaker",
            content: `Model: ${modelName}\n\nSelect agent:\n${agentList}\n\nType a number (1-${agents.length}):`,
            timestamp: Date.now() },
        ]);
        setPendingPrompt(`Pick agent for ${modelName} [1-${agents.length}]: `);
        setInput(""); inputRef.current = "";
        return;
      }
      if (pending.mode === "agent" && !isNaN(num) && num > 0 && num <= agents.length) {
        // User picked an agent — assign!
        const modelName = pending.models[pending.selectedModelIndex!]!;
        const agentId = agents[num - 1]!.id;
        orchestrator.setAgentModel(agentId, modelName);
        setMessages((prev) => [
          ...prev,
          { id: ++msgCounter.current, agentId: "system", role: "speaker",
            content: `✅ ${agentId} → ${modelName}`,
            timestamp: Date.now() },
        ]);
        pendingPickRef.current = null;
        setPendingPrompt("");
        setInput(""); inputRef.current = "";
        return;
      }
      // Invalid number — cancel pick
      pendingPickRef.current = null;
      setPendingPrompt("");
      setMessages((prev) => [
        ...prev,
        { id: ++msgCounter.current, agentId: "system", role: "speaker",
          content: "Selection cancelled. Use /models to try again.",
          timestamp: Date.now() },
      ]);
      setInput(""); inputRef.current = "";
      return;
    }

    if (userInput.startsWith("/")) {
      await handleCommand(userInput);
      return;
    }

    // Detect paste for display
    const pasteInfo = userInput.length > 500 && userInput.includes("\n")
      ? detectPaste(userInput, "")
      : null;

    setMessages((prev) => [
      ...prev,
      {
        id: ++msgCounter.current,
        agentId: "user",
        role: "speaker",
        content: pasteInfo ? pasteInfo.summary : userInput,
        timestamp: Date.now(),
        ...(pasteInfo ? { isPasted: true, pasteSummary: pasteInfo.summary } : {}),
      },
    ]);
    setInput("");
    inputRef.current = "";
    setSuggestionIndex(-1);
    setStatus("analyzing...");

    try {
      await orchestrator.processUserMessage(userInput);
    } catch (error) {
      setStatus(`Error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, [orchestrator]);

  // ── Wizard executor ────────────────────────────────────
  const executeWizard = async (wizard: WizardState) => {
    cancelWizard();
    const d = wizard.data;
    if (wizard.flow === "new-agent") {
      const caps = (d["capabilities"] ?? "thinking").split(",").map((s: string) => s.trim()) as any[];
      orchestrator.addCustomAgent({
        id: d["id"]!, name: d["name"]!, role: d["role"]!,
        provider: d["provider"]!, model: d["model"]!,
        systemPrompt: `You are ${d["name"]}. ${d["role"]}.`,
        capabilities: caps, priority: parseInt(d["priority"] ?? "5", 10),
      });
      setMessages((prev) => [...prev, { id: ++msgCounter.current, agentId: "system", role: "speaker",
        content: `✅ Agent "${d["id"]}" created!\n  Provider: ${d["provider"]}  Model: ${d["model"]}\n  Caps: ${caps.join(", ")}`, timestamp: Date.now() }]);
    } else if (wizard.flow === "new-provider") {
      setStatus(`Adding ${d["type"]}...`);
      try {
        const result = await orchestrator.addProvider(d["type"]!, d["type"]!, d["key"], d["url"]);
        const lines = [result.success ? `✅ ${result.message}` : `⚠️ ${result.message}`];
        if (result.models?.length) {
          lines.push("", "Models:", ...result.models.slice(0, 10).map((m: string, i: number) => `  ${i + 1}. ${m}`));
        }
        setMessages((prev) => [...prev, { id: ++msgCounter.current, agentId: "system", role: "speaker",
          content: lines.join("\n"), timestamp: Date.now() }]);
        setStatus("complete");
      } catch (e: any) { setStatus(`Error: ${e.message}`); }
    }
  };

  // ─── Input handler ──────────────────────────────────────

  useInput((_input, key) => {
    if (key.return) {
      handleSubmit();
      return;
    }

    if (key.escape) {
      if (showSuggestions) {
        setSuggestionIndex(-1);
        inputRef.current = "";
        setInput("");
        return;
      }
      setShowHelp(false);
      return;
    }

    // Tab: autocomplete
    if (key.tab && showSuggestions && matchingSuggestions.length > 0) {
      const idx = suggestionIndex >= 0 ? suggestionIndex : 0;
      acceptSuggestion(idx);
      return;
    }

    // Arrow keys for suggestion navigation
    if (showSuggestions && matchingSuggestions.length > 0) {
      if (key.upArrow) {
        setSuggestionIndex((prev) =>
          prev <= 0 ? matchingSuggestions.length - 1 : prev - 1
        );
        return;
      }
      if (key.downArrow) {
        setSuggestionIndex((prev) =>
          prev >= matchingSuggestions.length - 1 ? 0 : prev + 1
        );
        return;
      }
    }

    // Text input
    if (key.backspace || key.delete) {
      inputRef.current = inputRef.current.slice(0, -1);
      setInput(inputRef.current);
    } else if (!key.ctrl && !key.meta && _input) {
      inputRef.current += _input;
      setInput(inputRef.current);
    }
  });

  // ─── Command handlers ───────────────────────────────────

  const handleMemoryCmd = async (args: string[]) => {
    try {
      const result = await handleMemoryCommand(args, orchestrator.getMemory());
      setMessages((prev) => [
        ...prev,
        { id: ++msgCounter.current, agentId: "system", role: "speaker", content: result, timestamp: Date.now() },
      ]);
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        { id: ++msgCounter.current, agentId: "system", role: "speaker",
          content: `Memory error: ${error instanceof Error ? error.message : String(error)}`, timestamp: Date.now() },
      ]);
    }
  };

  const handleDoctorCmd = async () => {
    setStatus("running doctor...");
    try {
      const report: DoctorReport = await orchestrator.runDoctor();
      const lines: string[] = [];
      lines.push(`Overall: ${report.overall === "healthy" ? "🟢 HEALTHY" : report.overall === "degraded" ? "🟡 DEGRADED" : "🔴 UNHEALTHY"}`);
      lines.push("", "── Providers ──");
      for (const p of report.providers) {
        const icon = p.status === "ok" ? "✅" : p.status === "missing_key" ? "⚠️" : "❌";
        lines.push(`  ${icon} ${p.id}: ${p.message}`);
      }
      lines.push("", "── Agents ──");
      for (const a of report.agents) {
        lines.push(`  ${a.hasProvider ? "✅" : "⚠️"} ${a.id} (${a.toolCount} tools)`);
      }
      lines.push("", "── Embedding ──");
      lines.push(`  ${report.embedding.ollamaAvailable ? "✅ Ollama" : "⚠️ Hash fallback"}: ${report.embedding.message}`);
      lines.push("", "── Memory ──");
      lines.push(`  ${report.memory.status === "ok" ? "✅" : "❌"} ${report.memory.message}`);
      lines.push("", "── Tools ──");
      for (const t of report.tools) lines.push(`  🔧 ${t.name}`);
      lines.push("", "── Sessions ──");
      lines.push(`  Active: ${report.sessions.active ?? "none"} | Total: ${report.sessions.total}`);

      setMessages((prev) => [
        ...prev,
        { id: ++msgCounter.current, agentId: "system", role: "speaker", content: lines.join("\n"), timestamp: Date.now() },
      ]);
      setStatus("complete");
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        { id: ++msgCounter.current, agentId: "system", role: "speaker",
          content: `Doctor error: ${error instanceof Error ? error.message : String(error)}`, timestamp: Date.now() },
      ]);
      setStatus("error");
    }
  };

  const handleConfigCmd = async (parts: string[]) => {
    const sub = parts[1]?.toLowerCase();

    if (!sub || sub === "show") {
      const providers = orchestrator.getProvidersInfo();
      const profile = orchestrator.getProfileManager().getProfile();
      const lines = [
        "── Config ──",
        `Default Provider: ${providers[0]?.id ?? "none"}`,
        "Critic Approval: enabled",
        `Language: ${profile.language}`,
        `Response Style: ${profile.responseStyle}`,
        "", "── Providers ──",
        ...providers.map((p) => `  • ${p.id} — ${p.name}`),
        "", "── Usage ──",
        "  /config show          Show configuration",
        "  /config model <agent> <model>   Change agent model",
        "  /config agent <id>    Show agent details",
      ];
      setMessages((prev) => [
        ...prev,
        { id: ++msgCounter.current, agentId: "system", role: "speaker", content: lines.join("\n"), timestamp: Date.now() },
      ]);
      return;
    }

    if (sub === "model") {
      const agentId = parts[2];
      const model = parts.slice(3).join(" ");
      if (!agentId || !model) {
        setMessages((prev) => [
          ...prev,
          { id: ++msgCounter.current, agentId: "system", role: "speaker",
            content: "Usage: /config model <agent> <model>\nAgents: " + agents.map((a) => a.id).join(", "), timestamp: Date.now() },
        ]);
      } else {
        const success = orchestrator.setAgentModel(agentId, model);
        setMessages((prev) => [
          ...prev,
          { id: ++msgCounter.current, agentId: "system", role: "speaker",
            content: success ? `✅ Agent "${agentId}" model → "${model}"`
              : `❌ Agent "${agentId}" not found. Available: ${agents.map((a) => a.id).join(", ")}`, timestamp: Date.now() },
        ]);
      }
      return;
    }

    if (sub === "agent") {
      const action = parts[2]?.toLowerCase();

      // /config agent add <id> <name> <role> <provider> <model> <capabilities> [priority]
      if (action === "add") {
        const id = parts[3];
        const name = parts[4];
        const role = parts[5];
        const provider = parts[6];
        const model = parts[7];
        const capabilities = parts[8]?.split(",") as any[] ?? ["thinking"];
        const priority = parseInt(parts[9] ?? "5", 10);
        if (!id || !name || !provider || !model) {
          setMessages((prev) => [
            ...prev,
            { id: ++msgCounter.current, agentId: "system", role: "speaker",
              content: "Usage: /config agent add <id> <name> <role> <provider> <model> [capabilities] [priority]\n\nExample:\n  /config agent add coder2 \"Coder 2\" code deepseek deepseek-chat coding 4\n\nCapabilities (comma-separated): thinking, coding, command_execution, research, summarization, criticism", timestamp: Date.now() },
          ]);
          return;
        }
        try {
          orchestrator.addCustomAgent({ id, name, role, provider, model, systemPrompt: `You are ${name}. ${role}.`, capabilities, priority });
          setMessages((prev) => [
            ...prev,
            { id: ++msgCounter.current, agentId: "system", role: "speaker",
              content: `✅ Agent "${id}" (${name}) added. Provider: ${provider}, Model: ${model}`, timestamp: Date.now() },
          ]);
        } catch (error) {
          setMessages((prev) => [
            ...prev,
            { id: ++msgCounter.current, agentId: "system", role: "speaker",
              content: `Error: ${error instanceof Error ? error.message : String(error)}`, timestamp: Date.now() },
          ]);
        }
        return;
      }

      // /config agent remove <id>
      if (action === "remove") {
        const id = parts[3];
        if (!id) {
          setMessages((prev) => [
            ...prev,
            { id: ++msgCounter.current, agentId: "system", role: "speaker",
              content: "Usage: /config agent remove <id>", timestamp: Date.now() },
          ]);
          return;
        }
        const ok = orchestrator.removeCustomAgent(id);
        setMessages((prev) => [
          ...prev,
          { id: ++msgCounter.current, agentId: "system", role: "speaker",
            content: ok ? `✅ Agent "${id}" removed.` : `❌ Agent "${id}" not found or is built-in.`, timestamp: Date.now() },
        ]);
        return;
      }

      // /config agent <id> — show details
      const agentId = parts[2];
      if (!agentId) {
        // Show all agents
        const lines = agents.map((a) => `  • ${a.name} (${a.id}) — ${a.config.model} @ ${a.config.provider}`).join("\n");
        setMessages((prev) => [
          ...prev,
          { id: ++msgCounter.current, agentId: "system", role: "speaker",
            content: `Agents (${agents.length}):\n${lines}\n\nUsage:\n  /config agent <id>        Show agent details\n  /config agent add ...      Add custom agent\n  /config agent remove <id>  Remove custom agent`, timestamp: Date.now() },
        ]);
        return;
      }
      const agent = orchestrator.getAgent(agentId);
      if (!agent) {
        setMessages((prev) => [
          ...prev,
          { id: ++msgCounter.current, agentId: "system", role: "speaker", content: `Agent "${agentId}" not found`, timestamp: Date.now() },
        ]);
        return;
      }
      const lines = [
        `Agent: ${agent.name} (${agent.id})`,
        `  Role: ${agent.role}`, `  Provider: ${agent.config.provider}`, `  Model: ${agent.config.model}`,
        `  Priority: ${agent.priority}`, `  Capabilities: ${agent.capabilities.join(", ")}`,
        `  Has Provider: ${agent.provider ? "✅" : "❌"}`,
        `  Tools: ${agent.getTools().map((t: { name: string }) => t.name).join(", ") || "none"}`,
        `  System Prompt (first 150 chars): ${agent.systemPrompt.slice(0, 150)}...`,
      ];
      setMessages((prev) => [
        ...prev,
        { id: ++msgCounter.current, agentId: "system", role: "speaker", content: lines.join("\n"), timestamp: Date.now() },
      ]);
      return;
    }

    if (sub === "provider") {
      const action = parts[2]?.toLowerCase();
      if (action === "add") {
        const type = parts[3];
        const apiKey = parts[4];
        const baseUrl = parts[5];
        if (!type) {
          const validTypes = "openai, anthropic, gemini, ollama, groq, fireworks, lmstudio, deepseek, zai, openai-compatible";
          setMessages((prev) => [
            ...prev,
            { id: ++msgCounter.current, agentId: "system", role: "speaker",
              content: `Usage: /config provider add <type> <api-key> [base-url]\n\nValid types: ${validTypes}\n\nExamples:\n  /config provider add openai sk-...\n  /config provider add ollama "" http://localhost:11434\n  /config provider add openai-compatible sk-... https://api.openrouter.ai/v1\n\nProvider will be tested (models fetched) before saving.`,
              timestamp: Date.now() },
          ]);
          return;
        }
        setStatus(`Adding provider ${type}...`);
        try {
          const result = await orchestrator.addProvider(type, type, apiKey, baseUrl);
          const lines = [result.success ? `✅ ${result.message}` : `⚠️ ${result.message}`];
          if (result.models && result.models.length > 0) {
            lines.push("", "Available models:");
            result.models.slice(0, 20).forEach((m, i) => lines.push(`  ${String(i + 1).padStart(2)}. ${m}`));
            if (result.models.length > 20) lines.push(`  ... and ${result.models.length - 20} more`);
            lines.push("", "Use /models to browse, /model <agent> <model> to assign.");
          }
          setMessages((prev) => [
            ...prev,
            { id: ++msgCounter.current, agentId: "system", role: "speaker", content: lines.join("\n"), timestamp: Date.now() },
          ]);
          setStatus("complete");
        } catch (error) {
          setMessages((prev) => [
            ...prev,
            { id: ++msgCounter.current, agentId: "system", role: "speaker",
              content: `Error: ${error instanceof Error ? error.message : String(error)}`, timestamp: Date.now() },
          ]);
          setStatus("error");
        }
        return;
      }
      if (action === "remove") {
        const id = parts[3];
        if (!id) {
          setMessages((prev) => [
            ...prev,
            { id: ++msgCounter.current, agentId: "system", role: "speaker",
              content: `Usage: /config provider remove <id>\nProviders: ${orchestrator.getProviderIds().join(", ")}`, timestamp: Date.now() },
          ]);
          return;
        }
        const removed = orchestrator.removeProvider(id);
        setMessages((prev) => [
          ...prev,
          { id: ++msgCounter.current, agentId: "system", role: "speaker",
            content: removed ? `✅ Provider "${id}" removed.` : `❌ Provider "${id}" not found.`, timestamp: Date.now() },
        ]);
        return;
      }
      // Default: show provider list
      const ids = orchestrator.getProviderIds();
      const lines = ["── Providers ──", ""];
      for (const pid of ids) {
        lines.push(`  • ${pid}  →  /models ${pid}`);
      }
      lines.push("", "Usage:");
      lines.push("  /config provider add <type> <api-key> [base-url]   Add a provider");
      lines.push("  /config provider remove <id>                       Remove a provider");
      lines.push("", "Valid types: openai, anthropic, gemini, ollama, groq, deepseek, zai, openai-compatible, ...");
      setMessages((prev) => [
        ...prev,
        { id: ++msgCounter.current, agentId: "system", role: "speaker", content: lines.join("\n"), timestamp: Date.now() },
      ]);
      return;
    }

    setMessages((prev) => [
      ...prev,
      { id: ++msgCounter.current, agentId: "system", role: "speaker",
        content: "Unknown config subcommand. Try: /config show | model | agent | provider", timestamp: Date.now() },
    ]);
  };

  const handleCommand = async (cmd: string) => {
    const parts = cmd.split(" ");
    const command = parts[0]?.toLowerCase();

    switch (command) {
      case "/help":
        setShowHelp(!showHelp);
        break;

      case "/agents":
        setMessages((prev) => [...prev, { id: ++msgCounter.current, agentId: "system", role: "speaker",
          content: `Agents:\n${agents.map((a) =>
            `  • ${a.name} (${a.id}) — ${a.config.role}\n    Model: ${a.config.model} @ ${a.config.provider}\n    Capabilities: ${a.capabilities.join(", ")}\n    Tools: ${a.getTools().map((t: { name: string }) => t.name).join(", ") || "none"}`
          ).join("\n")}`, timestamp: Date.now() }]);
        break;

      case "/providers": {
        const providers = orchestrator.getProvidersInfo();
        setMessages((prev) => [...prev, { id: ++msgCounter.current, agentId: "system", role: "speaker",
          content: providers.length === 0
            ? "No providers configured. Set up providers in ~/.nexus/config.yaml"
            : `Providers (${providers.length}):\n${providers.map((p) => `  • ${p.id} — ${p.name}`).join("\n")}`,
          timestamp: Date.now() }]);
        break;
      }

      case "/model": {
        const agentId = parts[1];
        const model = parts.slice(2).join(" ");
        if (!agentId || !model) {
          setMessages((prev) => [...prev, { id: ++msgCounter.current, agentId: "system", role: "speaker",
            content: "Usage: /model <agent> <model>\nAgents: " + agents.map((a) => a.id).join(", "), timestamp: Date.now() }]);
        } else {
          const success = orchestrator.setAgentModel(agentId, model);
          setMessages((prev) => [...prev, { id: ++msgCounter.current, agentId: "system", role: "speaker",
            content: success ? `✓ Agent "${agentId}" model changed to "${model}"`
              : `✗ Agent "${agentId}" not found. Available: ${agents.map((a) => a.id).join(", ")}`, timestamp: Date.now() }]);
        }
        break;
      }

      case "/profile": {
        const profile = orchestrator.getProfileManager().getProfile();
        setMessages((prev) => [...prev, { id: ++msgCounter.current, agentId: "system", role: "speaker",
          content: `Profile:\n  Language: ${profile.language}\n  Response Style: ${profile.responseStyle}\n  Preferred Models: ${Object.entries(profile.preferredModels).map(([k, v]) => `${k}=${v}`).join(", ") || "none"}\n  Projects: ${profile.projectContexts.length}\n  Shortcuts: ${Object.keys(profile.shortcuts).length}`,
          timestamp: Date.now() }]);
        break;
      }

      case "/export": {
        const { json, markdown } = orchestrator.exportSession();
        const format = parts[1]?.toLowerCase() === "json" ? "json" : "markdown";
        const content = format === "json" ? json : markdown;
        setMessages((prev) => [...prev, { id: ++msgCounter.current, agentId: "system", role: "speaker",
          content: `Session exported as ${format}:\n\n${content.slice(0, 2000)}${content.length > 2000 ? "\n...(truncated)" : ""}`,
          timestamp: Date.now() }]);
        break;
      }

      case "/think": {
        const query = parts.slice(1).join(" ");
        if (!query) {
          setMessages((prev) => [...prev, { id: ++msgCounter.current, agentId: "system", role: "speaker",
            content: "Usage: /think <query> — Uses Planner + Critic agents", timestamp: Date.now() }]);
        } else {
          setMessages((prev) => [...prev, { id: ++msgCounter.current, agentId: "user", role: "speaker",
            content: `/think ${query}`, timestamp: Date.now() }]);
          setInput(""); inputRef.current = ""; setSuggestionIndex(-1);
          setStatus("analyzing (think mode)...");
          try { await orchestrator.processWithSpecificAgents(query, ["planner", "critic"]); }
          catch (error) { setStatus(`Error: ${error instanceof Error ? error.message : String(error)}`); }
          return;
        }
        break;
      }

      case "/code": {
        const request = parts.slice(1).join(" ");
        if (!request) {
          setMessages((prev) => [...prev, { id: ++msgCounter.current, agentId: "system", role: "speaker",
            content: "Usage: /code <request> — Uses only Coder agent", timestamp: Date.now() }]);
        } else {
          setMessages((prev) => [...prev, { id: ++msgCounter.current, agentId: "user", role: "speaker",
            content: `/code ${request}`, timestamp: Date.now() }]);
          setInput(""); inputRef.current = ""; setSuggestionIndex(-1);
          setStatus("analyzing (code mode)...");
          try { await orchestrator.processWithSpecificAgents(request, ["coder"]); }
          catch (error) { setStatus(`Error: ${error instanceof Error ? error.message : String(error)}`); }
          return;
        }
        break;
      }

      case "/exec": {
        const shellCmd = parts.slice(1).join(" ");
        if (!shellCmd) {
          setMessages((prev) => [...prev, { id: ++msgCounter.current, agentId: "system", role: "speaker",
            content: "Usage: /exec <command> — Run a shell command directly (with Critic safety review)", timestamp: Date.now() }]);
        } else {
          setMessages((prev) => [...prev, { id: ++msgCounter.current, agentId: "user", role: "speaker",
            content: `/exec ${shellCmd}`, timestamp: Date.now() }]);
          setInput(""); inputRef.current = ""; setSuggestionIndex(-1);
          setStatus("executing...");
          try {
            const result = await orchestrator.executeShellCommand(shellCmd);
            const output = [
              result.success ? "✅ Command completed" : "❌ Command failed",
              result.stdout ? `\n── stdout ──\n${result.stdout}` : "",
              result.stderr ? `\n── stderr ──\n${result.stderr}` : "",
              result.error ? `\n── error ──\n${result.error}` : "",
            ].filter(Boolean).join("");
            setStatus("complete");
            setMessages((prev) => [...prev, { id: ++msgCounter.current, agentId: "executor", role: "speaker",
              content: output, timestamp: Date.now() }]);
          } catch (error) { setStatus(`Error: ${error instanceof Error ? error.message : String(error)}`); }
          return;
        }
        break;
      }

      case "/memory":
        await handleMemoryCmd(parts.slice(1));
        break;

      case "/doctor":
        await handleDoctorCmd();
        break;

      case "/sessions": {
        const sessions = orchestrator.listSessions();
        if (sessions.length === 0) {
          setMessages((prev) => [...prev, { id: ++msgCounter.current, agentId: "system", role: "speaker",
            content: "No saved sessions.", timestamp: Date.now() }]);
        } else {
          const lines = [`Saved Sessions (${sessions.length}):`, ""];
          for (const s of sessions) {
            const date = new Date(s.startedAt).toLocaleString();
            lines.push(`[${s.number}] ${s.id.slice(0, 8)}...  ${date}  (${s.messageCount} msgs)`);
            lines.push(`    ${s.preview.slice(0, 100)}`);
            lines.push("");
          }
          lines.push("Resume: /resume <id> or /resume <number>");
          setMessages((prev) => [...prev, { id: ++msgCounter.current, agentId: "system", role: "speaker",
            content: lines.join("\n"), timestamp: Date.now() }]);
        }
        break;
      }

      case "/resume": {
        const target = parts[1];
        if (!target) {
          setMessages((prev) => [...prev, { id: ++msgCounter.current, agentId: "system", role: "speaker",
            content: "Usage: /resume <session-id-or-number>\nUse /sessions to list saved sessions.", timestamp: Date.now() }]);
          break;
        }
        const num = parseInt(target, 10);
        let sessionId = target;
        if (!isNaN(num)) {
          const sessions = orchestrator.listSessions();
          const match = sessions.find((s) => s.number === num);
          if (match) sessionId = match.id;
        }
        const msgs = orchestrator.resumeSession(sessionId);
        if (msgs) {
          setMessages(msgs.map((m) => ({
            id: ++msgCounter.current, agentId: m.agentId, role: m.role, content: m.content, timestamp: m.timestamp,
          })));
          setStatus("idle");
          setMessages((prev) => [...prev, { id: ++msgCounter.current, agentId: "system", role: "speaker",
            content: `📂 Resumed session — ${msgs.length} messages loaded`, timestamp: Date.now() }]);
        } else {
          setMessages((prev) => [...prev, { id: ++msgCounter.current, agentId: "system", role: "speaker",
            content: `Session "${target}" not found. Use /sessions to list.`, timestamp: Date.now() }]);
        }
        break;
      }

      case "/config":
        await handleConfigCmd(parts);
        break;

      case "/models": {
        const sub = parts[1]?.toLowerCase();
        const providerId = sub && sub !== "set" ? parts[1] : undefined;

        // ── /models set <model-num-or-name> <agent-num-or-id> ──
        if (sub === "set") {
          const modelSel = parts[2];
          const agentSel = parts[3];
          if (!modelSel || !agentSel) {
            setMessages((prev) => [...prev, { id: ++msgCounter.current, agentId: "system", role: "speaker",
              content: "Usage: /models set <model> <agent>\n\n  <model> = number (M1, M2) or model name\n  <agent> = number (A1, A2) or agent id\n\nExample: /models set M2 coder\n         /models set 2 1", timestamp: Date.now() }]);
            break;
          }
          setStatus("assigning...");
          try {
            // Resolve model
            let modelName = modelSel.replace(/^M/i, "");
            const modelNum = parseInt(modelName, 10);
            if (!isNaN(modelNum)) {
              // Fetch models to resolve by number
              const providerIds = orchestrator.getProviderIds();
              let resolved = false;
              for (const pid of providerIds) {
                const r = await orchestrator.listProviderModels(pid);
                if (!r.error && modelNum > 0 && modelNum <= r.models.length) {
                  modelName = r.models[modelNum - 1]!;
                  resolved = true;
                  break;
                }
              }
              if (!resolved) {
                setMessages((prev) => [...prev, { id: ++msgCounter.current, agentId: "system", role: "speaker",
                  content: `❌ Model #${modelNum} not found. Use /models <provider> to see available models.`, timestamp: Date.now() }]);
                setStatus("complete");
                break;
              }
            }

            // Resolve agent
            let agentId = agentSel.replace(/^A/i, "");
            const agentNum = parseInt(agentId, 10);
            if (!isNaN(agentNum) && agentNum > 0 && agentNum <= agents.length) {
              agentId = agents[agentNum - 1]!.id;
            }
            if (!orchestrator.getAgent(agentId)) {
              setMessages((prev) => [...prev, { id: ++msgCounter.current, agentId: "system", role: "speaker",
                content: `❌ Agent "${agentSel}" not found. Agents: ${agents.map((a) => a.id).join(", ")}`, timestamp: Date.now() }]);
              setStatus("complete");
              break;
            }

            const ok = orchestrator.setAgentModel(agentId, modelName);
            setMessages((prev) => [...prev, { id: ++msgCounter.current, agentId: "system", role: "speaker",
              content: ok ? `✅ ${agentId} → ${modelName}` : `❌ Failed to assign`, timestamp: Date.now() }]);
            setStatus("complete");
          } catch (error) {
            setMessages((prev) => [...prev, { id: ++msgCounter.current, agentId: "system", role: "speaker",
              content: `Error: ${error instanceof Error ? error.message : String(error)}`, timestamp: Date.now() }]);
            setStatus("error");
          }
          break;
        }

        // ── /models ── (no args)
        if (!providerId) {
          const providerIds = orchestrator.getProviderIds();
          const lines = ["── Agents & Models ──", ""];
          agents.forEach((a, i) => {
            lines.push(`  A${i + 1}. ${a.name.padEnd(12)} ${a.config.model} @ ${a.config.provider}`);
          });
          lines.push("", "── Providers ──");
          providerIds.forEach((pid) => lines.push(`  • ${pid}  →  /models ${pid}`));
          lines.push("", "Quick assign:");
          lines.push("  /models set <model#> <agent#>    Example: /models set 2 1");
          lines.push("  /models set <model-name> <agent>  Example: /models set gpt-4o coder");
          setMessages((prev) => [...prev, { id: ++msgCounter.current, agentId: "system", role: "speaker",
            content: lines.join("\n"), timestamp: Date.now() }]);
          break;
        }

        // ── /models <provider> ── (fetch from API, interactive pick)
        setStatus(`Fetching models from ${providerId}...`);
        try {
          const result = await orchestrator.listProviderModels(providerId);
          if (result.error) {
            setMessages((prev) => [...prev, { id: ++msgCounter.current, agentId: "system", role: "speaker",
              content: `❌ ${result.error}`, timestamp: Date.now() }]);
            setStatus("complete");
          } else {
            // Enter interactive pick mode
            pendingPickRef.current = { mode: "model", models: result.models, provider: providerId };
            const lines = [`── ${providerId} Models ──`, ""];
            result.models.forEach((m, i) => {
              lines.push(`  ${i + 1}. ${m}`);
            });
            lines.push("");
            lines.push("▸ Type a number to pick a model, or anything else to cancel");
            setMessages((prev) => [...prev, { id: ++msgCounter.current, agentId: "system", role: "speaker",
              content: lines.join("\n"), timestamp: Date.now() }]);
            setPendingPrompt(`Pick model [1-${result.models.length}]: `);
            setStatus("pick: model");
          }
        } catch (error) {
          setMessages((prev) => [...prev, { id: ++msgCounter.current, agentId: "system", role: "speaker",
            content: `Error: ${error instanceof Error ? error.message : String(error)}`, timestamp: Date.now() }]);
          setStatus("error");
        }
        break;
      }

      case "/clear":
        setMessages([]);
        msgCounter.current = 0;
        break;

      case "/redraw": {
        setMessages((prev) => [...prev]);
        setStatus(status);
        setMessages((prev) => [...prev, { id: ++msgCounter.current, agentId: "system", role: "speaker",
          content: "🔄 Screen redrawn.", timestamp: Date.now() }]);
        break;
      }

      case "/allow": {
        const level = parts[1]?.toLowerCase();
        if (level === "all") {
          orchestrator.setPermission("all");
          setMessages((prev) => [...prev, { id: ++msgCounter.current, agentId: "system", role: "speaker",
            content: "Full access granted. Agents can run any command.", timestamp: Date.now() }]);
        } else if (level === "safe") {
          orchestrator.setPermission("safe");
          setMessages((prev) => [...prev, { id: ++msgCounter.current, agentId: "system", role: "speaker",
            content: "Safe mode. Commands go through Critic review.", timestamp: Date.now() }]);
        } else if (level === "ask") {
          orchestrator.setPermission("ask");
          setMessages((prev) => [...prev, { id: ++msgCounter.current, agentId: "system", role: "speaker",
            content: "Ask mode. Agent will ask before any tool use.", timestamp: Date.now() }]);
        } else {
          setMessages((prev) => [...prev, { id: ++msgCounter.current, agentId: "system", role: "speaker",
            content: `Current: ${orchestrator.getPermission()}\n\n/allow all | safe | ask`, timestamp: Date.now() }]);
        }
        break;
      }

      case "/mcp": {
        const mcp = orchestrator.getMCPRegistry();
        const tools = mcp.getTools();
        const skills = mcp.getSkills();
        const lines: string[] = [];
        if (tools.length > 0) {
          const byServer = new Map<string, typeof tools>();
          for (const t of tools) { const l = byServer.get(t.server) ?? []; l.push(t); byServer.set(t.server, l); }
          lines.push(`MCP Servers (${byServer.size}):`);
          for (const [srv, tls] of Array.from(byServer)) lines.push(`  ${srv} — ${tls.length} tools`);
        } else { lines.push("No MCP servers detected."); }
        if (skills.length > 0) {
          lines.push("", `Skills (${skills.length}):`);
          for (const s of skills) lines.push(`  ${s.name} — ${s.description}`);
        } else { lines.push("", "No skills installed. Create in ~/.nexus/skills/"); }
        setMessages((prev) => [...prev, { id: ++msgCounter.current, agentId: "system", role: "speaker",
          content: lines.join("\n"), timestamp: Date.now() }]);
        break;
      }

      case "/skills": {
        const skills = orchestrator.getMCPRegistry().getSkills();
        if (skills.length === 0) {
          setMessages((prev) => [...prev, { id: ++msgCounter.current, agentId: "system", role: "speaker",
            content: "No skills installed.\n\nCreate: write SKILL.md in ~/.nexus/skills/<name>/", timestamp: Date.now() }]);
        } else {
          setMessages((prev) => [...prev, { id: ++msgCounter.current, agentId: "system", role: "speaker",
            content: skills.map((s) => `  ${s.name} [${s.category}]\n    ${s.description}`).join("\n\n"), timestamp: Date.now() }]);
        }
        break;
      }

      case "/cost": {
        setMessages((prev) => [...prev, { id: ++msgCounter.current, agentId: "system", role: "speaker",
          content: orchestrator.getCostTracker().getSummary(), timestamp: Date.now() }]);
        break;
      }

      case "/bg": {
        const sub = parts[1]?.toLowerCase();
        const bg = orchestrator.getBackgroundAgent();
        if (sub === "run" && parts[2]) {
          const cmd = parts.slice(2).join(" ");
          const id = await bg.submit(cmd, cmd.slice(0, 60));
          setMessages((prev) => [...prev, { id: ++msgCounter.current, agentId: "system", role: "speaker",
            content: `⏳ Background task [${id}] started: ${cmd.slice(0, 60)}`, timestamp: Date.now() }]);
        } else {
          setMessages((prev) => [...prev, { id: ++msgCounter.current, agentId: "system", role: "speaker",
            content: bg.getSummary() + "\n\nUsage: /bg run <command>", timestamp: Date.now() }]);
        }
        break;
      }

      case "/gh": {
        const sub = parts[1]?.toLowerCase();
        const gh = orchestrator.getGitHubAgent();
        if (sub === "pr" && parts[2]) {
          const title = parts[2]!;
          const body = parts.slice(3).join(" ") || "Automated PR from Nexus";
          const result = await gh.pushAndPR(title, body);
          setMessages((prev) => [...prev, { id: ++msgCounter.current, agentId: "system", role: "speaker",
            content: result.success ? `✅ ${result.message}` : `❌ ${result.message}`, timestamp: Date.now() }]);
        } else if (sub === "issues") {
          const issues = await gh.listIssues();
          setMessages((prev) => [...prev, { id: ++msgCounter.current, agentId: "system", role: "speaker",
            content: issues.join("\n") || "No issues", timestamp: Date.now() }]);
        } else if (sub === "clone" && parts[2]) {
          const result = await gh.clone(parts[2]!);
          setMessages((prev) => [...prev, { id: ++msgCounter.current, agentId: "system", role: "speaker",
            content: result.success ? `✅ Cloned to ${result.path}` : `❌ ${result.error}`, timestamp: Date.now() }]);
        } else {
          setMessages((prev) => [...prev, { id: ++msgCounter.current, agentId: "system", role: "speaker",
            content: "GitHub Agent:\n  /gh pr <title> [body]  — Push & create PR\n  /gh issues             — List open issues\n  /gh clone <url>         — Clone repo", timestamp: Date.now() }]);
        }
        break;
      }

      case "/exit":
        exit();
        break;

      case "/uninstall": {
        setMessages((prev) => [...prev, { id: ++msgCounter.current, agentId: "system", role: "speaker",
          content: "To uninstall Nexus:\n\n  nexus-update uninstall\n\nRemoves ~/.nexus/ + npm package.", timestamp: Date.now() }]);
        break;
      }

      case "/new": {
        const what = parts[1]?.toLowerCase();
        if (what === "agent") {
          startWizard("new-agent", [
            { prompt: "🆕 New Agent — ID (e.g. coder2):", key: "id" },
            { prompt: "Name (e.g. Coder 2):", key: "name" },
            { prompt: "Role description:", key: "role" },
            { prompt: "Provider (deepseek/openai/ollama):", key: "provider", options: orchestrator.getProviderIds() },
            { prompt: "Model name:", key: "model" },
            { prompt: "Capabilities (thinking,coding,research,command_execution,criticism,summarization):", key: "capabilities" },
            { prompt: "Priority (1-10, lower=first):", key: "priority" },
          ]);
        } else if (what === "provider") {
          startWizard("new-provider", [
            { prompt: "🔌 New Provider — Type (openai/anthropic/gemini/ollama/deepseek/groq/openai-compatible):", key: "type" },
            { prompt: "API Key (or empty for local):", key: "key" },
            { prompt: "Base URL (optional, Enter to skip):", key: "url" },
          ]);
        } else {
          setMessages((prev) => [...prev, { id: ++msgCounter.current, agentId: "system", role: "speaker",
            content: "🧙 Wizard: /new agent | /new provider\n\nEach will guide you step by step.", timestamp: Date.now() }]);
        }
        break;
      }

      case "/status":
        setMessages((prev) => [...prev, { id: ++msgCounter.current, agentId: "system", role: "speaker",
          content: `Status: ${status}\nAgents: ${agents.length}\nMessages: ${messages.length}`, timestamp: Date.now() }]);
        break;

      default:
        setMessages((prev) => [...prev, { id: ++msgCounter.current, agentId: "system", role: "speaker",
          content: `Unknown command: ${command}. Type /help for available commands.`, timestamp: Date.now() }]);
    }

    setInput("");
    inputRef.current = "";
    setSuggestionIndex(-1);
  };

  // ─── Colors ─────────────────────────────────────────────

  const isThinking = status === "analyzing" || status === "running" || status.includes("...");
  const [thinkingDots, setThinkingDots] = useState("");

  useEffect(() => {
    if (!isThinking) { setThinkingDots(""); return; }
    const dots = ["", ".", "..", "..."];
    let i = 0;
    const timer = setInterval(() => {
      i = (i + 1) % dots.length;
      setThinkingDots(dots[i] ?? "");
    }, 400);
    return () => clearInterval(timer);
  }, [isThinking]);

  const statusColor = status === "complete" ? "green" :
    status.startsWith("error") ? "red" :
    status === "idle" ? "gray" : "yellow";

  // ─── Render ─────────────────────────────────────────────

  const rainbowColors = ["red", "yellow", "green", "cyan", "blue", "magenta"] as const;

  return (
    <Box flexDirection="column" height="100%">
      {/* BRUTALIST HEADER — thick borders, rainbow title */}
      <Box borderStyle="double" borderColor="magenta" flexDirection="column" paddingX={1}>
        <Box>
          <Text bold>
            <Text color="red">N</Text><Text color="yellow">E</Text><Text color="green">X</Text><Text color="cyan">U</Text><Text color="blue">S</Text>
          </Text>
          <Text color="gray"> ▐ </Text>
          <Text color="gray" bold>MULTI-AGENT TERMINAL</Text>
          <Box marginLeft={2}>
            <Text color={statusColor} bold>■ {status.toUpperCase()}{thinkingDots}</Text>
          </Box>
        </Box>
      </Box>

      {/* Agent status bar — brutal */}
      <Box borderStyle="single" borderColor="gray" paddingX={1}>
        <Box gap={1} flexWrap="wrap">
          {agents.slice(0, 8).map((a, i) => (
            <Text key={a.id} color={isThinking && status !== "idle" ? rainbowColors[i % 6] : "gray"}>
              {isThinking ? "▣" : "□"} {a.id.slice(0, 10)}
            </Text>
          ))}
        </Box>
      </Box>

      {/* Messages — alternating colors */}
      <Box flexDirection="column" flexGrow={1} paddingX={1}>
        {messages.map((msg, idx) => {
          const lineColor = rainbowColors[idx % 6];
          return (
          <Box key={msg.id} flexDirection="column" marginY={0}>
            <Box>
              <Text bold color={msg.agentId === "user" ? "green" : lineColor}>
                {msg.agentId === "user" ? "▸" : "▹"} {msg.agentId.toUpperCase()}
              </Text>
              {msg.role === "interjection" && <Text color="yellow" dimColor> ↳</Text>}
              {msg.role === "tool" && <Text color="gray" dimColor> ⚙</Text>}
              {msg.tokensUsed ? <Text color="gray" dimColor> {msg.tokensUsed}t</Text> : null}
              {msg.elapsedMs ? <Text color="gray" dimColor> {(msg.elapsedMs/1000).toFixed(1)}s</Text> : null}
            </Box>
            <Box paddingLeft={2}>
              {msg.isPasted ? (
                <Box flexDirection="column">
                  <Text color="yellow" bold>{msg.pasteSummary ?? msg.content}</Text>
                </Box>
              ) : (
                <Text>{msg.content}</Text>
              )}
            </Box>
          </Box>
        )})}
      </Box>

      {/* Help overlay — compact 2-col */}
      {showHelp && (
        <Box borderStyle="round" borderColor="yellow" paddingX={1} flexDirection="row" gap={2}>
          <Box flexDirection="column">
            <Text bold underline>Commands</Text>
            <Text>/agents /providers /models /model</Text>
            <Text>/doctor /sessions /resume /export</Text>
            <Text>/think /code /exec /memory</Text>
            <Text>/config /new /allow /cost</Text>
            <Text>/mcp /skills /gh /bg</Text>
          </Box>
          <Box flexDirection="column">
            <Text bold underline>Shortcuts</Text>
            <Text>/clear /redraw /status /exit</Text>
            <Text>/help (toggle this)</Text>
            <Text>Tab:autocomplete ↑↓:navigate</Text>
            <Text>/:show all commands</Text>
          </Box>
        </Box>
      )}

      {/* Command suggestions */}
      {showSuggestions && (
        <Box borderStyle="single" borderColor="blue" flexDirection="column" paddingX={1}>
          <Text color="blue" bold> Commands </Text>
          {matchingSuggestions.length > 0 ? (
            matchingSuggestions.map((cmd, idx) => {
              const isSelected = idx === suggestionIndex;
              return (
                <Box key={cmd.name} gap={1}>
                  <Text color={isSelected ? "green" : "gray"}>{isSelected ? "▶" : " "}</Text>
                  <Text color={isSelected ? "green" : "cyan"} bold={isSelected}>{cmd.name}</Text>
                  {cmd.usage && <Text color={isSelected ? "white" : "gray"}>{cmd.usage}</Text>}
                  <Text color="gray" dimColor>— {cmd.desc}</Text>
                </Box>
              );
            })
          ) : (
            <Box>
              <Text color="gray" dimColor>  Type a command or press Enter to run</Text>
            </Box>
          )}
          <Text color="gray" dimColor>  Tab: complete  ↑↓: select  Esc: clear</Text>
        </Box>
      )}

      {/* Wizard UI */}
      {wizardRef.current && (
        <Box borderStyle="round" borderColor="magenta" flexDirection="column" paddingX={1}>
          <Box>
            <Text color="magenta" bold>🧙 Wizard — Step {wizardRef.current.index + 1}/{wizardRef.current.steps.length}</Text>
            <Text color="gray" dimColor>  (type "cancel" to abort)</Text>
          </Box>
          <Box marginY={1}>
            <Text color="white">{wizardPrompt}</Text>
          </Box>
          {wizardOptions.length > 0 && (
            <Box flexDirection="column" marginBottom={1}>
              {wizardOptions.map((opt, i) => (
                <Text key={i} color="gray">  {i + 1}. {opt}</Text>
              ))}
            </Box>
          )}
        </Box>
      )}

      {/* Input */}
      <Box borderStyle="round" borderColor={wizardRef.current ? "magenta" : pendingPrompt ? "yellow" : "gray"} paddingX={1}>
        {wizardRef.current ? (
          <Text color="magenta" bold>🧙 [{wizardRef.current.index + 1}/{wizardRef.current.steps.length}]</Text>
        ) : pendingPrompt ? (
          <Text color="yellow" bold>{pendingPrompt}</Text>
        ) : (
          <Text bold color="green">❯</Text>
        )}
        <Text> {input}</Text>
        <Text color="gray">█</Text>
      </Box>
    </Box>
  );
}

function getAgentColor(agentId: string): string {
  const colors: Record<string, string> = {
    orchestrator: "cyan", planner: "blue", coder: "green",
    executor: "magenta", researcher: "yellow", critic: "red",
    summarizer: "gray", user: "white", system: "gray",
  };
  return colors[agentId] ?? "white";
}
