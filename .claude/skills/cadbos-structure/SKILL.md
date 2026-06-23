---
name: cadbos-structure
description: >
  SvelteKit project structure for Cadbos — where routes, stores, server-only
  modules, the MyArchitectAI proxy, UploadThing route, auth and billing live. Load
  when creating new files, adding endpoints, or navigating the codebase.
---

# Cadbos project structure (SvelteKit)

Conventions for file placement. Pair with `cadbos-conventions` (rules) and
`sveltekit-structure` / `sveltekit-data-flow` skills (framework details).

## Layout

```
src/
  lib/
    state/            # *.svelte.ts — единый store (see cadbos-request-model)
    components/       # PascalCase.svelte UI: chat / key-value / graph views
    server/           # SERVER-ONLY (secrets never reach client)
      myarchitectai.ts  # proxy to render/interior, holds x-api-key
      uploadthing.ts    # file router, holds UPLOADTHING_TOKEN
      auth.ts           # login/password (hashed), session
      billing.ts        # cost/limit accounting (FR-И4, NFR-18)
    i18n/             # RU primary, EN-ready (NFR-11)
  routes/
    +layout.svelte
    +page.svelte                 # main workspace (3 switchable views)
    api/
      uploadthing/+server.ts     # mounts UploadThing file router
      render/+server.ts          # Cadbos proxy → MyArchitectAI render/interior
      auth/...                    # login/register/logout endpoints
```

## Placement rules

- **Secrets & external calls** → `src/lib/server/` only (server-only modules,
  NFR-4/5/14). Client imports the public API of these via endpoints, never the keys.
- **Single source of truth state** → `src/lib/state/*.svelte.ts`
  (see `cadbos-request-model`). The three views are projections — no shadow state.
- **Server endpoints** (`+server.ts`) for: the `render/interior` proxy, the
  UploadThing route, auth, and limit checks.
- **Views** (chat / key-value / graph) are sibling components over the same store;
  switching views must not lose/duplicate data (FR-А2/А3).

## Don't create (post-MVP)

OpenRouter proxy, prompt-builder wizard, server-side history/settings storage
(Д-2/Д-11/Д-13). Keep `image` single per request (Д-12).
