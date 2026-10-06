# Multi-LLM tooling and repository layout — research

Status: research and proposal. Nothing described in §6–§7 is applied yet; each
step is meant to be tried separately (see §8 for the spikes that decide open
questions).

Scope: AI-assisted development of Cadbos (the `Dev` side), AI in the delivery
pipeline (the `DevOps` side), and how the repository is organised around both.
This is **not** about runtime LLM calls of the product — those stay behind the
server-side proxy (see [cadbos-integrations](../../.claude/skills/cadbos-integrations/SKILL.md)).

All external facts below were checked against the vendors' current documentation
(links in §9). Anything not confirmed is marked **unverified**.

---

## 1. Summary

1. **Cursor is not an LLM proxy.** Cursor documents no raw chat-completions or
   Router endpoint. The TypeScript/Python SDK, the headless CLI and the Cloud
   Agents API all run the *Cursor agent loop* (tools, rules, skills, edits); "local"
   means a local loop with hosted inference. It cannot replace direct Anthropic /
   OpenAI / Google calls for anything that is not "an agent working on a repo".
   Consequence: the product's own LLM traffic never goes through Cursor; Cursor is
   a *development and review* tool.
2. **The real Cursor value is multi-vendor access plus compatibility.** One
   subscription exposes Claude, GPT, Gemini, Grok/Composer and others, and Cursor
   already reads the Claude and Codex layouts (skills, subagents, Claude hooks,
   `AGENTS.md`). We get four tools for the price of maintaining one set of files,
   *if* the layout is chosen with that in mind.
3. **Many files must stay where tools expect them** (`.github/`,
   `.vscode/`, `.claude/`, `AGENTS.md`, …). The requested hierarchy cannot be
   achieved by moving these. It is achieved by (a) making every tool directory a
   thin adapter over one tool-neutral source and (b) moving the things that *can*
   move (`e2e/`, `static/`, `migrations/`, `config/`) behind existing config knobs.
4. **Do not nest skills for the sake of categories.** Cursor supports nested skill
   folders; Claude Code, Codex and Gemini CLI documentation does not promise it.
   Classify with frontmatter `metadata` and a catalog document instead (§6.3).
5. **Per-role model routing is the practical multi-LLM feature.** Cursor subagents
   can pin a model per role; `.cursor/agents/` overrides `.claude/agents/` by name.
   That gives different models for explore / implement / review without forking
   the shared prompts (§5).

---

## 2. What Cursor offers beyond "a chat with models"

Verified in Cursor docs (§9). Items marked ★ are the non-obvious ones.

| Capability | What it is | Use for Cadbos |
| --- | --- | --- |
| ★ Reads other tools' config | Skills from `.claude/skills`, `.codex/skills`, `.agents/skills`; subagents from `.claude/agents`, `.codex/agents`; Claude hooks from `.claude/settings.json` (names and tool names are mapped; `$CLAUDE_PROJECT_DIR` is aliased); `AGENTS.md` in root and subdirectories | Our current `.claude/*` already works in Cursor with no changes |
| ★ Per-subagent model | `model: inherit` or a specific model id in subagent frontmatter | Cheap model for search/tests, strong model for review (§5) |
| ★ Cursor Router | `auto-smart` model with `optimize_for` = cost / balanced / intelligence; Teams and Enterprise only | Optional cost control for CI agents; not a raw API |
| ★ Skills `paths` + `disable-model-invocation` | Scope a skill to globs; make it explicit-only (`/name`) | Keeps `svelte-*` skills out of context when editing server `.ts` |
| Headless CLI | `agent -p "…" --model <id> --output-format text`; modes agent / plan / ask; `& task` hands off to a Cloud Agent | CI review/fix jobs, scripted checks |
| TypeScript SDK `@cursor/sdk` | `Agent.create({ local \| cloud })`, `Cursor.models.list()` for the account's real model ids and parameters | Tooling scripts; discover model ids instead of hard-coding them |
| Cloud Agents API / SDK cloud runtime | Isolated VM with the repo, parallel agents, auto-PR | Long tasks, parallel attempts |
| Hooks | `.cursor/hooks.json`; also run in Cloud Agents (command hooks only, project-level only) | Policy gates, formatters |
| Project permissions | `<project>/.cursor/cli.json` — **permissions only**; all other CLI settings are user-global | Allow/deny shell commands for headless runs |
| MCP | `.cursor/mcp.json` with `${env:NAME}`, `${workspaceFolder}`; stdio, SSE, Streamable HTTP; OAuth; tool allowlists on Enterprise | Svelte MCP; secrets via env interpolation, never inline |
| BYOK | Anthropic, OpenAI, Google, Azure, Bedrock keys in settings | Chat models only (not Tab); every request still routes through Cursor servers; Zero Data Retention does **not** apply; Teams/Enterprise still pay the $0.25/M Cursor Token Rate |
| Bugbot, Automations, built-in `/review`, `/review-security`, `/split-to-prs` | Cursor-side review and automation | Overlaps with CodeRabbit — pick one primary reviewer (§7) |

