# Cadbos MVP — module breakdown and development prompts

Source of requirements: [SRS v0.11](tz-cadbos-interior-ai.md). This document decomposes
the MVP into development modules and provides a **focused prompt** for each one for use in
Claude Code — referencing our skills (`.claude/skills/`) and subagents (`.claude/agents/`).

> File layout in all prompts follows
> [cadbos-structure](../.claude/skills/cadbos-structure/SKILL.md). All modules
> are governed by the "Absolute rules" in [AGENTS.md](../AGENTS.md): runes-only, secrets
> server-only, single store, `svelte-autofixer` to zero, i18n without hardcoded strings.

---

## Module map

| # | Module | Phase | Depends on | Key FR/AC | Primary skills | Subagent |
|---|---|---|---|---|---|---|
| 0 | App scaffold + i18n + security shell | A | — | NFR-9/11/13/14, security headers | `cadbos-structure`, `cadbos-conventions`, `svelte-deployment` | `svelte-file-editor` |
| 1 | Core: unified request model (contract) | A | 0 | FR-А1…А6, AC-9 | `cadbos-request-model`, `cadbos-conventions`, `svelte-runes` | `svelte-file-editor` |
| 3 | Key-value interface | B | 1 | FR-В1…В4, AC-4 | `cadbos-request-model`, `svelte-components`, `svelte-styling` | `svelte-file-editor`, `a11y-validator` |
| 8 | Chat interface | B | 1 | FR-Б1…Б5, AC-3 | `cadbos-request-model`, `svelte-components` | `svelte-file-editor`, `a11y-validator` |
| 9 | Graph interface | B | 1 | FR-Г1…Г5, AC-5 | `cadbos-request-model`, `svelte-template-directives`, `svelte-styling` | `svelte-file-editor`, `a11y-validator` |
| 2 | Nostr auth (client + server) | C | 1 | FR-И1, FR-И7, AC-11, App. B | `cadbos-security`, `cadbos-structure`, `sveltekit-data-flow` | `svelte-file-editor`, `code-reviewer` |
| 4 | Image upload (UploadThing) | C | 1, 2 | FR-Ж0…Ж1, И-UT-*, AC-1 | `cadbos-integrations`, `cadbos-security` | `svelte-file-editor` |
| 5 | Render creation + server proxy | C | 1, 4 | FR-Ж2…Ж7, И-MA-*, AC-1/6/7 | `cadbos-integrations`, `cadbos-security` | `svelte-file-editor`, `code-reviewer` |
| 6 | Billing / limits (Account/Quota) | C | 2, 5 | FR-И4, NFR-18, AC-10/12 | `cadbos-integrations`, `cadbos-security` | `code-reviewer` |
| 7 | Render editing (`edit-by-prompt`) | C | 5, 6 | FR-К1…К7, И-MA-ED*, AC-13/14/15 | `cadbos-integrations`, `cadbos-request-model` | `svelte-file-editor` |
| 10 | Hardening: a11y / i18n / responsive / security | D | all | NFR-2,7-12,16-18 | `cadbos-testing`, `cadbos-self-review`, `cadbos-security` | `a11y-validator`, `test-runner`, `code-reviewer` |

**Mapping to SRS milestones §11.3:** Phase A → M1 (core); Phase B → part of M1 + M4 (three
views); Phase C → M1(auth)+M2+M3 (auth, upload, render, billing, editing);
Phase D → M5 (hardening). Phases are the primary planning axis; SRS milestones are for
contract traceability.

---

## Development strategy: UI-first on contract

The goal is to get a visible, clickable UI quickly and only then wire in external logic,
**without subsequent rewrites**. This is compatible with the "Absolute rules" given two
conditions: (1) views are built on top of the **real store** (Module 1), not throwaway local
state; (2) both mock and real endpoints implement **the same API contract** (below).
Three views are projections of a single source of truth (`cadbos-request-model`), and
AC-9 (three-UI identity) is held by the store from day one.

