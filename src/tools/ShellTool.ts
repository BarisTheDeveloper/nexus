import { execa } from "execa";
import type { ToolResult } from "../config/types.js";

export class ShellTool {
  name = "shell_exec";
  description = "Execute shell commands and return output";

  async execute(command: string): Promise<ToolResult> {
    try {
      const result = await execa(command, {
        shell: true,
        timeout: 30_000,
        reject: false,
      });

      return {
        success: result.exitCode === 0,
        stdout: result.stdout,
        stderr: result.stderr,
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

  async executeWithInput(command: string, input: string): Promise<ToolResult> {
    try {
      const result = await execa(command, {
        shell: true,
        input,
        timeout: 30_000,
        reject: false,
      });

      return {
        success: result.exitCode === 0,
        stdout: result.stdout,
        stderr: result.stderr,
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
