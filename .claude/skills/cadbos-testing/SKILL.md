---
name: cadbos-testing
description: >
  Testing policy for Cadbos — when to use Playwright e2e vs Vitest, the three-UI
  identity scenario, and the svelte-autofixer gate. Load when adding tests, setting
  up the test toolchain, or deciding how to cover a change.
---

# Cadbos testing policy

Pattern adapted from the surveyed ecosystem (iris-client) + SRS acceptance criteria.

## What to use

- **Playwright e2e** — for user-visible behavior, regressions, and cross-component
  flows: the generation happy path (AC-1), error/limit handling (AC-6/AC-12),
  cost/balance display (AC-10), auth gating (AC-11), and the three-UI identity
  scenario (AC-9).
- **Vitest** — only for narrow pure logic where e2e is disproportionate: derived
  `prompt` concatenation order (FR-А4), model serialization/normalization (FR-А6),
  graph↔key-value mapping (FR-Г3). Mock the provider boundary; never call real
  MyArchitectAI/UploadThing in tests.
- Don't add shallow UI Vitest tests for behavior better covered end-to-end; when
  replacing one with meaningful e2e, delete the Vitest test.

## The svelte-autofixer gate (NFR-16)

Every `.svelte` component must pass `svelte-autofixer` with zero issues before it's
considered done — iterate until clean. Prefer the `svelte-file-editor` subagent.
This is part of "definition of done", not optional.

## The three-UI identity scenario (AC-9) — must-have e2e

1. Enter fixed content via **chat** → capture: serialized `RequestModel`, final
   `prompt`, request body (proxy mock/log).
2. Reset, enter the same content via **key-value** → capture the same three.
3. Reset, build the same content in the **graph** → capture the same three.
4. Assert: `prompt` byte-identical, normalized model identical (minus UI fields),
   request body identical across all three.
5. Also: enter in one view, switch to the other two → serialized model unchanged
   (FR-А3).

## Setup pointers

Use `sv add playwright` / `sv add vitest` (see the Svelte MCP `cli/playwright`,
`cli/vitest` docs). Keep tests colocated where practical.
