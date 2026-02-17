# 🤖 AI Browser Agent

An autonomous AI agent that controls a visible web browser to complete complex multi-step tasks — from deleting spam emails to ordering food to applying for jobs.

## Features

- **Autonomous browser control** via Playwright (visible, non-headless)
- **Persistent sessions** — log in once, the agent reuses your sessions
- **ARIA-based page understanding** — compact, token-efficient page extraction
- **Security layer** — asks for confirmation before destructive actions (payments, deletions)
- **Multi-provider LLM support** — Z.ai GLM-4.5-Flash (default), OpenAI, Claude
- **Error recovery** — agent adapts when actions fail
- **No hardcoded flows** — the agent discovers selectors, URLs, and steps dynamically

## Quick Start

### Prerequisites

- Node.js 18+
- A Z.ai API key (or OpenAI/Anthropic key)

### Installation

```bash
# Install dependencies
npm install

# Install Playwright browser
npx playwright install chromium

# Configure your API key
cp .env.example .env
# Edit .env and add your GLM_API_KEY
```

### Usage

```bash
npm start
```

A browser window will open. Log into any websites you need (e.g., email, food delivery). Then type a task in the terminal:

```
💬 Enter your task (or "quit" to exit):
> Прочитай последние 10 писем в яндекс почте и удали спам
```

Watch the agent work in the browser! The agent will:
1. 🔍 **Observe** the current page (accessibility tree)
2. 🧠 **Think** about the next action
3. 🎯 **Act** by clicking, typing, navigating
4. ⚠️ **Ask** for confirmation on destructive actions
5. ✅ **Report** results when done

### Example Tasks

- `"Прочитай последние 10 писем в яндекс почте и удали спам"`
- `"Закажи мне BBQ-бургер и картошку фри на сайте доставки еды"`
- `"Найди 3 подходящие вакансии AI-инженера на hh.ru и откликнись на них"`

## Architecture

```
src/
├── index.ts              # CLI entry point
├── agent/
│   ├── agent.ts          # Main observe→think→act loop
│   ├── context.ts        # Token budget & context compression
│   └── prompts.ts        # System prompt engineering
├── llm/
│   ├── provider.ts       # LLM factory
│   ├── glm.ts            # Z.ai GLM provider
│   ├── openai.ts         # OpenAI provider
│   └── types.ts          # Shared types
├── browser/
│   ├── manager.ts        # Playwright lifecycle
│   ├── extractor.ts      # ARIA snapshot page extraction
│   └── actions.ts        # Browser action wrappers
├── tools/
│   ├── definitions.ts    # Tool schemas for function calling
│   └── executor.ts       # Tool dispatch & execution
├── security/
│   └── guard.ts          # Destructive action detection
└── utils/
    ├── config.ts         # Environment config
    └── logger.ts         # Colored terminal output
```

## Configuration

| Variable | Default | Description |
|---|---|---|
| `LLM_PROVIDER` | `glm` | LLM provider: `glm`, `openai`, `claude` |
| `GLM_API_KEY` | — | Z.ai API key |
| `OPENAI_API_KEY` | — | OpenAI API key |
| `ANTHROPIC_API_KEY` | — | Anthropic API key |
| `MAX_ITERATIONS` | `50` | Safety limit for agent loop |

## License

MIT