What can be deferred (clean boundaries — mocked at the endpoint level):
`/auth/*`, `/api/uploads`, `/api/render`, `/api/edit` and the server-only modules behind them
(`auth.ts`, `uploads.ts`, `generation.ts`, `billing.ts`). During the UI phase they respond
with fixtures **strictly in API contract form**.
What **cannot** be deferred: the store itself, `prompt` derivation, and the API contract.

**Phase gates:**

- **Phase A — scaffold and contract.** Module 0 → Module 1.
  *Exit:* `pnpm dev` and `pnpm build` succeed; store passes unit tests;
  three placeholder views switch without errors; mock endpoints return contract DTOs;
  security headers and CSP are served (verifiable in DevTools).
- **Phase B — UI on contract (mocks).** Modules 3 ∥ 8 ∥ 9.
  *Exit:* AC-3, AC-4, AC-5 green on mocks; AC-9 (three-UI identity) passes on
  mocks; a11y-validator with no blockers across three views.
- **Phase C — real logic.** Modules 2 → 4 → 5 → 6 → 7.
  *Exit:* AC-1, AC-6, AC-7, AC-10, AC-11, AC-12, AC-13, AC-14, AC-15 green against
  real server-only modules (external services mocked); no keys on the client;
  UI from Phase B not rewritten.
- **Phase D — hardening.** Module 10.
  *Exit:* full NFR block; e2e AC-9 per §10.1 procedure; `/security-review` clean.

**Order (dependencies):** 0 → 1 → (3 ∥ 8 ∥ 9, on mocks) → 2 → 4 → 5 → 6 → 7 → 10.
Testing (`cadbos-testing` + `test-runner`) and self-review (`cadbos-self-review`)
apply in every module, not only in Phase D.

> Skills `cadbos-structure` and `cadbos-security` have been aligned with SRS
> v0.11 (Nostr auth, no password/nsec).

---

## API contract (wire DTO) — shared between mock and real backend

This is the "contract" the strategy refers to. The proxy normalises external service
responses to these shapes, so the client does not depend on archAI differences (`output`
array vs string, И-MA-4). Both dev mocks (Module 0) and real endpoints (Phase C) return
**exactly these types** — no UI rewrite on transition. Request bodies are validated server-
side with a schema (Zod/Valibot); errors are generic, without internal details (NFR-6/8).

```ts
// src/lib/api/contract.ts — shared client↔server types (no secrets)

type OutputFormat = 'webp' | 'jpg' | 'png' | 'avif';

// Unified error (body on HTTP 4xx/5xx) — no stack/paths/internal ids
interface ApiError { error: { code: string; message: string } }

// POST /api/uploads (after UploadThing) → data for ImageInput
interface UploadResult { url: string; mime: string; size: number; dimensions?: [number, number] }

// POST /api/render — { image, prompt, outputFormat } → normalised result
interface RenderRequest { image: string; prompt: string; outputFormat: OutputFormat }
// POST /api/edit — { image, prompt } (no outputFormat; aspect ratio is preserved)
interface EditRequest { image: string; prompt: string }
// Shared response for generation and editing (output[0] for render, output for edit — normalised)
interface RenderResponse { outputUrl: string; cost: number; balance: number }

// Auth (Appendix B). Signed NIP-98 event — in Authorization: Nostr <base64> header
interface ChallengeRequest { pubkey: string }
interface ChallengeResponse { challenge: string }              // nonce, single-use, TTL ~60s
interface SessionUser { pubkey: string; firstName?: string; lastName?: string }
interface Quota { balanceOrLimit: number; usage: number; period: string }
interface MeResponse { user: SessionUser; quota: Quota }       // GET /auth/me; 401 if no session
// POST /auth/verify → 200 + Set-Cookie (httpOnly); body: { user: SessionUser }
// POST /auth/logout → 204
```

