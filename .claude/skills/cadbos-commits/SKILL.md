---
name: cadbos-commits
description: >
  Conventional Commits convention for Cadbos. Load when creating git commits,
  writing commit messages, or opening a PR, to keep history consistent.
---

# Cadbos commit convention

Conventional Commits. Commit only when the user asks (per repo policy).

## Format

```
<type>(<scope>): <short imperative summary>

<optional body: what & why, wrapped ~72 cols>

<optional footer: BREAKING CHANGE:, Co-Authored-By:>
```

## Types

| Type | Use when |
|---|---|
| `feat` | A new feature |
| `fix` | A bug fix |
| `docs` | Documentation only |
| `style` | Formatting/whitespace, no logic change |
| `refactor` | Neither fixes a bug nor adds a feature |
| `perf` | Performance improvement |
| `test` | Adding or fixing tests |
| `build` | Build system, deps, tooling |
| `ci` | CI configuration |
| `chore` | Maintenance, scaffolding, config |

Scope is optional and short (e.g. `feat(chat):`, `fix(proxy):`, `chore(skills):`).

## Workflow

1. **Format first** — if the project defines a formatter (e.g. `prettier` /
   `npm run format`), run it before staging.
2. **Gather context** — `git status`, `git diff` (or `--staged`), and
   `git log --oneline -10` to match existing style.
3. **Classify** — pick one type; if several apply, split into separate commits.
4. **Write** — imperative mood ("add", not "added"); summary ≤ ~72 chars; body
   explains *why* when not obvious.
5. **Footer** — `BREAKING CHANGE: …` for incompatible changes; keep the repo's
   `Co-Authored-By:` trailer.
6. **Branch** — if on the default branch, create a feature branch first.

## Examples

```
feat(key-value): add segment reordering with drag handles
fix(proxy): retry render call only when no confirmed response
docs(ai-development): document the skill-authoring standard
chore(deps): pin svelte to 5.x and run pnpm audit
```

## Avoid

- Vague summaries ("update", "fix stuff"), past tense, trailing period.
- Mixing unrelated changes in one commit.
- Committing secrets, `.env`, or generated artifacts.
