---
name: cadbos-self-review
description: >
  Pre-finish / pre-commit self-review checklist for Cadbos changes. Load before
  wrapping up a change, committing, or opening a PR to catch the issues this
  project cares about most.
---

# Cadbos self-review checklist

Scan this before declaring a change done. Each item links to the skill/spec with
detail. Most review comments map to one of these.

## Svelte 5 / code quality
- [ ] Runes only — no `on:`, `export let`, `<slot>`, `$:` (see `cadbos-conventions`;
      the `svelte-legacy-guard` hook also enforces this).
- [ ] Every touched `.svelte` passed `svelte-autofixer` with **zero** issues (NFR-16).
- [ ] Computed values via `$derived`, not `$effect`; no imperative view sync (NFR-15).

## State & three UIs
- [ ] Single store is the only data owner; views hold UI state only (`cadbos-request-model`).
- [ ] `prompt` is derived deterministically; same content → identical prompt (FR-А4/AC-9).
- [ ] Switching views loses/duplicates nothing (FR-А3).

## Security
- [ ] No provider secret (`x-api-key`, `UPLOADTHING_TOKEN`) in client bundle/traffic
      (NFR-4, AC-7). External calls go through server endpoints (`cadbos-integrations`).
- [ ] User input/uploads validated client + server (NFR-7).

## Generation correctness
- [ ] No double (paid) submit; retries only without a confirmed response (FR-Ж6, И-MA-7).
- [ ] `cost`/`balance` shown; generation blocked at limit (FR-Ж7, FR-И4, AC-10/12).

## Cross-cutting
- [ ] UI text via i18n, no hardcoded strings (NFR-11).
- [ ] User-visible behavior covered per `cadbos-testing` (e2e where it matters).
- [ ] No post-MVP work snuck in (OpenRouter, prompt builder, history storage).
