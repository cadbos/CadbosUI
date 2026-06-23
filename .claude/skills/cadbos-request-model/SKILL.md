---
name: cadbos-request-model
description: >
  The single-source-of-truth request model behind Cadbos' three UIs (chat /
  key-value / graph). Load when implementing or changing any of the three views,
  the shared store, prompt assembly, or the three-UI identity guarantee.
---

# Cadbos request model (single source of truth)

The three input UIs (chat / key-value / graph) are **three projections of one
model**. See `cadbos-structure` for placement and `svelte-runes` for rune mechanics.

## The model

```ts
// src/lib/state/request.svelte.ts
type OutputFormat = 'webp' | 'jpg' | 'png' | 'avif';

interface PromptFragment { id: string; label?: string; text: string; order: number }
interface ImageInput { url: string; mime: string; size: number; dimensions?: [number, number] }

// one image, free-text prompt, optional assembly fragments, output format, status
```

## Rules

- **One store** in a `.svelte.ts` module is the only owner of data. Views read from
  it and mutate it through its API; they hold only UI state (node positions, scroll).
- **`prompt` is derived** (`$derived`) from `promptFragments[]` by concatenation in
  `order` (key-value & graph); in chat it is built from the dialog. Direct edits to
  `prompt` are an explicit override. No imperative synchronization.
- **Determinism**: identical content in any view → byte-identical final `prompt`
  and identical request payload.
- **Graph ↔ key-value mapping**: each fragment node = one key-value segment; edges
  to the compose node define inclusion order. Prevent cycles / dangling nodes.
- **Validation** before send: non-empty prompt + uploaded image; block with a list
  of missing fields. Guard against double (paid) submit.
- **Serialization**: JSON export/import + the basis for the identity check.

## Three-UI identity check

Same content entered via chat, then key-value, then graph must produce a
byte-identical `prompt`, an identical normalized model (minus UI fields), and an
identical request body. This is the key e2e scenario — see `cadbos-testing`.

## Scope

Free-text prompt, single image, no LLM post-processing, no preset key catalog.
