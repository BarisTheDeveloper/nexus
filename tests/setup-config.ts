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
    { id: "deepseek", apiKey: "sk-fa0f7b634d28473798aeb4a9ca0fc036" },
    { id: "zai", apiKey: "${ZAI_API_KEY}" },
  ],
  defaultProvider: "deepseek",
  defaultModel: "deepseek-chat",
  criticApproval: true,
};

writeFileSync(configPath, stringify(config), "utf-8");
console.log("Config written to:", configPath);
console.log("Content:", stringify(config));
