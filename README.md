# Cadbos Interior Design AI

Cadbos turns a room or building photo into new interior and exterior concepts. Users can
describe a result in natural language, refine the prompt through interchangeable input
views, and continue editing generated scenes without exposing provider credentials to the
browser.

## Features

- Interior and exterior generation from an uploaded photo or HTTPS image URL
- Interchangeable chat, key-value, and graph prompt editors backed by one shared state
- Prompt-based editing and style transfer with preset or custom reference images
- Object replacement, automatic or masked texture replacement, and 4K upscaling
- Nostr authentication through a browser extension or Nostr Connect
- Per-account generation access and credit tracking
- Reusable uploads, generation history, before/after comparison, and downloads
- Service-health, version, and administrator usage views
- Russian-first interface with an English translation layer

## Technology

Cadbos is a TypeScript application built with Svelte 5 runes and SvelteKit. It deploys to
Cloudflare Workers and uses D1 for authentication and generation records, R2 for image
storage, archAI for generation workflows, and a private ComfyUI service for object and
reference-guided texture replacement. All provider calls and secrets remain in server-only
modules and SvelteKit endpoints.

## Getting started

You need:

- Node.js 22.18 or newer
- pnpm 10.18
- Git, because build metadata includes the current commit

Install the dependencies and start the development server:

```sh
pnpm install
pnpm dev
```

Open the URL printed by Vite. Development mode includes a demo sign-in and deterministic
fixtures for the core upload and generation flows, so those flows can be exercised without
provider credentials. Features backed by Cloudflare resources or the private ComfyUI
service require access to the corresponding bindings.

To run browser-based unit tests or end-to-end tests, install Chromium once:

```sh
pnpm exec playwright install chromium
```

## Commands

| Command                   | Purpose                                                |
| ------------------------- | ------------------------------------------------------ |
| `pnpm dev`                | Start the Vite development server                      |
| `pnpm check`              | Run SvelteKit synchronization and Svelte type checking |
| `pnpm lint`               | Check formatting and run ESLint                        |
| `pnpm test:unit -- --run` | Run the Vitest server and browser test suites once     |
| `pnpm test`               | Run type checking, linting, and all Vitest suites      |
| `pnpm e2e`                | Build the app and run the Playwright end-to-end suite  |
| `pnpm build`              | Create a production Cloudflare Workers build           |
| `pnpm preview`            | Preview the production build locally                   |

## Configuration

Copy `.env.example` to `.env` only when you need to override the optional commit and
release URL templates used by the version page:

```sh
cp .env.example .env
```

Runtime integrations use Cloudflare bindings and variables rather than client-side Vite
environment variables. Their authoritative definitions are in
[`wrangler.jsonc`](wrangler.jsonc) and [`src/app.d.ts`](src/app.d.ts):

- `DB` — D1 database for users, sessions, credits, and generation records
- `UPLOADS_BUCKET` and `UPLOADS_PUBLIC_URL` — R2 image storage and its public base URL
- `ARCHAI_API_URL` and the `ARCHAI_API_KEY` secret — archAI server integration
- `COMFYUI_BASE_URL` — private VPC service binding for ComfyUI
- `ADMIN_PUBKEYS`, `METERED_DESIGNER_PUBKEYS`, and `PUBKEY_VIEWER` — access and usage
  display controls
- `OBJECT_REPLACEMENT_COST`, `TEXTURE_REPLACEMENT_COST`, and
  `HEALTH_CACHE_TTL_SECONDS` — optional operational settings

Never place provider credentials in `.env` variables exposed to the client. Production
secrets must be configured through Cloudflare; `wrangler.jsonc` documents the expected
secret names and resource bindings. Apply the checked-in D1 migrations before using a new
database:

```sh
pnpm exec wrangler d1 migrations apply DB --local
```

Use `--remote` instead of `--local` only when intentionally applying migrations to the
configured remote database.

## Deployment

The configured target is Cloudflare Workers with Static Assets. The adapter, D1 database,
R2 bucket, and private VPC service are already represented in `wrangler.jsonc`; deployment
therefore requires access to the Cadbos Cloudflare resources and provider credentials. A
successful `pnpm build` writes the Worker bundle to `.svelte-kit/cloudflare`.

## Development guidance

Repository-wide engineering rules, testing requirements, and the Svelte MCP workflow live
in [`AGENTS.md`](AGENTS.md). The AI-assisted development setup is described in
[`docs/ai-development/architecture.md`](docs/ai-development/architecture.md).

## License

Cadbos is distributed under the Cadbos Business Source License 1.1. Use and contributions
before the applicable change date are restricted as described in [`LICENSE`](LICENSE). The
repository lists 2030-07-01 as its Change Date and the GNU General Public License version 3
or later as its Change License; the complete license controls.
