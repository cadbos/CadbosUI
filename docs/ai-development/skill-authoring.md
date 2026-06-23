# Skill authoring standard

How to write skills in this repo. Adapted from the patterns observed across the
ecosystem (hypha-web `create-skill`, tenex `creating-skills`).

## Layout

```
skill-name/                # dir name = skill ID; kebab-case, short, descriptive
├── SKILL.md               # required: YAML frontmatter + Markdown, < 200 lines
├── references/            # optional: docs the agent reads on demand
├── scripts/               # optional: executable helpers
└── assets/                # optional: templates / examples used in output
```

Project skills live in `.claude/skills/`; name product skills `cadbos-*`.

## Frontmatter

```yaml
---
name: <skill-id>
description: >
  One specific sentence. Start with what it covers, then "Load when …" so the agent
  matches it to a task. This text is always in context — make it precise.
---
```

Optional (Claude Code): `allowed-tools:` to restrict the tool set while the skill is
active (e.g. a read-only review skill).

## The 200-line rule (progressive disclosure)

Keep `SKILL.md` **under 200 lines**. Three loading levels:

1. **Metadata** (`name` + `description`) — always in context.
2. **SKILL.md body** — loaded when the skill triggers (< 200 lines).
3. **Bundled resources** (`references/`, `scripts/`, `assets/`) — read only as needed.

If the body grows past ~200 lines, move depth into `references/` and link to it (see
`cadbos-conventions` → `references/code-style.md`). This keeps activation fast and the
always-on surface small.

## Quality bar

- One concern per skill; a sharp `description` that won't over-trigger.
- No duplication of framework-skill content (Svelte) or other project skills — link
  instead.
- Follow the repo [Absolute rules](../../AGENTS.md#absolute-rules-no-exceptions).
