# Nexus

**Multi-LLM Orchestrated CLI — Multi-model, role-based AI system with persistent memory**

Nexus is a terminal-based multi-agent AI system. An orchestrator analyzes your request, selects specialist agents, lets them debate and contribute, then synthesizes a final response. Like a panel of AI experts working together.

## Installation

```bash
npm i -g @baristhedeveloper/nexus
nexus
```

Or from source:

```bash
git clone https://github.com/BarisTheDeveloper/nexus.git
cd nexus
pnpm install && pnpm build
pnpm dev
```

Update to latest:

```bash
nexus-update check
nexus-update install
```

## Quick Start

### 1. Add a provider

```
nexus
/new provider
```

Or manually create `~/.nexus/config.yaml`:

```yaml
providers:
  - id: deepseek
    apiKey: ${DEEPSEEK_API_KEY}  - id: openai
    apiKey: ${DEEPSEEK_API_KEY}defaultProvider: deepseek
defaultModel: deepseek-chat
criticApproval: true
```

### 2. Chat

Just type. Nexus will analyze, route to agents, and stream responses.

## Features

- **6 built-in agents** — Planner, Researcher, Coder, Executor, Critic, Summarizer
- **9 LLM providers** — OpenAI, Anthropic, Gemini, DeepSeek, Ollama, Groq, Fireworks, LM Studio, Z.AI
- **Streaming UI** — Token-by-token with thinking animation
- **Agent tools** — Shell, file, web search, GitHub (PR, issue, clone), background tasks
- **Function calling** — Native tool use on OpenAI, DeepSeek, Gemini, Ollama
- **Critic safety gate** — Shell commands reviewed before execution
- **Persistent memory** — SQLite + Ollama embeddings (768-dim) or hash fallback
- **Session resume** — `nexus --sessions` / `nexus --resume <id>`
- **Custom agents** — `/new agent` wizard or `agents.yaml`
- **Permission system** — `/allow all | safe | ask`
- **Cost tracker** — `/cost` per agent per session
- **MCP + Skills** — External tool servers, skill registry
- **Auto-updater** — `nexus-update check | install`
- **Markdown rendering** — Bold, code blocks, lists
- **Paste detection** — Large pastes collapsed automatically

## Commands

| Command | Description |
|---------|-------------|
| `/help` | Toggle help |
| `/agents` | List agents with models & tools |
| `/providers` | Show configured providers |
| `/models [provider]` | Browse models from API |
| `/model <agent> <model>` | Assign model |
| `/new agent` | 🧙 Wizard: create custom agent |
| `/new provider` | 🧙 Wizard: add provider |
| `/doctor` | System health check |
| `/sessions` | List saved sessions |
| `/resume <id-or-#>` | Resume past session |
| `/config show` | View config |
| `/config agent add/remove` | Manage agents |
| `/config provider add/remove` | Manage providers |
| `/think <query>` | Planner + Critic |
| `/code <request>` | Coder only |
| `/exec <command>` | Shell command (Critic-gated) |
| `/memory search <q>` | Search memory |
| `/cost` | Session API cost |
| `/mcp` | MCP servers & skills |
| `/skills` | List installed skills |
| `/allow all|safe|ask` | Permission level |
| `/gh pr <title>` | Push & create PR |
| `/gh issues` | List issues |
| `/gh clone <url>` | Clone repo |
| `/bg run <cmd>` | Background task |
| `/export [json]` | Export session |
| `/redraw` | Fix display glitches |
| `/clear` | Clear chat |
| `/status` | System status |
| `/exit` | Exit |

## CLI Usage

```bash
nexus                        # New session
nexus --sessions             # List saved sessions
nexus --resume <id>          # Resume by ID
nexus --resume-no 1          # Resume newest
nexus --version              # Show version
nexus-update check           # Check for updates
nexus-update install         # Update to latest
```

## Agent Tools

Agents with `coding`, `command_execution`, or `research` capabilities get:

| Tool | Description |
|------|-------------|
| `shell_exec` | Execute shell commands (Critic-gated) |
| `file_tool` | Read/write/list files |
| `web_search` | Search the web |
| `github_create_pr` | Create pull request |
| `github_create_issue` | Create issue |
| `github_clone` | Clone repository |
| `github_list_issues` | List open issues |
| `background_run` | Run command in background |

## Built-in Agents

| Agent | Role | Default Provider | Tools |
|-------|------|-----------------|-------|
| Orchestrator | Task analysis | defaultProvider | — |
| Planner | Task decomposition | ollama / llama3.2 | — |
| Researcher | Information gathering | gemini / gemini-1.5-pro | web_search |
| Coder | Code generation | anthropic / claude-sonnet-4 | file, shell, github |
| Executor | Command execution | ollama / llama3.2 | shell |
| Critic | Security review | gemini / gemini-1.5-flash | — |
| Summarizer | Memory extraction | ollama / llama3.2 | — |

## Providers

| Provider | ID | Function Calling |
|----------|----|-----------------|
| OpenAI | `openai` | Native |
| Anthropic | `anthropic` | Prompt-based |
| Google Gemini | `gemini` | Native |
| DeepSeek | `deepseek` | Native |
| Ollama | `ollama` | Native |
| Groq | `groq` | Native |
| Fireworks | `fireworks` | Native |
| LM Studio | `lmstudio` | — |
| Z.AI | `zai` | Native |

## Custom Agents

Via wizard (recommended):
```
/new agent
```

Or `~/.nexus/agents.yaml`:
```yaml
agents:
  - id: devops
    name: DevOps Engineer
    role: Infrastructure & deployment
    provider: deepseek
    model: deepseek-chat
    systemPrompt: You handle CI/CD and cloud infrastructure.
    capabilities: [coding, command_execution]
    priority: 5
```

## Configuration

### `~/.nexus/config.yaml`
```yaml
providers:
  - id: deepseek
    apiKey: ${DEEPSEEK_API_KEY}defaultProvider: deepseek
defaultModel: deepseek-chat
criticApproval: true
```

### `~/.nexus/profile.yaml`
```yaml
language: en
responseStyle: detailed
preferredModels:
  deepseek: deepseek-chat
```

### `~/.nexus/agents.yaml`
```yaml
agents:
  - id: my-agent
    name: My Agent
    role: Custom role
    provider: deepseek
    model: deepseek-chat
    systemPrompt: "You are..."
    capabilities: [thinking, coding]
    priority: 5
```

## Skills

Create custom skills in `~/.nexus/skills/<name>/SKILL.md`:

```markdown
---
name: my-skill
description: Does something useful
category: tools
---

## Instructions
Step by step guide...
```

Agents discover skills automatically. Use `/skills` to list.

## Development

```bash
pnpm dev          # Run with hot reload
pnpm build        # Compile TypeScript
pnpm typecheck    # Type check only
pnpm clean        # Remove dist/

# Tests
npx tsx tests/critic-approval.ts   # Mock tests
npx tsx tests/end-to-end.ts        # E2E (needs DeepSeek)
```

### Tech Stack

- **Runtime**: Node.js 18+
- **Language**: TypeScript 5.6 (strict)
- **CLI**: Ink 5 (React for terminal)
- **LLM SDKs**: openai, @anthropic-ai/sdk, @google/generative-ai, ollama
- **Storage**: better-sqlite3 (WAL mode)
- **Embeddings**: Ollama nomic-embed-text / hash fallback
- **Config**: YAML
- **Shell**: execa

## License

MIT