The client adapter wraps `RenderResponse` into a store `RenderResult`
(`outputUrls: [outputUrl]`, plus `parentId`/`editOp` for edits) — the array in the store
is a provision for revision history (Д-16).

---

## Prompt template (structure for all modules below)

Each prompt follows a uniform structure for agent predictability:

```
Read: <SRS sections + skills — starting context>
Goal: <what and why, with FR/AC references>
Do: <concrete steps, files, behaviour>
Do NOT: <scope boundaries — what NOT to touch in this module>
Done: <completion criteria> · Tests: <Vitest unit | Playwright e2e + AC>
```

**Common preamble** (implied in every prompt): stack Svelte 5 (runes) +
SvelteKit; read AGENTS.md and follow "Absolute rules"; cross-check Svelte/SvelteKit
syntax and external APIs against current docs (Svelte MCP: list-sections →
get-documentation), do not rely on memory; every `.svelte`/`.svelte.ts` — through
`svelte-autofixer` to zero; all UI text via i18n (`src/lib/i18n`), no hardcoding,
primary language RU; TypeScript strict, no `any`, explicit types on public APIs;
comments only if needed; on completion — self-review with `cadbos-self-review`.

---

## Module 0 — App scaffold + i18n + security shell

```
Read: SRS §9 (NFR-9/11/13/14), cadbos-structure, cadbos-conventions, cadbos-security
  (Do/Avoid: headers, CSP, CSRF), sveltekit-structure, svelte-deployment.

Goal: stand up a base SvelteKit app as the foundation for UI-first development and
establish the security shell from the very first commit.

Do:
- Initialise project: SvelteKit + Svelte 5 (runes), TypeScript strict, package
  manager **pnpm** (as per AGENTS.md "Commands"; commit `pnpm-lock.yaml`).
  Scripts: dev / build / test (type-check + lint + Vitest), e2e (Playwright).
- Layout per cadbos-structure: src/lib/state, src/lib/components, src/lib/server,
  src/lib/api (contract), src/lib/i18n, routes/+layout.svelte, routes/+page.svelte,
  routes/api/, routes/auth/.
- src/lib/api/contract.ts — types from the "API contract" section of this document.
- i18n shell (src/lib/i18n): dictionary mechanism, RU primary, EN-ready.
- Base workspace (routes/+page.svelte): switcher for three views (chat / key-value /
  graph) — placeholders for now; each view area in svelte:boundary (NFR-9).
- hooks.server.ts: security headers (Strict-Transport-Security, X-Content-Type-
  Options: nosniff, X-Frame-Options: DENY, Referrer-Policy, Permissions-Policy) and
  CSP with nonce/hash (no unsafe-inline/eval); csrf.checkOrigin enabled.
- Backend dev stubs: src/lib/server/mocks + dev-mode /api/* and /auth/* responding
  with fixtures STRICTLY in API contract form (UploadResult, RenderResponse, MeResponse,
  ChallengeResponse). Marked dev-only, replaced in Phase C.

Do NOT: real integrations (UploadThing/archAI/NDK), store business logic and
views, real authentication — mock session only.

Done: dev and build succeed; headers/CSP visible in DevTools; svelte-autofixer = 0.
  Tests: Vitest smoke (page renders, views switch); Playwright scaffold ready.
```

---

## Module 1 — Core: unified request model (contract)

