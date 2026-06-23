---
name: cadbos-security
description: >
  Application-security checklist for the Cadbos SvelteKit app. Load when handling
  auth, the render/upload proxy, user input/uploads, cookies, headers, env/secrets,
  or any security-sensitive change — and for any security review or audit.
---

# Cadbos security checklist

OWASP-aligned, adapted to SvelteKit. Complements `cadbos-conventions` (secrets are
server-only) and `cadbos-integrations` (proxy rules). For a security review, scope
the diff, run the automated checks, then walk the Do/Avoid lists.

## Do

- **Validate input server-side** with schema validation (Zod/Valibot) before any
  processing — never trust client-side validation alone. Validate uploads (type,
  size, count) on the server too.
- **Authenticate every server endpoint / form action** before any mutation; verify
  the session before processing.
- **Authorize at the data layer** — check the user has permission on the specific
  resource (e.g. this account's quota/record), not just a valid session.
- **Keep secrets server-only** — `$env/static/private` / `$env/dynamic/private`
  (or `$lib/server/*`); never in the client bundle, traffic, logs, or errors.
- **Cookies**: `HttpOnly`, `Secure`, `SameSite=Lax|Strict`, scoped `Path`. Use the
  SvelteKit `cookies` API. Session tokens in `HttpOnly` cookies — never `localStorage`.
- **Security headers** via `handle` in `hooks.server.ts`: `Strict-Transport-Security`,
  `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`,
  `Permissions-Policy`, and a CSP with nonces/hashes (avoid `unsafe-inline`/`eval`).
- **CORS** restrictive — allowlist known origins; no wildcard `*` with credentials.
- **Hash passwords** with a strong salted KDF (argon2/bcrypt/scrypt). Never store
  or log plaintext.
- **Rate-limit** auth endpoints and the (paid) generation endpoint to curb
  brute-force and cost abuse.
- **Audit dependencies**: lockfile committed, run `pnpm audit` / `npm audit`
  regularly; enable Dependabot/Renovate/Socket.
- **Log security events** (auth failures, permission denials, validation rejections)
  with enough context to investigate, without leaking PII or secrets.

## Avoid

- **`{@html}` with unsanitized user input** — sanitize with a strict allowlist
  (DOMPurify) or avoid entirely.
- **SSRF**: don't fetch user-supplied URLs server-side without validating scheme
  (https only) and blocking private/internal IP ranges. Note: uploaded images are
  `public-read` with hard-to-guess URLs — keep that trade-off explicit and consider
  signed URLs if privacy needs grow.
- **Leaking internals** — no stack traces, server paths, or internal IDs in client
  error responses; return generic messages, log detail server-side.
- **Bypassing CSRF** — SvelteKit checks `Origin` for form actions; keep
  `csrf.checkOrigin` on.
- **Secrets in VCS** — never commit `.env`, keys, or credentials. `.env` is
  gitignored; prefer pre-commit secret scanning.
- **Over-broad scopes / keys** — least privilege for every integration and token.
- **Outdated/unmaintained deps** — treat unpatched transitive deps as exploitable.

## Automated checks (run first in a review)

```bash
# secrets in source
grep -rnE "password|secret|api[_-]?key|token|private[_-]?key" \
  --include="*.{ts,js,svelte,json,env,yml,yaml}" src 2>/dev/null | grep -vi "import\|type "
# secrets reachable from the client (must be empty)
grep -rnE "PUBLIC_.*(KEY|TOKEN|SECRET)" src 2>/dev/null
# dependency vulnerabilities
pnpm audit || npm audit
```

## Cadbos specifics

- The `x-api-key` (render service) and upload token live only in `src/lib/server/`
  and are injected by the proxy — verify they never appear in client code or network
  (DevTools check).
- The generation endpoint charges per call — protect against double-submit and tie
  rate-limits/quota to the authenticated account.
