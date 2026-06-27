#!/usr/bin/env node
import React from "react";
import { render } from "ink";
import meow from "meow";
import { Orchestrator } from "../core/Orchestrator.js";
import { ChatPanel } from "./panels/ChatPanel.js";
import { SetupWizard } from "./panels/SetupWizard.js";
import { ensureNexusDir } from "../config/ConfigLoader.js";

// Ensure config directory exists
ensureNexusDir();

const cli = meow(
  `
  Usage
    $ nexus [options]

  Options
    --help       Show this help message
    --version    Show version
    --sessions   List past sessions
    --resume     Resume a session: --resume <session-id>
    --resume-no  Resume session by list number: --resume-no <n>

  Commands (inside the app):
    /help       Show help
    /agents     List agents
    /sessions   List saved sessions
    /resume     Resume a session: /resume <id>
    /clear      Clear chat
    /status     Show status
    /doctor     Run health check
    /config     View/change configuration
    /exit       Exit

  Examples
    $ nexus                     Start a new session
    $ nexus --sessions          List past sessions
    $ nexus --resume abc123     Resume session abc123
    $ nexus --resume-no 1       Resume the most recent session
`,
  {
    importMeta: import.meta,
    flags: {
      sessions: { type: "boolean", default: false },
      resume: { type: "string" },
      resumeNo: { type: "number" },
    },
  },
);

async function main() {
  const orchestrator = new Orchestrator();

  // Handle --sessions flag
  if (cli.flags.sessions) {
    const sessions = orchestrator.listSessions();
    if (sessions.length === 0) {
      console.log("No saved sessions found.");
    } else {
      console.log(`Saved Sessions (${sessions.length}):\n`);
      for (const s of sessions) {
        const date = new Date(s.startedAt).toLocaleString();
        console.log(`  [${s.number}] ${s.id.slice(0, 8)}...  ${date}  (${s.messageCount} msgs)`);
        console.log(`      ${s.preview}`);
        console.log("");
      }
      console.log(`Resume with: nexus --resume <id>  or  nexus --resume-no <n>`);
    }
    process.exit(0);
  }

  // Handle --resume-no flag (resume by list number)
  if (cli.flags.resumeNo !== undefined) {
    const sessions = orchestrator.listSessions();
    const session = sessions.find((s) => s.number === cli.flags.resumeNo);
    if (!session) {
      console.error(`Session #${cli.flags.resumeNo} not found.`);
      console.error(`Available: ${sessions.map((s) => `#${s.number}`).join(", ") || "none"}`);
      process.exit(1);
    }
    const messages = orchestrator.resumeSession(session.id);
    if (!messages) {
      console.error(`Failed to resume session ${session.id}`);
      process.exit(1);
    }
    console.log(`Resumed session #${session.number} (${session.id.slice(0, 8)}...) — ${messages.length} messages loaded`);
    render(<ChatPanel orchestrator={orchestrator} />);
    return;
  }

  // Handle --resume flag
  if (cli.flags.resume) {
    const resumeId = cli.flags.resume;
    const messages = orchestrator.resumeSession(resumeId);
    if (!messages) {
      // Try partial ID match
      const sessions = orchestrator.listSessions();
      const match = sessions.find((s) => s.id.startsWith(resumeId));
      if (match) {
        const msgs = orchestrator.resumeSession(match.id);
        if (msgs) {
          console.log(`Resumed session #${match.number} (${match.id.slice(0, 8)}...) — ${msgs.length} messages loaded`);
          render(<ChatPanel orchestrator={orchestrator} />);
          return;
        }
      }
      console.error(`Session "${resumeId}" not found.`);
      console.error("Use --sessions to list available sessions.");
      process.exit(1);
    }
    console.log(`Resumed session ${resumeId.slice(0, 8)}... — ${messages.length} messages loaded`);
    render(<ChatPanel orchestrator={orchestrator} />);
    return;
  }

  // Default: check if first run (no real config)
  const provInfo = orchestrator.getProvidersInfo();
  if (provInfo.length === 0) {
    const { waitUntilExit } = render(<SetupWizard onComplete={() => {}} />);
    await waitUntilExit();
    const newOrch = new Orchestrator();
    render(<ChatPanel orchestrator={newOrch} />);
    return;
  }

  render(<ChatPanel orchestrator={orchestrator} />);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
