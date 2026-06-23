---
name: cadbos-integrations
description: >
  External integrations for Cadbos — the interior render service (via server
  proxy), image upload, and billing/limits. Load when implementing image upload,
  generation calls, the server proxy, cost/balance, or limits.
---

# Cadbos integrations

All provider secrets are **server-only** (see `cadbos-conventions`). Use
`sveltekit-data-flow` for endpoint mechanics.

## Render service (interior generation)

- Call **only** through the Cadbos server proxy (`src/lib/server/generation.ts`
  + `routes/api/render/+server.ts`). The API key is injected server-side, never
  sent to the client.
- JSON body `{ image, prompt, outputFormat }`:
  - `image` — **public URL** from the upload step (base64 not supported).
  - `prompt` — final free-text prompt, sent **as is** (no forced language / post-processing).
  - `outputFormat` — enum `webp|jpg|png|avif` (UI default `webp`).
- **Synchronous** call → show a "generating" state with a timeout (default 120s,
  configurable). No polling/webhooks.
- Response `{ output: string[], balance, cost }` → use `output[0]` (one image);
  show `cost` & `balance`.
- **Retries** only when there is no confirmed response (network/5xx/timeout) —
  every successful call charges `cost`; never double-submit.
- Map errors (validation / limits / insufficient balance / timeout / failure) to
  clear localized messages; secrets never in logs/messages.

## Image upload

- File router in `src/lib/server/uploads.ts`, mounted at `/api/uploads`; client
  uses the Svelte upload adapter. Token is server-only.
- Limits in the route config: type `image`, max size 8 MB, count 1. Validate before
  the file finishes uploading.
- Returns a public URL used as `image` above. Abstract upload behind an adapter
  (provider availability/plan risk).

## Billing & limits

- Track per-account cost of each generation (`cost` from response); show remaining
  balance/limit; **block** generation when the limit is reached.
- Accounting must be consistent: charge tied to a confirmed generation, protected
  against double-charge, reconciled with provider `cost`.
- Auth: simple login/password, password stored as a salted strong hash.

## Out of scope

Aggregator LLM/image models, streaming, multi-image input, private+signed upload
URLs, server-side history/settings.
