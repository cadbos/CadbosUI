---
name: cadbos-conventions
description: >
  Coding conventions for the Cadbos Svelte 5 / SvelteKit app. Load when writing or
  editing any app code — components, stores, server endpoints, styles — to follow
  project rules on reactivity, file types, i18n, security, and code style.
---

# Cadbos coding conventions

Grounded in the SRS ([docs/tz-cadbos-interior-ai.md](../../../docs/tz-cadbos-interior-ai.md),
NFR-4/5/7/11/13/14/15/16). For *where* files live see `cadbos-structure`; for
Svelte 5 syntax details use the `svelte-runes` skill and the Svelte MCP.

## Language & reactivity

- **Svelte 5 runes only**: `$state`, `$derived`, `$effect`, `$props`, `$bindable`.
  No Svelte 4 syntax (`on:click`, `export let`, `<slot>`, `$:` reactive statements).
- **Shared/reactive state** lives in `.svelte.ts` modules (NFR-13). UI components
  are projections of state, not owners of duplicated ("shadow") state.
- Prefer `$derived` over `$effect` for computed values. The final `prompt` is
  **derived**, never imperatively synced across views (NFR-15, FR-А4).
- TypeScript everywhere. Use the `@/`-style `$lib` alias for app imports.

## Files

- Components: `PascalCase.svelte`, one component per file.
- Reactive modules / stores: `*.svelte.ts`. Plain logic: `*.ts`.
- Server-only code (secrets, proxies): under `src/lib/server/` (see `cadbos-structure`).

## Security (hard rules)

- Provider secrets — MyArchitectAI `x-api-key`, `UPLOADTHING_TOKEN` — are
  **server-only** and MUST NOT reach the client bundle or traffic (NFR-4, AC-7).
- External APIs are called **only** through SvelteKit server endpoints / the Cadbos
  proxy (NFR-5). The client never holds provider keys.
- Validate & sanitize all user input and uploads on both client and server (NFR-7).

## i18n

- All UI text through the i18n layer — no hardcoded strings (NFR-11). RU is the
  primary language; keep the architecture EN-ready. Prompt text itself stays
  free-form / any language (no forced translation in MVP, Д-13).

## Code style

- No comments unless explicitly requested. No placeholder comments.
- Keep files focused; split by responsibility as they grow.

## Definition of done

- Component passes `svelte-autofixer` with **zero** issues/suggestions (NFR-16) —
  iterate until clean. Use the `svelte-file-editor` subagent for `.svelte` work.
- No provider secret reachable from the client.
- New user-visible behavior covered per the `cadbos-testing` policy.

## Out of scope (post-MVP — do not implement unless asked)

OpenRouter / LLM chat / streaming, the step-by-step prompt builder, server-side
storage of history/settings (Д-2/Д-11/Д-13).
