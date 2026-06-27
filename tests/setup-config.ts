import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { stringify } from "yaml";

const nexusDir = join(homedir(), ".nexus");
const configPath = join(nexusDir, "config.yaml");

if (!existsSync(nexusDir)) {
  mkdirSync(nexusDir, { recursive: true });
}

const config = {
  providers: [
    { id: "deepseek", apiKey: process.env.DEEPSEEK_API_KEY ?? "YOUR_DEEPSEEK_KEY" },
    { id: "zai", apiKey: process.env.ZAI_API_KEY ?? "YOUR_ZAI_KEY" },
  ],
  defaultProvider: "deepseek",
  defaultModel: "deepseek-chat",
  criticApproval: true,
};

writeFileSync(configPath, stringify(config), "utf-8");
console.log("Config written to:", configPath);