Plan facts that affect the choice (Cursor pricing page, per 1M tokens, input /
output): Composer 2.5 $0.5 / $2.5; Gemini 3.8 Flash $0.75 / $3.5; Claude Sonnet 5.5
$2 / $10; GPT-5.6 Terra $2 / $12; Claude Opus 5.5 $4 / $20; GPT-5.6 Sol $4 / $20.
First-party Cursor models (Composer, Grok) draw from a separate, larger pool.

Hard limits to design around:

- No documented raw inference endpoint (SDK docs say so explicitly).
- Local SDK agents auto-approve tool calls in headless mode — gate with hooks or
  `sandboxOptions`, never run unattended without one.
- Cloud Agents do not see `~/.cursor/*` or `~/.agents/*`; only project files and
  team-distributed configuration.
- Skills synced from `~/.cursor/skills/` are per-user; team sharing goes through a
  repo or a team marketplace.

---

## 3. Compatibility matrix

What each tool reads **from the repository**. "—" means not documented/not read.

| Concern | Claude Code | Cursor | Codex (CLI/IDE) | Gemini CLI |
| --- | --- | --- | --- | --- |
| Instructions | `CLAUDE.md`, `.claude/CLAUDE.md`; reads `AGENTS.md` only if no `CLAUDE.md` exists above cwd (so import it: `@AGENTS.md`) | `AGENTS.md` (root + nested), `.cursor/rules/*.mdc` | `AGENTS.md` (+ `AGENTS.override.md`), 32 KiB combined cap (`project_doc_max_bytes`) | `GEMINI.md` by default; `context.fileName` in settings can add `AGENTS.md` |
| Scoped rules | `.claude/rules/*.md` with `paths` | `.cursor/rules/*.mdc` (`globs`), skills `paths` | nested `AGENTS.md` | JIT-loaded nested `GEMINI.md` |
| Skills | `.claude/skills/` | `.agents/skills/`, `.cursor/skills/`, **and** `.claude/skills/`, `.codex/skills/` | `.agents/skills/` (cwd → repo root), user `~/.agents/skills` | `.gemini/skills/` or `.agents/skills/` (alias wins within a tier) |
| Subagents | `.claude/agents/` | `.cursor/agents/`, `.claude/agents/`, `.codex/agents/` (`.cursor` wins on name clash) | `.codex/agents/` (format **unverified**) | — (**unverified**) |
| Hooks | `.claude/settings.json` | `.cursor/hooks.json` + imports Claude hooks | — (**unverified** for project scope) | — (**unverified**) |
| MCP (project) | `.mcp.json` | `.cursor/mcp.json` (whether `.mcp.json` is read: **unverified**) | `.codex/config.toml` (trusted projects only) | `.gemini/settings.json` (`mcpServers`; **unverified** here) |
| Project permissions | `.claude/settings.json` | `.cursor/cli.json` | `.codex/config.toml` | `.gemini/settings.json` |
| Local-only overrides | `CLAUDE.local.md`, `.claude/settings.local.json` | — | `AGENTS.override.md` | — |

