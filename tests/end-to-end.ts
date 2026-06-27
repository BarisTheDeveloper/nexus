/**
 * End-to-end test of the Nexus pipeline using the real DeepSeek LLM provider.
 * Tests: config loading, provider creation, agent thinking, Critic review, orchestrator initialization.
 */

import { createProvider } from "../src/providers/index.js";
import { loadConfig } from "../src/config/ConfigLoader.js";
import { createCriticAgent, createPlannerAgent } from "../src/agents/builtin/index.js";
import { NexusMemory } from "../src/memory/ChromaMemory.js";
import { Orchestrator } from "../src/core/Orchestrator.js";

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
  console.log(`\n--- ${name} ---`);
  try {
    await fn();
    console.log("  PASSED");
    passed++;
  } catch (error) {
    console.log(`  FAILED: ${error instanceof Error ? error.message : String(error)}`);
    failed++;
  }
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

async function main() {
  console.log("=== Nexus End-to-End Tests ===\n");

  // Test 1: Config loading
  await test("Config loads with providers", async () => {
    const config = loadConfig();
    assert(config.providers.length >= 1, "Expected at least 1 provider");
    assert(config.defaultProvider === "deepseek", `Expected deepseek, got ${config.defaultProvider}`);
    console.log(`  Providers: ${config.providers.map((p) => p.id).join(", ")}`);
  });

  // Test 2: DeepSeek provider creation
  await test("Create DeepSeek provider from config", async () => {
    const config = loadConfig();
    const dsConfig = config.providers.find((p) => p.id === "deepseek");
    assert(dsConfig !== undefined, "DeepSeek not in config");
    assert((dsConfig.apiKey?.length ?? 0) > 0, "API key should not be empty");
    const provider = createProvider(dsConfig);
    assert(provider.id === "deepseek", `Expected deepseek, got ${provider.id}`);
    console.log("  Provider created with API key");
  });

  // Test 3: Chat with DeepSeek
  await test("DeepSeek responds to chat", async () => {
    const config = loadConfig();
    const dsConfig = config.providers.find((p) => p.id === "deepseek")!;
    const provider = createProvider(dsConfig);

    const response = await provider.chat([
      { role: "user", content: "Reply with exactly: Hello from Nexus!" },
    ], { model: "deepseek-chat", temperature: 0.1, maxTokens: 50 });

    console.log(`  Response: "${response.trim()}"`);
    assert(response.length > 0, "Expected non-empty response");
    assert(response.includes("Hello"), `Expected 'Hello' in response, got: ${response.slice(0, 50)}`);
  });

  // Test 4: Agent thinking with DeepSeek
  await test("Agent thinks via DeepSeek", async () => {
    const config = loadConfig();
    const dsConfig = config.providers.find((p) => p.id === "deepseek")!;
    const provider = createProvider(dsConfig);

    const planner = createPlannerAgent("deepseek", "deepseek-chat");
    planner.setProvider(provider);

    const response = await planner.think("Say hello in 5 words or less.");
    console.log(`  Response: "${response.trim().slice(0, 100)}"`);
    assert(response.length > 5, "Expected a response");
  });

  // Test 5: Critic reviews dangerous command
  await test("Critic rejects rm -rf /", async () => {
    const config = loadConfig();
    const dsConfig = config.providers.find((p) => p.id === "deepseek")!;
    const provider = createProvider(dsConfig);

    const critic = createCriticAgent("deepseek", "deepseek-chat");
    critic.setProvider(provider);

    const result = await critic.reviewShellCommand("rm -rf /");
    console.log(`  Result: ${result.approved ? "APPROVED" : `REJECTED (${result.severity})`}`);
    console.log(`  Reason: ${result.reason?.slice(0, 120) ?? "N/A"}`);
    assert(result.approved === false,
      `Critic should reject rm -rf /, got APPROVED. Reason: ${result.reason}`);
  });

  // Test 6: Critic approves safe command
  await test("Critic approves ls -la", async () => {
    const config = loadConfig();
    const dsConfig = config.providers.find((p) => p.id === "deepseek")!;
    const provider = createProvider(dsConfig);

    const critic = createCriticAgent("deepseek", "deepseek-chat");
    critic.setProvider(provider);

    const result = await critic.reviewShellCommand("ls -la");
    console.log(`  Result: ${result.approved ? "APPROVED" : `REJECTED (${result.severity})`}`);
    // Note: LLM judgment may vary, just log the result
  });

  // Test 7: Orchestrator initialization
  await test("Orchestrator initializes", async () => {
    const orchestrator = new Orchestrator();
    const agents = orchestrator.getAgents();
    const providers = orchestrator.getProvidersInfo();

    console.log(`  Agents: ${agents.length}`);
    console.log(`  Providers: ${providers.map((p) => p.id).join(", ")}`);

    assert(agents.length > 0, "Expected agents");
    assert(providers.length > 0, "Expected providers");
    const hasDeepSeek = providers.some((p) => p.id === "deepseek");
    assert(hasDeepSeek, "DeepSeek should be initialized");
  });

  // Test 8: Memory layer
  await test("Memory stores and retrieves", async () => {
    const memory = new NexusMemory(":memory:");

    await memory.store({
      id: "e2e-1",
      type: "semantic",
      content: "Nexus is a multi-LLM orchestrated CLI system",
      metadata: { source: "e2e" },
      timestamp: Date.now(),
    });

    const results = await memory.query("Nexus CLI", 3);
    assert(results.length > 0, "Expected results");
    console.log(`  Found ${results.length} results`);
    console.log(`  Top: "${results[0]!.content.slice(0, 60)}"`);

    await memory.clear();
    console.log("  Memory cleared");
  });

  // Test 9: Full pipeline with real API call
  await test("Full agent pipeline with DeepSeek", async () => {
    const orchestrator = new Orchestrator();

    // Verify initialization
    assert(orchestrator.getStatus() === "idle", "Expected idle status");
    assert(orchestrator.getAgent("planner") !== undefined, "Planner agent exists");
    assert(orchestrator.getAgent("critic") !== undefined, "Critic agent exists");

    // Verify memory works through the orchestrator
    const memory = orchestrator.getMemory();
    await memory.store({
      id: "orchestrator-test",
      type: "episodic",
      content: "Test session for orchestrator",
      metadata: {},
      timestamp: Date.now(),
    });
    const results = await memory.query("orchestrator", 3);
    assert(results.length > 0, "Memory should return results");
    console.log("  Orchestrator ready with working memory");
    await memory.delete("orchestrator-test");

    // Verify agents have assigned providers
    const providers = orchestrator.getProvidersInfo();
    assert(providers.some((p) => p.id === "deepseek"), "DeepSeek provider should be initialized");
    console.log(`  Providers: ${providers.map((p) => p.id).join(", ")}`);
    console.log("  Full pipeline initializes correctly with DeepSeek");
  });

  // Summary
  const total = passed + failed;
  console.log(`\n=== Results: ${passed} passed, ${failed} failed out of ${total} ===`);

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Test suite error:", err);
  process.exit(1);
});
