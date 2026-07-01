---
name: cadbos-self-review
description: >
  Pre-finish / pre-commit self-review checklist for Cadbos changes. Load before
  wrapping up a change, committing, or opening a PR to catch the issues this
  project cares about most.
---

# Cadbos self-review checklist

Scan this before declaring a change done. Each item links to the skill with detail.

## Svelte 5 / code quality
- [ ] Runes only — no `on:`, `export let`, `<slot>`, `$:` (see `cadbos-conventions`;
      the `svelte-legacy-guard` hook also enforces this).
- [ ] Every touched `.svelte` passed `svelte-autofixer` with **zero** issues.
- [ ] Computed values via `$derived`, not `$effect`; no imperative view sync.

## State & three UIs
- [ ] Single store is the only data owner; views hold UI state only (`cadbos-request-model`).
- [ ] `prompt` is derived deterministically; same content → identical prompt.
- [ ] Switching views loses/duplicates nothing.

## Security
- [ ] No provider secret in client bundle/traffic. External calls go through server
      endpoints (`cadbos-integrations`).
- [ ] User input/uploads validated client + server.
- [ ] For security-sensitive changes, walk the `cadbos-security` checklist.

## Generation correctness
- [ ] No double (paid) submit; retries only without a confirmed response.
- [ ] `cost`/`balance` shown; generation blocked at limit.

## Cross-cutting
- [ ] UI text via i18n, no hardcoded strings.
- [ ] Touched Cadbos source files have the correct `docs/license-headers` header or
      are explicitly excluded by that guide.
- [ ] User-visible behavior covered per `cadbos-testing` (e2e where it matters).
- [ ] No out-of-scope work snuck in (aggregator LLM models, prompt builder, history storage).