Findings that follow from the matrix:

- **`AGENTS.md` is the only instructions file all four can use.** Our
  `CLAUDE.md` → `@AGENTS.md` import is the documented correct pattern for Claude.
  Gemini needs one settings line (`context.fileName`), not a second file.
- **`.agents/skills/` is the only skills path read by Cursor, Codex and Gemini.**
  Claude Code documents `.claude/skills/` (plus user, plugin and enterprise
  locations) and does not document `.agents/skills/`, hence the symlink in §6.2.
- **Subagent and hook formats are the least portable.** `.claude/agents/` is read by
  Claude and Cursor; do not invest in Codex/Gemini subagents until those tools are
  actually adopted.
- **`CLAUDE.local.md` has a side effect:** if present it stops Claude from reading
  `AGENTS.md` directly (we are unaffected because `CLAUDE.md` already imports it).
- Hooks pitfall: Cursor runs hooks from **every** source. Our
  `svelte-legacy-guard` in `.claude/settings.json` already runs in Cursor. Adding the
  same guard to `.cursor/hooks.json` would run it twice — keep one definition.

---

## 4. Current layout: problems

Repository root today (tracked files only):

```
.claude/  .github/  .vscode/  .coderabbit.yaml  .mcp.json  .npmrc  .prettier*
AGENTS.md  CLAUDE.md  skills-lock.json          # agent config
config/  e2e/  migrations/  static/  example.png # code-adjacent folders at root
docs/{ai-development,license-headers}
src/  components.json  eslint.config.js  openapi-ts.config.ts
playwright.config.ts  vite.config.ts  wrangler.jsonc  tsconfig.json  package.json
```

1. Agent config, IDE config, CI config, tests, assets and DB migrations all sit at
   one level — no way to see "what is AI, what is delivery, what is product".
2. `.claude/` mixes three different concerns: Dev knowledge (project and Svelte
   skills), Dev workers (subagents), and the Dev guard hook — plus 27 prompt
   framework templates that are general-purpose, not Cadbos-specific.
3. DevOps AI concerns (CodeRabbit config, commit/PR skills, CI review) have no home
   of their own; `cadbos-commits` and `cadbos-pull-requests` live next to code-style
   skills.
4. `e2e/` is a top-level test tree separate from where unit tests live (co-located
   `*.test.ts` in `src/` and `config/`).
5. `example.png` (341 KB) at the root is referenced by nothing in the repository
   (checked with a repository-wide search) — candidate for deletion or relocation.
6. Skill content is duplicated in intent but not in files; the real risk is drift
   between `AGENTS.md`, `docs/ai-development/architecture.md` (its file map) and
   what is on disk.

---

## 5. Multi-LLM operating model

Principle: **write once in neutral files, route models by role, never fork
prompts per vendor.**

### 5.1 Role → model routing (proposal; validate in spikes)

Model ids differ per tool and change often. Do not hard-code them in shared
files; discover them (`Cursor.models.list()`, `/model` in each CLI).

| Role (subagent) | Needs | Default | Cursor override candidates |
| --- | --- | --- | --- |
| `explore` / search | speed, cost | `inherit` | a Composer or Flash-class model |
| `svelte-file-editor` | strict rules + MCP loop | `inherit` | a mid-tier Sonnet/GPT-class model |
| `test-runner` | many cheap iterations | `inherit` | Composer / Flash-class |
| `code-reviewer` (read-only) | independent judgement | `inherit` | a model from a **different vendor** than the author; the idea is to reduce correlated blind spots — treat as a hypothesis and measure on real diffs |
| `a11y-validator` | structured audit | `inherit` | mid-tier |

Mechanism (verified): a subagent in `.cursor/agents/<name>.md` overrides a
same-named one in `.claude/agents/`. So `.claude/agents/` stays the shared source,
and a `.cursor/agents/` file exists **only** where a Cursor-specific `model:` is
wanted. The shared files keep no `model:` field (= inherit), which is already the
case today.

