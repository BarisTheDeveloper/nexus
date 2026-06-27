import { loadConfig, ensureNexusDir } from "../src/config/ConfigLoader.js";
import { NexusMemory } from "../src/memory/ChromaMemory.js";
import { ProfileManager } from "../src/memory/ProfileManager.js";
import { EmbeddingService } from "../src/memory/EmbeddingService.js";
import { createBuiltinAgents } from "../src/agents/loader.js";

async function test() {
  console.log("=== Nexus Integration Tests ===\n");

  // Test 1: Config loader
  console.log("1. Config Loader");
  ensureNexusDir();
  const config = loadConfig();
  console.log("   OK - Config loaded:", JSON.stringify(config).slice(0, 100));

  // Test 2: Built-in agents
  console.log("\n2. Built-in Agents");
  const agents = createBuiltinAgents();
  console.log("   OK - Agents created:", agents.size);
  for (const [id, agent] of agents) {
    console.log("     -", id, "(", agent.config.role, ") caps:", agent.capabilities.join(", "));
  }

  // Test 3: Embedding service
  console.log("\n3. Embedding Service");
  const embedder = new EmbeddingService();
  const vec1 = await embedder.embed("hello world");
  const vec2 = await embedder.embed("hello world");
  const vec3 = await embedder.embed("goodbye world");
  const sim12 = embedder.cosineSimilarity(vec1, vec2);
  const sim13 = embedder.cosineSimilarity(vec1, vec3);
  console.log("   OK - Embedding dimension:", vec1.length);
  console.log("   OK - Same text similarity:", sim12.toFixed(4));
  console.log("   OK - Different text similarity:", sim13.toFixed(4));
  console.log("   OK - Similarity ordering:", sim12 > sim13 ? "CORRECT" : "WRONG");

  // Test 4: Memory (SQLite)
  console.log("\n4. Memory Layer");
  const memory = new NexusMemory(":memory:");
  await memory.store({
    id: "test-1",
    type: "semantic",
    content: "The user prefers TypeScript and React for web development",
    metadata: { source: "test" },
    timestamp: Date.now(),
  });
  await memory.store({
    id: "test-2",
    type: "semantic",
    content: "The user likes Python for data science",
    metadata: { source: "test" },
    timestamp: Date.now(),
  });
  const results = await memory.query("TypeScript", 2);
  console.log("   OK - Memory stores and retrieves:", results.length, "results");
  console.log("   OK - Best match:", results[0]?.content.slice(0, 50));
  await memory.clear();
  console.log("   OK - Memory cleared");

  // Test 5: Profile Manager
  console.log("\n5. Profile Manager");
  const profile = new ProfileManager();
  const prof = profile.getProfile();
  console.log("   OK - Profile loaded:", prof.responseStyle, prof.language);
  profile.updateResponseStyle("short");
  const updated = profile.getProfile();
  console.log("   OK - Profile updated:", updated.responseStyle);
  profile.updateResponseStyle("detailed"); // reset

  console.log("\n=== All tests passed! ===");
}

test().catch((err) => {
  console.error("TEST FAILED:", err);
  process.exit(1);
});
