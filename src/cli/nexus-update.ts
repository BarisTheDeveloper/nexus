#!/usr/bin/env node
/**
 * nexus-update — self-updater for the Nexus CLI.
 * Also handles: check, install, uninstall
 */
import { execa } from "execa";
import { existsSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

async function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => { rl.close(); resolve(answer.trim()); });
  });
}

async function getLatestVersion(): Promise<string> {
  const { stdout } = await execa("npm", ["view", "@baristhedeveloper/nexus", "version"], { timeout: 15_000 });
  return stdout.trim();
}

async function getCurrentVersion(): Promise<string> {
  try {
    const { stdout } = await execa("npm", ["list", "-g", "@baristhedeveloper/nexus", "--depth=0"], { timeout: 10_000 });
    const match = stdout.match(/@baristhedeveloper\/nexus@(\d+\.\d+\.\d+)/);
    return match?.[1] ?? "unknown";
  } catch {
    return "unknown";
  }
}

async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0]?.toLowerCase();

  if (cmd === "check") {
    const [current, latest] = await Promise.all([getCurrentVersion(), getLatestVersion()]);
    if (current === latest) {
      console.log(`✅ Nexus is up to date (v${current})`);
    } else {
      console.log(`📦 Update available: v${current} → v${latest}`);
      console.log("Run: nexus-update install");
    }
    return;
  }

  if (cmd === "install" || cmd === "update") {
    console.log("📦 Updating Nexus...");
    try {
      await execa("npm", ["install", "-g", "@baristhedeveloper/nexus@latest"], { stdio: "inherit", timeout: 120_000 });
      const version = await getCurrentVersion();
      console.log(`✅ Nexus updated to v${version}`);
    } catch (error) {
      console.error("❌ Update failed:", error instanceof Error ? error.message : error);
      process.exit(1);
    }
    return;
  }

  if (cmd === "uninstall") {
    console.log("⚠️  This will remove ALL Nexus data:");
    console.log("   - ~/.nexus/ (config, memory, sessions, skills)");
    console.log("   - npm package @baristhedeveloper/nexus");
    console.log("");
    const answer = await ask("Type 'yes' to confirm: ");
    if (answer.toLowerCase() !== "yes") {
      console.log("❌ Uninstall cancelled.");
      return;
    }

    // Remove ~/.nexus
    const nexusDir = join(homedir(), ".nexus");
    if (existsSync(nexusDir)) {
      try {
        rmSync(nexusDir, { recursive: true, force: true });
        console.log("✅ Removed ~/.nexus/");
      } catch (error) {
        console.log("⚠️  Could not remove ~/.nexus/:", error instanceof Error ? error.message : error);
      }
    } else {
      console.log("  ~/.nexus/ not found (already clean)");
    }

    // Remove npm package
    try {
      await execa("npm", ["uninstall", "-g", "@baristhedeveloper/nexus"], { stdio: "inherit", timeout: 60_000 });
      console.log("✅ Uninstalled @baristhedeveloper/nexus");
    } catch (error) {
      console.log("⚠️  npm uninstall warning:", error instanceof Error ? error.message : error);
    }

    console.log("\n✅ Nexus completely removed. Goodbye!");
    return;
  }

  // Default: check
  const [current, latest] = await Promise.all([getCurrentVersion(), getLatestVersion()]);
  console.log(`Nexus CLI`);
  console.log(`  Installed: v${current}`);
  console.log(`  Latest:    v${latest}`);
  if (current !== latest && current !== "unknown") {
    console.log(`\n📦 Update available! Run: nexus-update install`);
    console.log(`🗑  Uninstall: nexus-update uninstall`);
  }
}

main().catch((error) => {
  console.error("Error:", error instanceof Error ? error.message : error);
  process.exit(1);
});