### 5.2 Where each tool earns its place

| Tool | Best at here | Entry point |
| --- | --- | --- |
| Claude Code | Long agentic edits, hooks, our existing skills/subagents | `CLAUDE.md` → `AGENTS.md` |
| Cursor | Interactive IDE work, model switching, Cloud Agents, per-role models | `AGENTS.md`, reads `.claude/*` |
| Codex | Second opinion / batch tasks via `codex exec` | `AGENTS.md`, `.agents/skills` |
| Gemini CLI | Large-context reading, cheap exploration | `GEMINI.md` or `context.fileName` |

Adopt Codex and Gemini only when a concrete task needs them; the layout below makes
adoption a 1–2 file change, not a restructure.

### 5.3 Secrets and keys

Tool credentials (`CURSOR_API_KEY`, vendor keys for BYOK/CLI) are developer or CI
secrets. They never go into `.env.example`, MCP files, or the client bundle; MCP
configs use `${env:NAME}` (Cursor) or `bearer_token_env_var` (Codex). This
extends the existing "secrets are server-only" rule to tooling.

---

## 6. Target structure

### 6.1 Layers

1. **Neutral source** — content any agent can consume, in visible, reviewable
   locations: `AGENTS.md`, `.agents/skills/`, `docs/ai/`.
2. **Tool adapters** — pinned dot-directories that stay thin: only what that tool
   cannot read from layer 1.
3. **Product and delivery** — `src/`, tests, assets, migrations, CI.

### 6.2 Layout

```
AGENTS.md                         # neutral instructions (pinned)
CLAUDE.md                         # @AGENTS.md (pinned)
.mcp.json                         # Claude MCP (pinned)

.agents/                          # neutral: read by Cursor, Codex, Gemini
  skills/                         # flat; every SKILL.md carries metadata.domain
.claude/                          # Claude adapter
  settings.json                   # hooks
  hooks/svelte-legacy-guard.py
  agents/                         # subagents, shared with Cursor
  skills -> ../.agents/skills     # symlink, so Claude sees the same skills
.cursor/                          # only when needed
  agents/<name>.md                # per-role model overrides
  mcp.json                        # Cursor MCP (same servers, env interpolation)
.codex/config.toml                # only after Codex adoption
.gemini/settings.json             # only after Gemini adoption
.github/                          # GitHub: workflows, templates (pinned)
.vscode/                          # editor (pinned)

docs/
  ai/                             # was docs/ai-development
    architecture.md  skill-authoring.md  multi-llm-research.md
    providers/                    # one short page per tool: setup, quirks
    skills-catalog.md             # domain → skills table (§6.3)
  license-headers/

src/                              # unchanged
test/e2e/                         # was e2e/   (playwright testDir)
db/migrations/                    # was migrations/  (wrangler migrations_dir)
tooling/                          # was config/  (build plugins)
```

Optional, lower value: `static/` → `src/static/` through `kit.files.assets`
(option exists in SvelteKit config). It reduces root noise but also touches
`.prettierignore`, `tsconfig.json` excludes and any `/static` references; do it
last or not at all.

### 6.3 Dev / DevOps / Configuration-management split

Physical nesting is not portable (§1.4), so the split is logical and enforced by
frontmatter + catalog:

```yaml
---
name: cadbos-commits
description: …
metadata:
  domain: devops        # dev | devops | config
---
```

Cursor documents `metadata` as arbitrary key-value; it is part of the Agent Skills
format (other tools should ignore unknown keys — **unverified**, covered by spike
S3). The catalog (`docs/ai/skills-catalog.md`) is the human-readable index.

Initial classification of the current inventory:

