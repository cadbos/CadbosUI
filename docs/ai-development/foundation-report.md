# Report: Cadbos AI-development foundation (Context + Prompt Engineering)

**Date:** 2026-06-23 · **Stack:** Svelte 5 (runes) + SvelteKit · **For:** the Cadbos team

A brief report on what is set up in the repository for AI-assisted development, what
was added, and what is recommended next. Full architecture:
[architecture.md](architecture.md).

---

## TL;DR

A complete foundation of 6 context layers plus a prompt-engineering layer. It
implements **all 4 official Svelte AI tools** (Instructions, MCP, Skills,
Subagents) and is extended with a domain knowledge base and project-specific
skills. The agent no longer needs to be told how to write Svelte 5 or what the
project is — it gets that automatically.

---

## What is in place

| Layer | Component | Purpose |
|---|---|---|
| Instructions | `CLAUDE.md` + `AGENTS.md` | Agent role, Svelte MCP workflow, knowledge-base rules; portable router for non-Claude tools |
| Knowledge base | `ai-context/` (submodule) | Domain (AEC, LLM chat, RAG, image generation, Nostr), read-only |
| Skills | 10 × Svelte/SvelteKit | runes, components, styling, directives, data-flow, remote-functions, structure, deployment, layerchart, ecosystem |
| Skills | 8 × `cadbos-*` | conventions, structure, request-model, integrations, testing, security, commits, self-review |
| Skills | `prompt-architect` | 27 prompt-engineering frameworks |
| Subagent | `svelte-file-editor` | Isolated writing/validation of `.svelte` |
| MCP | Svelte MCP (`.mcp.json`) | Live docs + `svelte-autofixer` + playground |
| Hook | `svelte-legacy-guard` | Flags Svelte 4 syntax in edited `.svelte` files |
| Memory | agent file memory | Durable facts across sessions |

## What was added

- **`AGENTS.md`** (root) — portable, tool-agnostic instruction router (Cursor /
  Copilot / Goose / opencode / Gemini).
- **8 project skills** `.claude/skills/cadbos-*`: `conventions`, `structure`,
  `request-model`, `integrations`, `testing`, `security`, `commits`, `self-review`.
- **Hook** `svelte-legacy-guard` (`.claude/settings.json` + `.claude/hooks/`) —
  flags Svelte 4 syntax in `.svelte` edits (runes-only).
- **`docs/ai-development/`** — this report, the architecture map, and the ecosystem
  survey.

> Earlier iterations laid the base: remote Svelte MCP, 10 Svelte skills,
> `prompt-architect`, the `svelte-file-editor` subagent, the `ai-context` submodule.

---

## What we found useful in `ai-context` (for context/prompt eng)

We **audited the AI-dev architecture of each repository** (22 projects): we looked
for agent setups (`AGENTS.md`, `CLAUDE.md`, `.cursor`, copilot-instructions,
`.claude` skills/agents/hooks/rules, project skills). About **13 of 22** have one.
Full breakdown + matrix: [ecosystem-survey.md](ecosystem-survey.md).

Top transferable patterns for us:

- **divine-web** (Nostr web app) — the model: an `AGENTS.md` router + **project
  skills** (`coding-conventions`, `project-structure`, `testing-guidelines`,
  `pr-conventions`) + a single source for Cursor/Copilot/Goose/Claude.
- **welshman** (Svelte/TS Nostr SDK) — **skills-per-module + a router skill**; plus
  a ready dependency (store, signer with all NIP logins, rich-text editor).
- **tenex** — **hooks as governance**: `.claude/hooks/pre-commit-review.md`
  (layered architecture, no cycles, file-size limit); lessons via `+INDEX.md`
  instead of RAG.
- **iris-client** (Svelte) — a crisp **testing policy** (Playwright e2e for UI,
  Vitest only for pure logic) — a direct template for us.
- **divine-mobile** — a **self-review checklist** as a single entry point.
- **zapcooking** (SvelteKit) — a domain MCP via `.cursor/mcp.json` — analogous to
  our Svelte MCP.

Conclusion: for **development** we don't need a separate RAG — progressive
disclosure via skills + MCP covers it (tenex's design confirms this). RAG / agent
orchestration (AnythingLLM, Dify, LangFlow) are candidates at the product level.

---

## How to use it (cheat sheet)

- **Just describe the task** — relevant skills and the subagent load automatically
  from the description. No need to name them.
- **Want a guarantee** — invoke a skill explicitly: `/svelte-runes`,
  `/prompt-architect`, etc.
- **Any Svelte code** must pass `svelte-autofixer` with zero findings.
- **`ai-context/` is read-only** — a knowledge base in its own repo; do not edit it.

---

## Recommendations / next steps

1. **Vet the third-party scripts** in `prompt-architect` (`scripts/*.py`) before
   relying on them — installed from an external repo.
2. **Set up a remote** and push the foundation so the whole team gets it via
   `git clone --recursive` (needs access to the `cadbos/ai-context` submodule).
3. **As the team grows** — consider a dedicated `context-engineering` skill (context
   hygiene rules: skill vs subagent vs MCP).
