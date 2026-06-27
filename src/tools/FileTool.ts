import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from "node:fs";
import type { ToolResult } from "../config/types.js";

export class FileTool {
  name = "file_tool";

  async read(path: string): Promise<ToolResult> {
    try {
      const content = readFileSync(path, "utf-8");
      return {
        success: true,
        stdout: content,
        stderr: "",
      };
    } catch (error) {
      return {
        success: false,
        stdout: "",
        stderr: "",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async write(path: string, content: string): Promise<ToolResult> {
    try {
      const dir = path.split(/[/\\]/).slice(0, -1).join("/");
      if (dir && !existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      writeFileSync(path, content, "utf-8");
      return {
        success: true,
        stdout: `Written ${content.length} bytes to ${path}`,
        stderr: "",
      };
    } catch (error) {
      return {
        success: false,
        stdout: "",
        stderr: "",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async list(path: string): Promise<ToolResult> {
    try {
      if (!existsSync(path)) {
        return {
          success: false,
          stdout: "",
          stderr: "",
          error: `Path does not exist: ${path}`,
        };
      }
      const entries = readdirSync(path, { withFileTypes: true });
      const listing = entries.map((e) =>
        `${e.isDirectory() ? "📁" : "📄"} ${e.name}`
      ).join("\n");
      return {
        success: true,
        stdout: listing,
        stderr: "",
      };
    } catch (error) {
      return {
        success: false,
        stdout: "",
        stderr: "",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