| Domain | Skills / agents / configs |
| --- | --- |
| `dev` (writes product code) | `cadbos-conventions`, `cadbos-structure`, `cadbos-request-model`, `cadbos-integrations`, `cadbos-testing`, `cadbos-security`, `svelte-*` (runes, components, styling, template-directives, layerchart), `sveltekit-*` (data-flow, remote-functions, structure), `frontend-design`; agents `svelte-file-editor`, `test-runner`, `a11y-validator` |
| `devops` (build, review, delivery) | `cadbos-commits`, `cadbos-pull-requests`, `cadbos-self-review`, `svelte-deployment`; agent `code-reviewer`; `.coderabbit.yaml`, `.github/workflows/*` |
| `config` (managing the AI setup itself) | `prompt-architect`, `ecosystem-guide`, `skills-lock.json`, `docs/ai/*` |

`prompt-architect` (27 templates/frameworks, ~70 files) is generic and the bulk of
the skill file count; it should be the first candidate to move out of the shared
set or be installed per-developer rather than vendored, since it adds discovery
noise for every tool (Codex budgets the skill list at 2% of context).

### 6.4 What cannot move, and why

| Path | Reason |
| --- | --- |
| `.github/` | GitHub only reads this exact path |
| `.vscode/` | VS Code workspace settings and recommendations are per this folder |
| `.claude/`, `.cursor/`, `.codex/`, `.gemini/`, `.agents/` | Tool-defined discovery paths (Codex alone allows relocating its home via `CODEX_HOME`, not worth it) |
| `AGENTS.md`, `CLAUDE.md`, `.mcp.json` | Tool-defined names at repo root |
| `.coderabbit.yaml` | Root by convention; custom path **unverified** |
| `wrangler.jsonc`, `vite.config.ts`, `eslint.config.js`, `tsconfig.json`, `components.json`, `openapi-ts.config.ts` | Tool entry points; moving needs per-tool flags with no benefit |

So `.vscode/` will still sit next to `.claude/`. The mitigation is §6.1: the root
dot-directories become small adapters, and everything substantive (skills,
instructions, docs) is visible and categorised.

### 6.5 Config knobs that make the moves safe

| Move | Knob | Verified |
| --- | --- | --- |
| `e2e/` → `test/e2e/` | `testDir` in `playwright.config.ts`; update CI path in `.github/workflows/e2e.yml` (it runs `e2e/version.e2e.ts`) | `testDir` already used; CI reference found |
| `migrations/` → `db/migrations/` | `migrations_dir` in `wrangler.jsonc` | already set (`"migrations_dir": "migrations"`) |
| `config/` → `tooling/` | import path in `vite.config.ts`, include in `vite.config.ts` test project | imports and a `config/**` test include found |
| `static/` → `src/static/` | `kit.files.assets` | option exists in SvelteKit docs |
| `docs/ai-development` → `docs/ai` | links in `AGENTS.md`, `.coderabbit.yaml` `filePatterns`, `.claude/skills/**`, `.prettierignore` | references found by search |

---

## 7. DevOps-side AI: decisions needed

- **One primary automated reviewer.** CodeRabbit is configured and tuned to our
  rules (`.coderabbit.yaml`). Cursor Bugbot and `/review` overlap. Keep CodeRabbit as
  primary; use Cursor review only locally unless a bake-off shows a gap.
- **Headless agent in CI** (`agent -p`) is possible but starts with permissive tool
  approval; only adopt with `.cursor/cli.json` permissions and a read-only task
  (e.g. review comment), never write access to `master`.
- **Cloud Agents** pick up `.cursor/hooks.json` and project files; they do not
  see user-global config. Anything a Cloud Agent needs must be in the repo or team
  settings.
- **Instruction drift check.** The file map in `architecture.md` is hand-written.
  A small CI check that every path mentioned in `AGENTS.md` and `docs/ai/*.md`
  exists would prevent the layout from rotting after the moves. Add only after the
  moves land.

---

## 8. Rollout and spikes

Order is chosen so each step is independently revertible and verifiable with
`pnpm test` (plus `pnpm e2e` after step 2).

