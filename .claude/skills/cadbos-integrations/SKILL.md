---
name: cadbos-integrations
description: >
  External integrations for Cadbos — MyArchitectAI render/interior (via server
  proxy), UploadThing image upload, and billing/limits. Load when implementing
  image upload, generation calls, the server proxy, cost/balance, or limits.
---

# Cadbos integrations

Implements SRS §8 and FR-Ж/И. All provider secrets are **server-only** (see
`cadbos-conventions`). Use `sveltekit-data-flow` for endpoint mechanics.

## MyArchitectAI `render/interior` (§8.2, FR-Ж)

- Call **only** through the Cadbos server proxy (`src/lib/server/myarchitectai.ts`
  + `routes/api/render/+server.ts`). `x-api-key` is injected server-side, never
  sent to the client (Д-3, NFR-4/5, AC-7).
- `POST https://api.myarchitectai.com/v1/render/interior`, JSON body
  `{ image, prompt, outputFormat }`:
  - `image` — **public URL** from UploadThing (Д-8; base64 not supported).
  - `prompt` — final free-text prompt, sent **as is** (no forced lang/post-processing, Д-13).
  - `outputFormat` — enum `webp|jpg|png|avif` (UI default `webp`).
- **Synchronous** call → show "generating" state with a timeout (default 120s,
  configurable; FR-Ж3, И-MA-6). No polling/webhooks.
- Response `{ output: string[], balance, cost }` → use `output[0]` (one image in
  MVP, Д-5); show `cost` & `balance` (FR-Ж7, AC-10).
- **Retries** only when there is no confirmed response (network/5xx/timeout) —
  every successful call charges `cost`; never double-submit (И-MA-7, FR-Ж6).
- Map errors (validation / limits / insufficient balance / timeout / failure) to
  clear localized messages; secrets never in logs/messages (И-MA-8, NFR-8).

## UploadThing (§8.3, FR-Ж0/Ж1)

- File router in `src/lib/server/uploadthing.ts`, mounted at `/api/uploadthing`;
  client uses `@uploadthing/svelte`. Token in `UPLOADTHING_TOKEN` (server-only).
- Limits in the route config: type `image`, `maxFileSize` 8 MB, `maxFileCount` 1
  (Д-12). Validate before the file finishes uploading.
- ACL `public-read`; returns `<APP_ID>.ufs.sh/f/<FILE_KEY>` used as `image` above.
- Abstract upload behind an adapter (provider availability/plan risk).

## Billing & limits (FR-И4, NFR-18)

- Track per-account cost of each generation (`cost` from response); show
  remaining balance/limit; **block** generation when the limit is reached.
- Accounting must be consistent: charge tied to a confirmed generation, protected
  against double-charge (FR-Ж6), reconciled with provider `cost`.
- Auth in MVP: simple login/password, password stored as a salted strong hash
  (FR-И1, NFR-17).

## Out of scope (post-MVP)

OpenRouter (LLM/image models, streaming, multi-image), private+signed upload URLs,
server-side history/settings (Д-2/Д-9a/Д-11/Д-12).
