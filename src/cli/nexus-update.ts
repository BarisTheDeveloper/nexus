#!/usr/bin/env node
/**
 * nexus-update — self-updater for the Nexus CLI.
 * Checks npm for latest version and updates if needed.
 */
import { execa } from "execa";

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

  // Default: check
  const [current, latest] = await Promise.all([getCurrentVersion(), getLatestVersion()]);
  console.log(`Nexus CLI`);
  console.log(`  Installed: v${current}`);
  console.log(`  Latest:    v${latest}`);
  if (current !== latest && current !== "unknown") {
    console.log(`\n📦 Update available! Run: nexus-update install`);
  }
}

main().catch((error) => {
  console.error("Error:", error instanceof Error ? error.message : error);
  process.exit(1);
});
