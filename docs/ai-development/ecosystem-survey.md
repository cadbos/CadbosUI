# Survey: AI-dev architecture across the `ai-context` projects

A pass over the repositories referenced by the `ai-context` submodule, to answer:
**which projects have an AI-development architecture, and what of it is useful to
us.** We checked for agent-setup markers: `AGENTS.md`, `CLAUDE.md`, `.cursor/`,
`.cursorrules`, `.github/copilot-instructions.md`, `.mcp.json`, `.claude/`
(skills/agents/hooks/rules), `.goosehints`, `.roo`, project skills (`SKILL.md`).

> Survey date: 2026-06-23. Method: file-tree audit via the GitHub API + reading the
> key files. Complements [foundation-report.md](foundation-report.md) and
> [architecture.md](architecture.md).

---

## 1. Matrix (does it have AI-dev architecture)

| Project | Stack | AI-dev artifacts | Usefulness to us |
|---|---|---|---|
| **divinevideo/divine-web** | React/Vite/Nostr web | AGENTS.md (router) + CLAUDE.md + `.cursorrules` + copilot-instructions + `.goosehints` + `.agents/skills` (6) + `.claude/skills` | 🟢 High — model for multi-tool + project skills |
| **coracle-social/welshman** | **Svelte/TS** SDK | `skills/` per package (11) + router skill | 🟢 High — skills-per-module pattern + ready Nostr SDK |
| **tenex-chat/tenex** | Rust agent platform | AGENTS.md (+per-crate) + CLAUDE.md + `.claude/hooks/pre-commit-review.md` + built-in agent skills (5) | 🟢 High — hooks-as-governance, file-size/layer rules |
| **divinevideo/divine-mobile** | Flutter | `.claude/CLAUDE.md` + `.claude/agents` (2) + `.claude/hooks` (6) + `.claude/rules` (12) | 🟡 Medium — "self-review checklist" pattern + hooks |
| **irislib/iris-client** | **Svelte/TS** Nostr | AGENTS.md (testing policy) + CLAUDE.md | 🟢 High — crisp testing policy for a Svelte client |
| **zapcooking/frontend** | **SvelteKit** Nostr | `.cursor/mcp.json` (Nostr MCP) | 🟢 High — closest product analog |
| **contextvm/relatr** | TS/Rust MCP | AGENTS.md + `skills/` + `.roo/skills` | 🟡 Medium — skills for plugin authors |
| **irislib/meet** | Svelte | AGENTS.md + CLAUDE.md | 🟡 Medium |
| **divinevideo/divine-clips** | Rust/web | AGENTS.md | 🟡 Low |
| **chidiwilliams/buzz** | Python/Qt | CLAUDE.md + plugins AGENTS.md/CLAUDE.md | ⚪ Low (not our stack) |
| **mmalmi/nostr-double-ratchet** | TS/Rust | AGENTS.md | ⚪ Low |
| **vivganes/kanbanstr** | Svelte | copilot-instructions.md | 🟡 Medium |
| cypherflow_ai, cyphertap, agent-ui, oracolo, linktr-nostr, coracle, flotilla-budabit, budabit-kanban-extension, iris-chat, nstart | various | — no AI-dev artifacts in the tree | — |

---

## 2. Useful patterns (what we adopt)

### P-1. AGENTS.md as a thin "router" (divine-web, tenex, divine-mobile)
AGENTS.md is short and does not duplicate content — it **points** to sources of
truth: `ARCHITECTURE.md`, `CONTRIBUTING.md`, `MODULE_INVENTORY.md`,
`.agents/SKILLS.md`, quick commands, security. One file for all tools
(Cursor/Copilot/Goose/Claude); tool-specific files are thin or absent.
→ **For us:** added an `AGENTS.md` router; our richer `CLAUDE.md` stays
Claude-specific. Closes cross-tool portability.

### P-2. Project skills, not only framework skills (divine-web, welshman)
divine-web keeps `.agents/skills/`: `coding-conventions`, `project-structure`,
`testing-guidelines`, `pr-conventions`, etc., with `description: "Load when …"`.
→ **For us:** we had framework skills (Svelte) + `prompt-architect` but **no project
skills**. Added `cadbos-{conventions,structure,request-model,integrations,testing,
self-review}`.