```
Read: SRS §6(а) FR-А1…А6, §7 (model/sync), §10.1 (AC-9),
  cadbos-request-model, svelte-runes, cadbos-conventions.

Goal: single source of truth for three views (FR-А1…А6, AC-9). This is the Phase A
contract: the store is purely client-side (no backend needed), types and API are stable
and not rewritten later — all views are built on top of them.

Do: src/lib/state/request.svelte.ts — sole owner of request data.
- Model: id, image?: ImageInput (url/mime/size/dimensions), promptFragments:
  PromptFragment[] (id, label?, text, order), outputFormat: OutputFormat (default 'webp'),
  currentRender?: RenderResult (id, outputUrls, cost, balance, parentId?, editOp?, ts),
  status. Types reuse src/lib/api/contract.ts where appropriate.
- prompt — $derived: concatenation of promptFragments[] by order; direct prompt
  editing — explicit override flag, not lost on view switch.
- API: addFragment/updateFragment/removeFragment/reorder, setImage, setOutputFormat,
  setCurrentRender, reset, toJSON()/fromJSON() (FR-А6).
- validate(): non-empty prompt + uploaded image; list of missing fields; submit
  blocked until valid (FR-А5) + double-submit protection (FR-Ж6).
- Determinism (FR-А4): same content → byte-identical prompt and normalised model
  (without UI fields) — basis for AC-9.

Do NOT: network calls from the store; UI components; revision history (only parentId/
editOp in types as a provision for Д-16, without version/tree logic).

Done: svelte-autofixer = 0. Tests: Vitest unit — prompt derivation, reorder,
  override flag, validate, round-trip serialisation; fixture helpers for AC-9.
```

---

## Module 3 — Key-value interface

```
Read: SRS §6(в) FR-В1…В4, §10 AC-4, cadbos-request-model, svelte-components,
  svelte-styling.

Goal: "Key-value" view on top of the Module 1 store (FR-В1…В4, AC-4).

Do: src/lib/components/KeyValueView.svelte.
- Editable list of "label → text" pairs = store promptFragments[].
- Add / remove / reorder (drag and buttons) — order determines concatenation order
  (FR-А4); mutations only via store API, no shadow state.
- Preview of the final prompt ($derived from store).
- Segment change immediately updates model → reflected in chat and graph (FR-А2).
- a11y: keyboard control for list and reordering, ARIA, contrast WCAG 2.1 AA
  (NFR-10). Fully functional on mobile (NFR-12).

Do NOT: own segment storage; backend calls; styling outside design tokens.

Done: svelte-autofixer = 0, a11y-validator no blockers. Tests: Vitest component
  (CRUD/reorder segment → store); Playwright AC-4 (reflected in chat/graph — at phase gate B).
```

---

## Module 8 — Chat interface

```
Read: SRS §6(б) FR-Б1…Б5, §10 AC-3, cadbos-request-model, svelte-components.

Goal: chat-like view WITHOUT LLM (FR-Б1…Б5, AC-3). "Responses" in the feed are the results
of generation/edits and status. In Phase B results come from the mock endpoint (contract
RenderResponse); real calls are wired in Phase C (Modules 5, 7) without rewriting.

Do: src/lib/components/ChatView.svelte.
- Message input (prompt fragments / edit instructions) → form the final prompt and
  are reflected in key-value/graph (FR-Б2); mutations via Module 1 store.
- Attach image → store setImage() (FR-Б4).
- On creation/edit — status, then result image in the feed (FR-Б3).
- Session chat history, chronologically (FR-Б5).
- a11y: chat fully functional on mobile (NFR-12), keyboard/ARIA (NFR-10).

Do NOT: LLM/OpenRouter integration; direct external API calls (contract endpoint only,
mock in Phase B); own prompt state outside the store.

Done: svelte-autofixer = 0, a11y-validator no blockers. Tests: Vitest component;
  Playwright AC-3; participation in e2e AC-9.
```

---

## Module 9 — Graph interface

```
Read: SRS §6(г) FR-Г1…Г5, §10 AC-5, §7.2 (mapping), cadbos-request-model,
  svelte-template-directives, svelte-styling.

Goal: graph view of the model (FR-Г1…Г5, AC-5).

Do: src/lib/components/GraphView.svelte.
- Nodes: image / fragment / compose; edges — inclusion order of fragments in assembly.
- Add/remove fragment nodes, connect to compose; mutations via Module 1 store;
  node positions — local UI state (not in store).
- Unambiguous mapping graph ↔ key-value: fragment node = segment, edge = inclusion in
  connection order (FR-Г3).
- Prevent invalid configurations (cycles, dangling nodes) with clear indication
  (FR-Г5).
- On narrow screens graph degrades (NFR-12), without breaking the app (svelte:boundary).

Do NOT: store fragment content in the graph instead of the store; backend calls.

Done: svelte-autofixer = 0, a11y-validator no blockers. Tests: Vitest unit
  (graph validation: cycles/dangling; graph→segments); Playwright AC-5; participation in AC-9.
```

