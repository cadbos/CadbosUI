# Cadbos code style

Detailed style reference for the Cadbos Svelte 5 / SvelteKit codebase. Loaded on
demand from the `cadbos-conventions` skill.

## TypeScript

- `strict` mode on. Avoid `any`; prefer precise types and discriminated unions.
- Explicit return types on all exported/public functions and methods.
- ES modules only (`import` / `export`). Use the `$lib` alias for app imports.
- Validate external/untrusted data at the boundary (e.g. Zod) before use.

## Svelte 5

- Runes only: `$state`, `$derived`, `$effect`, `$props`, `$bindable`. No Svelte 4
  syntax (`on:click`, `export let`, `<slot>`, `$:`).
- Prefer `$derived` over `$effect` for computed values; reserve `$effect` for genuine
  side effects with proper cleanup.
- Shared reactive state lives in `.svelte.ts` modules, not duplicated in components.

## Files & naming

- Components: `PascalCase.svelte`, one component per file.
- Reactive modules / stores: `name.svelte.ts`. Plain logic: `name.ts` (kebab-case).
- Tests: co-located, `*.test.ts` (Vitest) next to the source.
- `PascalCase` for types/interfaces/classes; `camelCase` for functions/variables.

## Server / security

- Server-only code (secrets, proxies) under `src/lib/server/`. Provider secrets never
  in the client bundle or traffic.
- External APIs only via SvelteKit server endpoints (`+server.ts`).

## i18n & comments

- All UI text via the i18n layer — no hardcoded strings. Russian primary, English-ready.
- No comments unless explicitly requested; no placeholder comments. If a `TODO` is
  truly needed, reference an issue.

## Imports

- Group: external packages, blank line, then `$lib`/internal imports.
- ESM style; no default exports except where a framework requires them.