### P-3. Skills-per-module + a router skill (welshman)
For a modular codebase: one skill per package (`welshman-net`, `welshman-store`,
`welshman-signer`…) plus one overview `welshman` skill that routes to the right
sub-skill. A cheap always-on router → deep modules on demand.
→ **For us:** a model for the future once the app is split into modules.

### P-4. Hooks as governance (tenex, divine-mobile)
- tenex `.claude/hooks/pre-commit-review.md` — **architecture review before commit**:
  layered dependency check (deps flow downward only; no reverse imports), no cycles,
  file-size limit.
- divine-mobile `.claude/hooks/*.sh` — pre-edit guards, post-edit format/analyze,
  pre-commit build runner.
→ **For us:** added the `svelte-legacy-guard` hook (flags Svelte 4 syntax). Further
guards (secrets, server-proxy reminders) are candidates.

### P-5. Hard architectural conventions in instructions (tenex)
`CLAUDE.md`: file-size limit ("<300 LOC, hard 500"), `MODULE_INVENTORY.md` as a
canonical map (consult before writing code), a layered architecture with an explicit
dependency-direction diagram.
→ **For us:** the single-store / derived-prompt rule is captured as an enforced
convention in `cadbos-request-model` / `cadbos-conventions`.

### P-6. A clear testing policy (iris-client)
AGENTS.md in one paragraph: "Playwright e2e for user-visible behavior; Vitest only
for pure logic; when replacing a shallow UI Vitest test with e2e, delete it."
→ **For us:** captured directly in `cadbos-testing`.

### P-7. A self-review checklist as a single entry point (divine-mobile)
`rules/self_review_checklist.md` — a consolidated pre-plan / pre-commit / pre-PR
checklist; each item links to a detailed rule file. Progressive disclosure for
conventions: one checklist → details on demand.
→ **For us:** captured in `cadbos-self-review`.

### P-8. A domain MCP (zapcooking, tenex)
zapcooking wires `@nostrbook/mcp` (Nostr docs) via `.cursor/mcp.json` — analogous to
our Svelte MCP. tenex has built-in `nostr`/`mcp` skills.
→ **For us:** if the product touches Nostr, `@nostrbook/mcp` is a ready domain MCP.
Not needed now; noted.

### P-9. Lessons/memory instead of RAG (tenex)
tenex: the `learn` tool does not write to RAG; an LLM folds the lesson into
`+INDEX.md` in the agent's home; `+`-prefixed files are auto-injected into the system
prompt.
→ **For us:** validates our choice of file-based memory over RAG for **development**.

---

## 3. Direct reuse opportunities

- **`@welshman/*`** — a production-tested Svelte/TS Nostr toolkit (store, signer with
  all NIP logins, rich-text editor). A ready dependency **and** a skills-layout model
  if/when Cadbos moves toward Nostr.
- **`@nostrbook/mcp`** — a Nostr domain MCP (like our Svelte MCP).
- **divine-web skills** (`coding-conventions`, `project-structure`,
  `testing-guidelines`, `pr-conventions`) — used as a **skeleton** for our project
  skills (adapted React → Svelte 5).

---

## 4. Recommendations (priority)

1. **AGENTS.md router** (P-1) — done.
2. **Project skills `cadbos-*`** (P-2/P-3) — done.
3. **Claude hooks** (P-4) — `svelte-legacy-guard` done; secrets/proxy guards are
   candidates.
4. **Self-review checklist + testing policy** (P-6/P-7) — done as skills.
5. **Capture architectural invariants** (P-5) — done in the project skills.

### Implementation status (2026-06-23)

✅ Implemented in this iteration:
- **AGENTS.md router** (P-1) — `AGENTS.md` at root.
- **Project skills** (P-2) — `.claude/skills/cadbos-{conventions,structure,
  request-model,integrations,testing,self-review}`.
- **Claude hook** (P-4) — `svelte-legacy-guard` in `.claude/settings.json`
  (+ `.claude/hooks/svelte-legacy-guard.py`): flags Svelte 4 syntax.
- **Testing policy** (P-6) and **self-review checklist** (P-7) — as skills.
- **Architectural invariants** (P-5) — captured in `cadbos-request-model` /
  `cadbos-conventions`.

⏳ On request (backlog): a Nostr domain MCP (P-8) and reuse of `@welshman/*` — only if
the product moves toward Nostr; a skills-per-module router (P-3) — once the code is
modularized.
