import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { parse, stringify } from "yaml";
import type { UserProfile, ProjectContext } from "../config/types.js";

const PROFILE_PATH = join(homedir(), ".nexus", "profile.yaml");

const DEFAULT_PROFILE: UserProfile = {
  language: "en",
  preferredProviders: [],
  preferredModels: {},
  responseStyle: "detailed",
  projectContexts: [],
  shortcuts: {},
};

export class ProfileManager {
  private profile: UserProfile;

  constructor() {
    this.profile = this.load();
  }

  private load(): UserProfile {
    if (!existsSync(PROFILE_PATH)) {
      return { ...DEFAULT_PROFILE };
    }
    try {
      const raw = readFileSync(PROFILE_PATH, "utf-8");
      const parsed = parse(raw) as UserProfile;
      return { ...DEFAULT_PROFILE, ...parsed };
    } catch {
      return { ...DEFAULT_PROFILE };
    }
  }

  private save(): void {
    const dir = join(homedir(), ".nexus");
    if (!existsSync(dir)) {
      // Directory created by ConfigLoader
    }
    writeFileSync(PROFILE_PATH, stringify(this.profile), "utf-8");
  }

  getProfile(): UserProfile {
    return { ...this.profile };
  }

  updateLanguage(lang: string): void {
    this.profile.language = lang;
    this.save();
  }

  updateResponseStyle(style: "short" | "detailed" | "technical"): void {
    this.profile.responseStyle = style;
    this.save();
  }

  addProjectContext(ctx: ProjectContext): void {
    const existing = this.profile.projectContexts.findIndex((p) => p.path === ctx.path);
    if (existing >= 0) {
      this.profile.projectContexts[existing] = {
        ...ctx,
        lastAccessed: Date.now(),
      };
    } else {
      this.profile.projectContexts.push({ ...ctx, lastAccessed: Date.now() });
    }
    this.save();
  }

  addShortcut(key: string, value: string): void {
    this.profile.shortcuts[key] = value;
    this.save();
  }

  setPreferredModel(provider: string, model: string): void {
    this.profile.preferredModels[provider] = model;
    if (!this.profile.preferredProviders.includes(provider)) {
      this.profile.preferredProviders.push(provider);
    }
    this.save();
  }
}