---

## Module 2 — Nostr auth (client + server)

```
Read: SRS Д-11, FR-И1/И7, §8.4 (И-NO), NFR-17, AC-11, Appendix B in full;
  cadbos-security (auth, cookies, rate-limit, validation, security event log),
  cadbos-structure, sveltekit-data-flow, svelte-runes. Cross-check NDK / nostr-tools
  API against current docs.

Goal: Phase C — replace the /auth/* dev stub with real Nostr auth; build the login UI.
Auth ONLY via Nostr: no passwords, nsec import NOT supported, private key never reaches
the server. Methods: (а) NIP-07 (NDKNip07Signer); (б) QR/NIP-46 Nostr Connect
(NDKNip46Signer). Library — NDK.

Do:
- Client: src/lib/state/auth.svelte.ts (runes) — source of truth for auth state:
  method, active NDKSigner, pubkey, profile cache (picture/name from kind:0), session flag.
  NDK + profile fetch (kind:0) and relays (NIP-65, kind:10002) from a configurable
  bootstrap set.
- Server: src/lib/server/auth.ts + routes/auth/*, contract from the "API contract" section.
  · POST /auth/challenge {pubkey} → ChallengeResponse (nonce, single-use, TTL ~60s).
  · POST /auth/verify (Authorization: Nostr <base64>) → verify NIP-98 (kind 27235):
    kind, time window ±60s, u/method tags, nonce single-use, schnorr strictly against
    pubkey FROM the event (nostr-tools verifyEvent). Find/create User{pubkey}, open
    Session, Set-Cookie httpOnly+Secure+SameSite=Lax, rotate id.
  · POST /auth/logout → 204; GET /auth/me → MeResponse | 401.
  · hooks.server.ts: cookie → event.locals.user; guard /api/render|edit|uploads.
- Validate request bodies with schema (Zod/Valibot); rate-limit /auth/challenge and
  /auth/verify (anti-brute-force); security event log (signature/nonce failures) without
  PII/secrets.
- Data model (§7): User(pubkey hex unique, firstName?, lastName?, createdAt), Session,
  AuthChallenge(nonce, pubkey, createdAt, usedAt?). No server-side profile cache.
  Minimal storage (KV/file/mini-DB), schema forward-compatible (P-7).
  firstName/lastName — Cadbos fields; after first login prompt to fill in (FR-И7).
- Establish as config (ОВ-11): signature format = NIP-98; session TTL and "remember me";
  connectRelay for NIP-46; bootstrap relay list.

Do NOT: accept nsec/seed in any form; store private key/password; log keys/signatures;
server-side storage of history/settings (post-MVP).

Done: svelte-autofixer = 0, code-reviewer no blockers. Tests: Vitest unit —
  signature verification (valid/replay/expired/wrong pubkey), endpoint guard,
  rate-limit; Playwright AC-11 (with test signer mock: login grants access).
```

---

## Module 4 — Image upload (UploadThing)

