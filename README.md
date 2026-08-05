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

## Payments services

The [Docker Compose](docker-compose.yml) stack runs the services used for Lightning payments:

| Service    | Local URL               | Purpose                                     | Persistent data                     |
| ---------- | ----------------------- | ------------------------------------------- | ----------------------------------- |
| Alby Hub   | <http://localhost:8080> | Self-hosted Lightning node and NWC provider | `ALBYHUB_DATA` or `./ddata/albyhub` |
| LNbits     | <http://localhost:5000> | Wallet and account API used by Cadbos       | `LNBITS_DATA` or `./ddata/lnbits`   |
| PostgreSQL | Internal port `5432`    | LNbits database                             | `PG_DATA` or `./ddata/pg`           |

Docker Engine with the Compose plugin is required.

### Configure the stack

Copy the LNbits configuration template. Both the resulting file and the root `.env` file are ignored by Git because they contain secrets.

```sh
cp .lnbits.env.example .lnbits.env
```

Add the PostgreSQL settings to the root `.env` file. Generate a different random value for each secret with `openssl rand -hex 32`.

```dotenv
DB_NAME=lnbits
DB_USER=lnbits
DB_PASSWORD=replace-with-a-random-hex-value
```

The three data directories default to `./ddata`. To store them elsewhere, also set one or more absolute host paths in `.env`:

```dotenv
ALBYHUB_DATA=/path/to/albyhub
LNBITS_DATA=/path/to/lnbits
PG_DATA=/path/to/postgres
```

Set at least the following values in `.lnbits.env`:

```dotenv
HOST=0.0.0.0
AUTH_HTTPS_ONLY=false
AUTH_SECRET_KEY="replace-with-a-different-random-hex-value"
LNBITS_DATABASE_URL="postgres://lnbits:replace-with-the-db-password@db:5432/lnbits"
LNBITS_EXTENSIONS_PATH="/app/data/extensions"
```

The database name, user, and password in `LNBITS_DATABASE_URL` must match the values in `.env`. The hostname is `db`, the Compose service name, rather than `localhost`. `AUTH_HTTPS_ONLY=false` is appropriate only for local HTTP access; use HTTPS and set it to `true` when exposing LNbits through a reverse proxy. The current port mappings publish Alby Hub and LNbits on every host interface, so protect them with host firewall rules or a properly configured reverse proxy. Review the remaining settings in `.lnbits.env`, especially authentication, allowed users, and the optional `FIRST_INSTALL_TOKEN`, before exposing either service outside the local machine.

### Start and initialize

Pull the configured images and start Alby Hub:

```sh
docker compose pull
docker compose up -d albyhub
```

Open Alby Hub at <http://localhost:8080> and complete its onboarding. Securely back up its recovery phrase and unlock password.

LNbits uses `VoidWallet` from `.lnbits.env` by default. This is suitable for opening the interface but cannot process real Lightning payments. Before starting LNbits, configure Alby Hub as its funding source:

1. In Alby Hub, create an NWC connection for LNbits with the permissions and spending limit required by the deployment, then copy its pairing URL.
2. Replace the funding-source values in `.lnbits.env` with:

   ```dotenv
   LNBITS_BACKEND_WALLET_CLASS=NWCWallet
   NWC_PAIRING_URL="nostr+walletconnect://replace-with-the-alby-hub-pairing-url"
   ```

The NWC pairing URL authorizes wallet access and must be treated as a secret. See the [Alby Hub connection guide](https://guides.getalby.com/user-guide/alby-hub/app-connections) and [LNbits backend wallet documentation](https://docs.lnbits.org/guide/wallets.html#nostr-wallet-connect-nwc) for the provider-specific setup. To evaluate LNbits without real payments, leave `VoidWallet` configured and skip the NWC steps.

Start the complete stack and verify its status:

```sh
docker compose up -d
docker compose ps
```

Open LNbits at <http://localhost:5000> and create its first superuser.

Create a dedicated LNbits wallet for Cadbos and copy its invoice key from the
wallet API page. Configure the SvelteKit Worker and the reconciliation Worker
with:

```dotenv
LNBITS_BASE_URL=https://lnbits.example.com
LNBITS_INVOICE_KEY=replace-with-the-wallet-invoice-key
PAYMENTS_WEBHOOK_URL=https://cadbos.example.com/api/webhooks/lnbits
```

`LNBITS_INVOICE_KEY` must be stored as a Cloudflare secret and must never be
exposed to the browser. Set the same three values for the Worker defined in
`wrangler.reconciler.jsonc`; it polls unfinished payment attempts once per minute
and recovers payments if webhook delivery or a request fails. Deploy it with:

```sh
pnpm exec wrangler deploy --config wrangler.reconciler.jsonc
```

Apply the D1 migrations before deploying either Worker. Migration
`0011_ledgers.sql` introduces the ledger schema after the resource migrations, and
`0012_payment_packages.sql` installs the $1, $3, and $5 packages.

Inspect status and logs with:

```sh
docker compose ps
docker compose logs -f albyhub lnbits db
```

Stop the containers with `docker compose down`. The bind-mounted data remains in the configured host directories and is reused on the next start.

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
