# Nexus

<div align="center">

**Multi-LLM Orchestrated CLI — Multi-model, role-based AI system with persistent memory**

</div>

Nexus is a terminal-based multi-agent AI system that coordinates multiple LLM-powered agents in a panel discussion format. An orchestrator analyzes your request, selects the right specialist agents, lets them debate and contribute, then synthesizes a final response. Think of it as a panel of AI experts working together on your problem.

## Features

- **Multi-Agent Panel** — 6 built-in specialist agents (Planner, Coder, Executor, Researcher, Critic, Summarizer) coordinated by an Orchestrator
- **9 LLM Providers** — OpenAI, Anthropic Claude, Google Gemini, DeepSeek, Ollama, Groq, Fireworks, LM Studio, Z.AI — all through a unified interface
- **Streaming UI** — Token-by-token real-time output from agents with live cursor indicator
- **Agent Tool Access** — Agents can call shell commands, read/write files, and search the web via native function calling
- **Critic Safety Gate** — Shell commands are reviewed by the Critic agent before execution (APPROVED / REJECTED with DANGER/WARNING/INFO severity)
- **Persistent Memory** — SQLite-backed vector memory with Ollama nomic-embed-text (768-dim) or hash-based fallback (384-dim)
- **Session Resume** — All chats persist to SQLite. Resume past sessions with `nexus --resume <id>` or `/resume 1`
- **User Profiles** — Per-user preferences, project contexts, shortcuts, and response styles
- **Doctor** — Built-in health check: `/doctor` or `nexus --doctor` diagnoses providers, agents, embedding, memory
- **In-App Config** — `/config show|model|agent` to view and change settings without leaving the CLI
- **Session Export** — Export conversations as JSON or Markdown
- **Custom Agents** — Define your own agents in `~/.nexus/agents.yaml`
- **Terminal UI** — Built with Ink (React for the terminal) with color-coded agent output

## Installation

```bash
git clone <repo-url>
cd nexus
pnpm install    # or npm install
pnpm build
```

## Quick Start

### 1. Configure Providers

Create `~/.nexus/config.yaml`:

```yaml
providers:
  - id: deepseek
    apiKey: ${DEEP...Y}
  - id: openai
    apiKey: ${OPEN...Y}
  - id: anthropic
    apiKey: ${ANTH...Y}
  - id: ollama                  # local, no key needed
defaultProvider: deepseek
defaultModel: deepseek-chat
criticApproval: true
```

Environment variables (`${VAR}` syntax) are resolved from your shell environment.

### 2. Launch

```bash
pnpm dev
# or: npm run dev
# or after build: npm start
```

### 3. Chat

Just type your question and press Enter. Nexus will:
1. Query memory for relevant context
2. Have the Orchestrator analyze your task
3. Route to the right specialist agents
4. Stream agent responses token-by-token in real-time
5. Synthesize a final response
6. Persist the entire conversation for later resume

## CLI Usage

```bash
nexus                        # Start a new session
nexus --sessions             # List all saved sessions
nexus --resume <session-id>  # Resume by full or partial ID
nexus --resume-no 1          # Resume the most recent session
nexus --version              # Show version
```

## Commands

| Command | Description |
|---------|-------------|
| `/help` | Toggle help overlay |
| `/agents` | List active agents and their models/tools |
| `/providers` | Show configured providers |
| `/model <agent> <model>` | Change an agent's model (e.g. `/model coder deepseek-chat`) |
| `/config show` | Show current configuration |
| `/config model <agent> <model>` | Change agent model |
| `/config agent <id>` | Show agent details (tools, capabilities, provider) |
| `/doctor` | Run system health check (providers, agents, embedding, memory, tools) |
| `/sessions` | List saved sessions with previews |
| `/resume <id-or-number>` | Resume a past session |
| `/profile` | Show user profile |
| `/think <query>` | Use Planner + Critic only |
| `/code <request>` | Use Coder agent only |
| `/exec <command>` | Run shell command (with Critic safety review) |
| `/memory search <query>` | Search session memory |
| `/memory list [type]` | List memory entries by type |
| `/memory clear` | Clear all memory |
| `/export [json]` | Export session (default: markdown, add `json` for JSON) |
| `/status` | Show system status |
| `/clear` | Clear chat |
| `/exit` | Exit Nexus |

## Architecture

```
User Input
    │
    ▼
┌─────────────────┐
│  Orchestrator    │  ← analyzes task, selects agents
└────────┬────────┘
         │
         ├──► Memory Query (SQLite + Ollama embeddings)
         │
         ├──► Planner     (task decomposition)
         ├──► Researcher  (information gathering)  ← has web_search tool
         ├──► Coder       (code generation)        ← has file_tool + shell_exec
         ├──► Executor    (shell commands)         ← has shell_exec via Critic gate
         ├──► Critic      (safety reviews, interjections)
         └──► Summarizer  (memory extraction)
         │
         ▼
┌─────────────────┐
│  Streaming UI    │  ← token-by-token output in terminal
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  SQLite Persist  │  ← all messages saved for resume
└─────────────────┘
```

### Tool System

Agents with `coding`, `command_execution`, or `research` capabilities get access to tools:

| Tool | Description | Parameters |
|------|-------------|------------|
| `shell_exec` | Execute shell commands (Critic-gated) | `command` |
| `file_tool` | Read/write/list files | `action`, `path`, `content` |
| `web_search` | Search the web via DuckDuckGo | `query` |