| Step | Change | Check |
| --- | --- | --- |
| 1 | `docs/ai-development` → `docs/ai`; add `providers/`, `skills-catalog.md`; fix links | `pnpm lint`; grep for the old path returns nothing |
| 2 | `e2e/` → `test/e2e/`; `migrations/` → `db/migrations/`; `config/` → `tooling/` | `pnpm test`, `pnpm e2e`, `wrangler d1 migrations list` (local) |
| 3 | Add `metadata.domain` to every skill; write the catalog | catalog lists all skills; Cursor Customize → Skills still shows each |
| 4 | Spikes S1–S3 (below) | results recorded in `providers/` pages |
| 5 | If S1 passes: skills → `.agents/skills/`, `.claude/skills` symlink | Claude, Cursor see each skill exactly once |
| 6 | Per-role `.cursor/agents/` overrides, one role at a time | compare review output on 5 past diffs |
| 7 | Delete or relocate `example.png`; decide on `static/` | — |

Spikes (small, throw-away, results go into docs):

- **S1 — duplicate skills in Cursor.** With `.agents/skills/X` and a
  `.claude/skills` symlink to it, does Cursor list `X` once or twice? Docs say
  Claude dedupes symlink targets; Cursor's behaviour is undocumented. If Cursor
  duplicates, keep `.claude/skills` real and mirror to `.agents/skills` only when
  Codex/Gemini are adopted.
- **S2 — Windows.** Git symlinks need `core.symlinks` and developer-mode on Windows.
  If any contributor is on Windows, avoid the symlink.
- **S3 — unknown frontmatter.** Confirm Claude Code, Codex and Gemini ignore
  `metadata:` in `SKILL.md`.
- **S4 — Cursor and `.mcp.json`.** Check whether Cursor loads the repo's
  `.mcp.json`; if not, add `.cursor/mcp.json` with the same Svelte MCP server.
- **S5 — role routing.** For `code-reviewer`, compare same-vendor vs
  cross-vendor models on past diffs; keep the override only if it finds more real
  issues.

Not recommended (explicitly rejected to stay within "no over-engineering"):

- A generator that emits per-tool config from one DSL — four small hand-written
  adapters are cheaper than the generator.
- Mirroring `AGENTS.md` into `GEMINI.md` / `.cursor/rules` — use the documented
  import/`context.fileName` instead.
- Nested skill folders for categories (not portable).
- Routing product LLM traffic through Cursor (not possible, and secrets rules).

---

## 9. Sources

Checked on 2026-10-06.

Cursor
- Rules / `AGENTS.md`: https://cursor.com/docs/context/rules
- Skills (locations, `paths`, nesting): https://cursor.com/docs/skills
- Subagents (locations, `model`): https://cursor.com/docs/subagents
- Hooks and third-party (Claude) hooks: https://cursor.com/docs/reference/third-party-hooks
- MCP: https://cursor.com/docs/context/mcp
- CLI overview and configuration: https://cursor.com/docs/cli/overview ,
  https://cursor.com/docs/cli/reference/configuration
- TypeScript SDK (local vs cloud, Router, `models.list`): https://cursor.com/docs/sdk/typescript
- APIs overview: https://cursor.com/docs/api
- Models and pricing: https://cursor.com/docs/models-and-pricing
- Bring your own API key: https://cursor.com/docs/settings/api-keys

Others
- Claude Code memory / `CLAUDE.md` / `AGENTS.md` / rules: https://code.claude.com/docs/en/memory
- Claude Code skills: https://code.claude.com/docs/en/skills
- Codex `AGENTS.md`: https://developers.openai.com/codex/guides/agents-md
- Codex skills: https://developers.openai.com/codex/skills
- Codex MCP and `.codex/config.toml`: https://developers.openai.com/codex/mcp
- Gemini CLI `GEMINI.md`: https://geminicli.com/docs/cli/gemini-md/
- Gemini CLI skills: https://geminicli.com/docs/cli/skills/
- SvelteKit configuration (`files.assets`): https://svelte.dev/docs/kit/configuration
