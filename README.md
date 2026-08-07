# sv

Everything you need to build a Svelte project, powered by [`sv`](https://github.com/sveltejs/cli).

## Creating a project

If you're seeing this, you've probably already done this step. Congrats!

```sh
# create a new project
npx sv create my-app
```

To recreate this project with the same configuration:

```sh
# recreate this project
pnpm dlx sv@0.16.1 create --template minimal --types ts --add eslint prettier vitest="usages:unit,component" playwright --no-download-check --install pnpm .
```

## Developing

Once you've created a project and installed dependencies with `pnpm install`, start a development server:

```sh
pnpm dev

# or start the server and open the app in a new browser tab
pnpm dev -- --open
```

## Payments services

The [Docker Compose](docker-compose.yml) stack runs the services used for Lightning payments:

| Service    | VPS access              | Purpose                                     | Persistent data                     |
| ---------- | ----------------------- | ------------------------------------------- | ----------------------------------- |
| Alby Hub   | `127.0.0.1:8080`        | Self-hosted Lightning node and NWC provider | `ALBYHUB_DATA` or `./ddata/albyhub` |
| LNbits     | `127.0.0.1:5000`        | Wallet and account API used by Cadbos       | `LNBITS_DATA` or `./ddata/lnbits`   |
| PostgreSQL | Docker network port 5432 | LNbits database                             | `PG_DATA` or `./ddata/pg`           |

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

The database name, user, and password in `LNBITS_DATABASE_URL` must match the values in `.env`. The hostname is `db`, the Compose service name, rather than `localhost`. `AUTH_HTTPS_ONLY=false` is required because the Workers VPC origin leg connects to LNbits over loopback HTTP. Cloudflare encrypts traffic until it reaches the VPS tunnel, and the Compose port is bound only to `127.0.0.1`. Review the remaining settings in `.lnbits.env`, especially authentication, allowed users, and the optional `FIRST_INSTALL_TOKEN`.

### Start and initialize

Pull the configured images and start Alby Hub:

```sh
docker compose pull
docker compose up -d albyhub
```

Open Alby Hub from the VPS or through an SSH local-forward to `127.0.0.1:8080` and complete its onboarding. Securely back up its recovery phrase and unlock password.

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

Open LNbits from the VPS or through an SSH local-forward to `127.0.0.1:5000` and create its first superuser.

Create a dedicated LNbits wallet for Cadbos and copy its invoice key from the
wallet API page.

### Configure Workers VPC

Create an HTTP VPC Service on the Cloudflare Tunnel already connected to the VPS.
The service must target hostname `localhost` and HTTP port `5000`:

```sh
pnpm exec wrangler vpc service create lnbits-equuleus \
  --type http \
  --tunnel-id <existing-vps-tunnel-id> \
  --hostname localhost \
  --http-port 5000
```

Use the returned service ID for the `LNBITS_VPC` binding in both
`wrangler.jsonc` and `wrangler.reconciler.jsonc`. Both bindings use `remote: true`,
so local Wrangler development reaches LNbits through the real private tunnel.

Configure both Workers with:

```dotenv
LNBITS_INVOICE_KEY=replace-with-the-wallet-invoice-key
PAYMENTS_WEBHOOK_URL=https://cadbos.example.com/api/webhooks/lnbits
```

`LNBITS_INVOICE_KEY` must be stored as a Cloudflare secret and must never be
exposed to the browser. Set the same two values for the Worker defined in
`wrangler.reconciler.jsonc`; it polls unfinished payment attempts once per minute
and recovers payments if webhook delivery or a request fails. `LNBITS_BASE_URL`
must be removed from existing Worker settings because all provider requests
require the VPC Service binding. Deploy the reconciler with:

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

## Building

To create a production version of your app:

```sh
pnpm build
```

You can preview the production build with `pnpm preview`.

> To deploy your app, you may need to install an [adapter](https://svelte.dev/docs/kit/adapters) for your target environment.
