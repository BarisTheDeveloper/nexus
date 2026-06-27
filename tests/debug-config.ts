import { loadConfig } from "../src/config/ConfigLoader.js";

const config = loadConfig();
console.log("Full config:", JSON.stringify(config, null, 2));
console.log("Providers count:", config.providers.length);
console.log("Providers:", JSON.stringify(config.providers));
console.log("Default provider:", config.defaultProvider);
console.log("CriticApproval:", config.criticApproval);