Tools are called via native function calling (OpenAI/DeepSeek), prompt-based JSON (Anthropic), or Ollama native tools.

### Built-in Agents

| Agent | Role | Default Provider | Tools | Priority |
|-------|------|-----------------|-------|----------|
| Orchestrator | Task analysis & coordination | defaultProvider | — | 0 |
| Planner | Task decomposition | ollama / llama3.2 | — | 1 |
| Researcher | Information gathering | gemini / gemini-1.5-pro | web_search | 2 |
| Coder | Code generation | anthropic / claude-sonnet-4 | file_tool, shell_exec | 3 |
| Executor | Command execution | ollama / llama3.2 | shell_exec | 4 |
| Critic | Security review & gating | gemini / gemini-1.5-flash | — | 6 |
| Summarizer | Memory extraction | ollama / llama3.2 | — | 7 |

### Provider Support

| Provider | ID | Key Required | Function Calling | Notes |
|----------|----|-------------|-----------------|-------|
| OpenAI | `openai` | Yes | Native | GPT-4o, o1, etc. |
| Anthropic | `anthropic` | Yes | Prompt-based | Claude Sonnet, Opus, Haiku |
| Google Gemini | `gemini` | Yes | Native | Gemini 1.5/2.0 series |
| DeepSeek | `deepseek` | Yes | Native | deepseek-chat, deepseek-reasoner |
| Ollama | `ollama` | No | Native | Local models via Ollama |
| Groq | `groq` | Yes | Native | Fast LPU inference |
| Fireworks AI | `fireworks` | Yes | Native | Serverless OSS models |
| LM Studio | `lmstudio` | No | — | Local inference |
| Z.AI | `zai` | Yes | Native | GLM series |

All providers implement a single `LLMProvider` interface with `chat()`, `chatWithTools()`, `stream()`, and `listModels()`.

### Embedding Service

- **Primary**: Ollama `nomic-embed-text` (768-dimensional semantic vectors)
- **Fallback**: Hash-based bag-of-words (384-dimensional, no API required)
- **Auto-detection**: Checks Ollama availability at startup, caches result
- **Batch support**: Batch embedding for bulk operations

### Session Persistence

Every conversation is stored in SQLite (`~/.nexus/memory.db`):

- **`sessions` table**: id, summary, timestamps, message count
- **`session_messages` table**: every message with agent_id, role, content, timestamp
- **Resume flow**: load all messages → restore panel history → continue chatting
- **Numbered listing**: newest session = #1, resume by number or ID

### Critic Safety System

Every shell command executed via `/exec` or agent tool calls passes through the Critic agent:

```
Command → Critic reviews → APPROVED → executes
                          → REJECTED:INFO     (minor concern)
                          → REJECTED:WARNING  (moderate risk)
                          → REJECTED:DANGER   (blocked, do not run)
```

Disable with `criticApproval: false` in config.

### Doctor Report

`/doctor` or programmatic `orchestrator.runDoctor()` returns:

```
Overall: 🟢 HEALTHY / 🟡 DEGRADED / 🔴 UNHEALTHY
├── Providers: connection status + model count per provider
├── Agents: provider wired, tool count per agent
├── Embedding: Ollama available or hash fallback
├── Memory: operational status
├── Tools: registration status
└── Sessions: active session ID + total persisted
```

## Custom Agents

Define custom agents in `~/.nexus/agents.yaml`:

```yaml
agents:
  - id: devops
    name: DevOps Engineer
    role: Infrastructure and deployment specialist
    provider: deepseek
    model: deepseek-chat
    systemPrompt: |
      You are a DevOps engineer. You handle CI/CD, Docker, Kubernetes,
      and cloud infrastructure. Be practical and security-conscious.
    capabilities:
      - coding
      - command_execution
    priority: 5
```

Custom agents with `command_execution` or `coding` capabilities automatically get tool access.

## Configuration Reference

### `~/.nexus/config.yaml`

```yaml
providers:           # List of LLM providers
  - id: deepseek
    apiKey: ${DEEP...Y}
    baseUrl: https://api.deepseek.com  # optional override
defaultProvider: deepseek
defaultModel: deepseek-chat
memoryPath: ~/.nexus/memory.db
criticApproval: true
```

### `~/.nexus/profile.yaml`

```yaml
language: en
preferredProviders: [deepseek]
preferredModels:
  deepseek: deepseek-chat
responseStyle: detailed    # short | detailed | technical
projectContexts:
  - path: /home/user/my-project
    description: My web app
    techStack: [typescript, react, node]
    lastAccessed: 1719000000000
shortcuts: {}
```

## Development

```bash
pnpm dev          # run with tsx (hot reload on save with --watch)
pnpm build        # compile TypeScript
pnpm typecheck    # type-check only (no emit)
pnpm clean        # remove dist/
```

### Running Tests

```bash
# Mock tests (no API keys needed)
npx tsx tests/critic-approval.ts

# End-to-end tests (requires configured DeepSeek provider)
npx tsx tests/end-to-end.ts
```

### Tech Stack

- **Runtime**: Node.js 18+
- **Language**: TypeScript 5.6 (strict mode)
- **CLI Framework**: Ink 5 (React for terminals)
- **LLM SDKs**: openai, @anthropic-ai/sdk, @google/generative-ai, ollama
- **Storage**: better-sqlite3 (WAL mode)
- **Embeddings**: Ollama nomic-embed-text (primary), hash-based (fallback)
- **Config**: YAML (via `yaml` package)
- **Shell**: execa

## License

MIT
