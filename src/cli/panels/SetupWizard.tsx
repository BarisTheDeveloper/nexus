import React, { useState } from "react";
import { Box, Text, useInput, useApp } from "ink";

interface SetupWizardProps {
  onComplete: () => void;
}

type Step = "welcome" | "provider-type" | "provider-key" | "provider-url" | "test" | "done";

const PROVIDER_TYPES = [
  { id: "deepseek", name: "DeepSeek", desc: "Cheap, fast, Chinese LLM", defaultModel: "deepseek-chat" },
  { id: "openai", name: "OpenAI", desc: "GPT-4o, o1 series", defaultModel: "gpt-4o" },
  { id: "anthropic", name: "Anthropic", desc: "Claude Sonnet, Opus", defaultModel: "claude-sonnet-4-20250514" },
  { id: "gemini", name: "Google Gemini", desc: "Gemini 1.5/2.0 series", defaultModel: "gemini-1.5-pro" },
  { id: "ollama", name: "Ollama (Local)", desc: "Free, no key needed", defaultModel: "llama3.2" },
  { id: "groq", name: "Groq", desc: "Fast LPU inference", defaultModel: "llama-3.1-70b-versatile" },
  { id: "zai", name: "Z.AI", desc: "GLM series", defaultModel: "glm-5" },
];

export function SetupWizard({ onComplete }: SetupWizardProps) {
  const { exit } = useApp();
  const [step, setStep] = useState<Step>("welcome");
  const [providerType, setProviderType] = useState("");
  const [providerKey, setProviderKey] = useState("");
  const [providerUrl, setProviderUrl] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);

  useInput((_input, key) => {
    if (key.return) {
      switch (step) {
        case "welcome":
          setStep("provider-type");
          break;
        case "provider-type":
          if (selectedIndex >= 0 && selectedIndex < PROVIDER_TYPES.length) {
            const pt = PROVIDER_TYPES[selectedIndex]!;
            setProviderType(pt.id);
            if (pt.id === "ollama") {
              setProviderUrl("http://localhost:11434");
              setStep("test");
            } else {
              setStep("provider-key");
            }
          }
          break;
        case "provider-key":
          setStep("provider-url");
          break;
        case "provider-url":
          setStep("test");
          break;
        case "test":
        case "done":
          onComplete();
          exit();
          break;
      }
      return;
    }

    if (key.upArrow && step === "provider-type") {
      setSelectedIndex((p) => (p <= 0 ? PROVIDER_TYPES.length - 1 : p - 1));
    }
    if (key.downArrow && step === "provider-type") {
      setSelectedIndex((p) => (p >= PROVIDER_TYPES.length - 1 ? 0 : p + 1));
    }

    // Text input for key/url steps
    if (step === "provider-key" || step === "provider-url") {
      if (key.backspace || key.delete) {
        const setter = step === "provider-key" ? setProviderKey : setProviderUrl;
        setter((p) => p.slice(0, -1));
      } else if (_input && !key.ctrl && !key.meta) {
        const setter = step === "provider-key" ? setProviderKey : setProviderUrl;
        setter((p) => p + _input);
      }
    }
  });

  return (
    <Box flexDirection="column" borderStyle="double" borderColor="magenta" padding={2}>
      <Box flexDirection="column" marginBottom={1}>
        <Text color="magenta" bold>NEXUS</Text>
        <Text color="gray">First Run Setup</Text>
      </Box>

      {step === "welcome" && (
        <Box flexDirection="column">
          <Text>Welcome to Nexus! Let's configure your first AI provider.</Text>
          <Text color="gray" dimColor>This only takes 30 seconds.</Text>
          <Box marginTop={1}>
            <Text color="green">Press Enter to continue</Text>
          </Box>
        </Box>
      )}

      {step === "provider-type" && (
        <Box flexDirection="column">
          <Text bold>Select a provider:</Text>
          <Box flexDirection="column" marginY={1}>
            {PROVIDER_TYPES.map((pt, i) => (
              <Box key={pt.id}>
                <Text color={i === selectedIndex ? "green" : "gray"}>
                  {i === selectedIndex ? "▶" : " "} {pt.name.padEnd(18)}
                </Text>
                <Text color={i === selectedIndex ? "white" : "gray"} dimColor>— {pt.desc}</Text>
              </Box>
            ))}
          </Box>
          <Text color="gray" dimColor>↑↓ to navigate, Enter to select</Text>
        </Box>
      )}

      {step === "provider-key" && (
        <Box flexDirection="column">
          <Text bold>API Key for {providerType}:</Text>
          <Text color="gray" dimColor>Starts with sk-... (or paste full key)</Text>
          <Box marginY={1}>
            <Text color="yellow">{providerKey.replace(/./g, "•") || "..."}</Text>
          </Box>
          <Text color="gray" dimColor>Type key, Enter when done</Text>
        </Box>
      )}

      {step === "provider-url" && (
        <Box flexDirection="column">
          <Text bold>Base URL (optional):</Text>
          <Text color="gray" dimColor>Press Enter to use default for {providerType}</Text>
          <Box marginY={1}>
            <Text color="yellow">{providerUrl || "(default)"}</Text>
          </Box>
        </Box>
      )}

      {step === "test" && (
        <Box flexDirection="column">
          <Text color="yellow">Testing connection to {providerType}...</Text>
          <Text color="gray" dimColor>Key: {providerKey.slice(0, 8)}...{providerKey.slice(-4)}</Text>
          {providerUrl && <Text color="gray" dimColor>URL: {providerUrl}</Text>}
          <Box marginTop={1}>
            <Text color="green">Press Enter to save and start</Text>
          </Box>
        </Box>
      )}

      <Box marginTop={2} borderStyle="single" borderColor="gray" paddingX={1}>
        <Text color="gray" dimColor>
          {step === "welcome" ? "Welcome" :
           step === "provider-type" ? `Provider [${selectedIndex + 1}/${PROVIDER_TYPES.length}]` :
           step === "provider-key" ? "API Key" :
           step === "provider-url" ? "Base URL" :
           step === "test" ? "Testing..." : "Done"}
        </Text>
      </Box>
    </Box>
  );
}