```
Read: SRS FR-Ж0/Ж1, §8.3 (И-UT-*), Д-8/Д-9/Д-9a, AC-1; cadbos-integrations,
  cadbos-security (upload validation, server-only tokens). Cross-check @uploadthing/svelte
  against current docs.

Goal: upload one image and get a public URL for the image field (FR-Ж0/Ж1, И-UT-*).
Replaces the /api/uploads mock, returns UploadResult (API contract).

Do:
- Server: src/lib/server/uploads.ts (file router) + routes/api/uploads/+server.ts.
  Token UPLOADTHING_TOKEN — server-only, not in client bundle (NFR-4/14, AC-7).
- Route constraints: type image, maxFileSize 8 MB, maxFileCount 1 (И-UT-3);
  server-side re-check of type/size (do not trust the client); ACL public-read (Д-9a).
- Client: upload component on @uploadthing/svelte; result UploadResult →
  Module 1 store setImage() (И-UT-4).
- Errors (type/size/failure) → localised ApiError message, re-select file
  (И-UT-6). Access — only with a valid session (guard from Module 2).

Do NOT: multi-upload/batch; private+signed URL (post-MVP); expose token to client.

Done: svelte-autofixer = 0; token absent from client bundle (verified). Tests:
  Vitest (type/size validation server-side, UploadResult shape); guard without session → 401.
```

---

## Module 5 — Render creation + server proxy

```
Read: SRS FR-Ж2…Ж7, §8.2.0 (И-MA-1…8), Д-5/Д-10, AC-1/6/7; cadbos-integrations,
  cadbos-security (proxy, secrets, rate-limit, error mapping), sveltekit-data-flow.

Goal: create a visual via server proxy to render/interior (FR-Ж2…Ж7). Replaces the
/api/render mock; proxy normalises output[] → RenderResponse (API contract).

Do:
- Server: src/lib/server/generation.ts + routes/api/render/+server.ts.
  POST https://api.myarchitectai.com/v1/render/interior, body {image, prompt,
  outputFormat}; x-api-key — server-side ONLY (NFR-4/5, AC-7). Synchronous, timeout 120s
  configurable (И-MA-6). output — array → take output[0] (Д-5), normalise to
  RenderResponse; adapter tolerates string format too (И-MA-4).
- Validate body with schema (Zod/Valibot, RenderRequest); rate-limit /api/render
  (anti-cost-abuse, bound to pubkey).
- Errors: generic HTTP → localised ApiError messages (validation/limit/timeout/failure/
  insufficient balance); secrets not in logs/responses (NFR-6/8, AC-6).
  Retry only without a confirmed response (И-MA-7); double-submit protection (FR-Ж6).
- Client: trigger from workspace, "generation in progress" state (FR-Ж3); on response —
  full-size view + download; result → currentRender (FR-Ж4) for Module 7.
  cost/balance (FR-Ж7) — link with Module 6. Guard: valid session only.

Do NOT: edit-by-prompt (Module 7); multi-image; auto-prompt/upscale (post-MVP);
expose x-api-key to client.

Done: svelte-autofixer = 0, code-reviewer no blockers. Tests: Vitest (proxy with mocks:
  success/timeout/errors/output normalisation, anti-dup, rate-limit); Playwright
  AC-1/AC-6; verify key absent from client (AC-7).
```

---

## Module 6 — Billing / limits (Account/Quota)

```
Read: SRS FR-И4, NFR-18, AC-10/12; cadbos-integrations, cadbos-security
  (data-level authorisation).

Goal: cost tracking and limits at the Cadbos account level (FR-И4, NFR-18, AC-10/12).

Do:
- Server: src/lib/server/billing.ts. Model Account/Quota(userId, balanceOrLimit,
  usage, period), bound to pubkey (Module 2). Data-level authorisation: quota belongs
  to the current pubkey, not just any valid session.
- On each confirmed generation (Module 5) and edit (Module 7) deduct cost from the
  response; consistency with cost/balance, double-deduction protection (NFR-18, FR-Ж6);
  deduction atomic with call confirmation.
- Before launch: balance/limit exhausted → block with message (AC-12); before operation
  show expected cost and remaining balance (AC-10).
- Client: balance/limit and operation cost indicator in workspace (FR-Ж7, FR-И4).

Do NOT: payment processing/gateways (post-MVP); deduct before call is confirmed.

Done: code-reviewer no blockers. Tests: Vitest — deduction exactly once, block on
  exhaustion, no double-deduction, quota isolation by pubkey; Playwright AC-10/AC-12.
```

