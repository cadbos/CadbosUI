---
name: cadbos-structure
description: >
  SvelteKit project structure for Cadbos — where routes, stores, server-only
  modules, the generation proxy, the upload route, auth and billing live. Load
  when creating new files, adding endpoints, or navigating the codebase.
---

# Cadbos project structure (SvelteKit)

Conventions for file placement. Pair with `cadbos-conventions` (rules) and
`sveltekit-structure` / `sveltekit-data-flow` skills (framework details).

## Layout

```
src/
  lib/
    state/            # *.svelte.ts — single source-of-truth store (see cadbos-request-model)
    components/       # PascalCase.svelte UI: chat / key-value / graph views
    server/           # SERVER-ONLY (secrets never reach client)
      generation.ts     # proxy to the external render service, holds the API key
      uploads.ts        # file router, holds the upload token
      auth.ts           # Nostr challenge/verify, session (no passwords)
      billing.ts        # cost/limit accounting
    i18n/             # Russian primary, English-ready
  routes/
    +layout.svelte
    +page.svelte                 # main workspace (3 switchable views)
    api/
      uploads/+server.ts         # mounts the upload file router
      render/+server.ts          # Cadbos proxy → external render service
      auth/...                    # Nostr: challenge / verify / logout / me
```

## Placement rules

- **Secrets & external calls** → `src/lib/server/` only (server-only modules). The
  client imports the public API of these via endpoints, never the keys.
- **Single source of truth state** → `src/lib/state/*.svelte.ts`
  (see `cadbos-request-model`). The three views are projections — no shadow state.
- **Server endpoints** (`+server.ts`) for: the render proxy, the upload route,
  auth, and limit checks.
- **Views** (chat / key-value / graph) are sibling components over the same store;
  switching views must not lose/duplicate data.
