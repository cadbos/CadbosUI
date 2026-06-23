---
name: cadbos-conventions
description: >
  Coding conventions for the Cadbos Svelte 5 / SvelteKit app. Load when writing or
  editing any app code — components, stores, server endpoints, styles — to follow
  project rules on reactivity, file types, i18n, security, and code style.
---

# Cadbos coding conventions

For *where* files live see `cadbos-structure`; for Svelte 5 syntax details use the
`svelte-runes` skill and the Svelte MCP.

## Language & reactivity

- **Svelte 5 runes only**: `$state`, `$derived`, `$effect`, `$props`, `$bindable`.
  No Svelte 4 syntax (`on:click`, `export let`, `<slot>`, `$:` reactive statements).
- **Shared/reactive state** lives in `.svelte.ts` modules. UI components are
  projections of state, not owners of duplicated ("shadow") state.
- Prefer `$derived` over `$effect` for computed values. The final prompt is
  **derived**, never imperatively synced across views.
- TypeScript everywhere. Use the `$lib` alias for app imports.

## Files

- Components: `PascalCase.svelte`, one component per file.
- Reactive modules / stores: `*.svelte.ts`. Plain logic: `*.ts`.
- Server-only code (secrets, proxies): under `src/lib/server/` (see `cadbos-structure`).

## Security (hard rules)

- Provider secrets (external API keys, upload tokens) are **server-only** and MUST
  NOT reach the client bundle or traffic.
- External APIs are called **only** through SvelteKit server endpoints / the Cadbos
  proxy. The client never holds provider keys.
- Validate & sanitize all user input and uploads on both client and server.

## i18n

- All UI text through the i18n layer — no hardcoded strings. Russian is the primary
  language; keep the architecture English-ready. Prompt text itself stays free-form
  / any language (no forced translation).

## Code style

- No comments unless explicitly requested. No placeholder comments.
- Keep files focused; split by responsibility as they grow.
- Full style reference (TypeScript, naming, imports, files):
  [references/code-style.md](references/code-style.md).

## Definition of done

- Component passes `svelte-autofixer` with **zero** issues/suggestions — iterate
  until clean. Use the `svelte-file-editor` subagent for `.svelte` work.
- No provider secret reachable from the client.
- New user-visible behavior covered per the `cadbos-testing` policy.