---

## Module 7 — Render editing (`edit-by-prompt`)

```
Read: SRS FR-К1…К7, §8.2.1 (И-MA-ED1…3), Д-15/Д-16/Д-17, AC-13/14/15;
  cadbos-integrations, cadbos-request-model, cadbos-security.

Goal: iterative natural-language editing of the current render (FR-К1…К7). No masks —
target specified in words. Replaces the /api/edit mock; response normalised to RenderResponse.

Do:
- Server: extend src/lib/server/generation.ts + routes/api/edit/+server.ts.
  POST /v1/edit-by-prompt, body {image, prompt} (NO outputFormat). image = URL of current
  render currentRender.outputUrls[0] (Д-17). output — string → RenderResponse (И-MA-4).
  Timeout/retry/errors same as render (И-MA-ED3). Validate with schema (EditRequest);
  rate-limit /api/edit.
- Model: EditOperation(type: 'replace-object'|'change-surface-color'|'freeform',
  instruction). API receives instruction; type is a UX category. Result → new
  currentRender with parentId/editOp (provision for Д-16). Iterative (FR-К4).
- Undo last edit to previous currentRender — in-session (FR-К6).
- Client: coherent "create → refine" cycle; suggestion templates for "replace object"/
  "change surface colour" as UX wrapper over free text (FR-К7); state and cost indication.
  Each edit is a paid call via Module 6 (FR-К5), anti-dup.

Do NOT: full revision history/tree/revert to arbitrary version (post-MVP Д-16,
only parent-link); masks/region selection; upscale (post-MVP).

Done: svelte-autofixer = 0. Tests: Vitest (output normalisation, chain image=
  previous render, anti-dup, rate-limit); Playwright AC-13 (object replacement),
  AC-14 (surface colour), AC-15 (iterative + undo).
```

---

## Module 10 — Hardening (a11y / i18n / responsive / performance / security)

```
Read: SRS §9 (full NFR block), §10.1 (AC-9); cadbos-testing, cadbos-self-review,
  cadbos-security (full checklist). Subagents: a11y-validator, test-runner, code-reviewer.

Goal: bring the MVP to Definition of Done on the NFR block before acceptance.

Do:
- a11y (NFR-10): audit — keyboard, ARIA roles/labels, WCAG 2.1 AA contrast across three
  views + auth + render result.
- i18n (NFR-11): no hardcoded strings; full RU dictionary, EN-ready.
- Responsive (NFR-12): desktop + mobile; graph degradation; chat and key-value fully
  functional on mobile; evergreen browsers.
- Performance (NFR-2/3): view switching and prompt derivation ≤100ms at ≤50 segments;
  TTI budget, SSR/code-splitting.
- Failure isolation (NFR-9): svelte:boundary around views/calls.
- Security (NFR-4/6/7/17, AC-7): final pass of cadbos-security — secrets server-only
  and not in logs; no private keys on server; server-side input/file validation (Zod/Valibot);
  cookie httpOnly/Secure/SameSite; security headers + CSP active; rate-limit on /auth/* and
  /api/render|edit in place. Run /security-review on the branch diff and close all findings.

Do NOT: new features; store/contract refactor without necessity.

Done: full NFR block satisfied, svelte-autofixer = 0 across all components,
  /security-review clean. Tests: Playwright — full e2e AC-9 per §10.1 procedure
  (chat → key-value → graph produce byte-identical prompt and request body);
  all e2e/unit green (test-runner).
```

---

## What is intentionally out of MVP scope (not done in these modules)

Revision history / branching / revert to arbitrary version (Д-16, only parent-link
provisioned); OpenRouter (LLM chat, model selection, multi-image); step-by-step prompt
constructor and key catalogue (Appendix A); EN-requirement and LLM post-processing of
the prompt; server-side history/settings storage; `auto-prompt`, `upscale-4k`,
`style-transfer`, exterior, video, batch; payment gateways; masks/region selection
when editing.
