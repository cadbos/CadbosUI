# AGENTS.md — Cadbos

Portable agent instructions for the Cadbos repository (Svelte 5 + SvelteKit).
Tool-agnostic entry point for Cursor, Copilot, Goose, opencode, Gemini, etc.
Claude Code users: see [CLAUDE.md](CLAUDE.md) (richer, Claude-specific).

## What this is

Cadbos Interior Design AI: upload a room photo, build a free-text prompt in three
interchangeable UIs (chat / key-value / graph), generate interior visuals via the
MyArchitectAI `render/interior` endpoint (through a server-side proxy). Full spec:
[docs/tz-cadbos-interior-ai.md](docs/tz-cadbos-interior-ai.md).

## Read first

- [docs/tz-cadbos-interior-ai.md](docs/tz-cadbos-interior-ai.md) — product SRS
  (scope, requirements, data model, integrations, acceptance criteria).
- [docs/ai-development/architecture.md](docs/ai-development/architecture.md) —
  the Context + Prompt Engineering foundation (how context is organized).
- `ai-context/` — read-only domain knowledge base (git submodule). Do not modify.

## On-demand skills (`.claude/skills/`)

Project knowledge, loaded by task:

- `cadbos-conventions` — coding style, runes-only reactivity, i18n, security rules.
- `cadbos-structure` — SvelteKit layout, server-only modules, where things live.
- `cadbos-request-model` — the single-source-of-truth store behind the 3 UIs.
- `cadbos-integrations` — MyArchitectAI proxy, UploadThing, billing/limits.
- `cadbos-testing` — testing policy (Playwright e2e + Vitest + svelte-autofixer).
- `cadbos-self-review` — pre-commit / pre-PR checklist.

Plus Svelte 5 / SvelteKit framework skills and `prompt-architect`.

## Tools

- **Svelte MCP** (`.mcp.json`) — live docs (`list-sections`, `get-documentation`),
  `svelte-autofixer`, `playground-link`. Use it whenever writing Svelte.
- **Subagent** `svelte-file-editor` — for writing/validating `.svelte` files.

## Core rules

- Svelte 5 **runes only** (`$state`, `$derived`, `$effect`); no Svelte 4 syntax
  (`on:click`, `export let`, `<slot>`). Shared state in `.svelte.ts` modules.
- Every Svelte component MUST pass `svelte-autofixer` with zero issues.
- Provider secrets (`x-api-key`, `UPLOADTHING_TOKEN`) are **server-only** — never
  in the client bundle. External APIs go through SvelteKit server endpoints.
- All UI text via i18n (RU primary, EN-ready). No hardcoded strings.
- OpenRouter / LLM chat / prompt builder are **post-MVP** — do not implement unless asked.

## Commands

- `npm run dev` — start dev server.
- `npm run build` — production build.
- `npm run test` — type-check, lint, unit tests.
