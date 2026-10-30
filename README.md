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
Cloudflare Workers and uses D1 for authentication and generation records, S3-compatible image
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

Copy `.env.example` to `.env` for local Worker credentials or to override the optional
commit and release URL templates used by the version page or the Nostr relay lists:

```sh
cp .env.example .env
```

Nostr relays are configured at build time through `.env` or the build environment:

| Variable                         | Default                                          | Purpose                                           |
| -------------------------------- | ------------------------------------------------ | ------------------------------------------------- |
| `NOSTR_CONNECT_RELAYS`           | `wss://relay.damus.io,wss://nos.lol`             | Nostr Connect login relays                        |
| `NOSTR_PROFILE_BOOTSTRAP_RELAYS` | `wss://nostr.band,wss://nostr-pub.wellorder.net` | Additional profile lookup and health-check relays |

Both settings accept comma-separated WebSocket URLs (`ws://` or `wss://`). The
effective profile lookup and health-check list always includes the login relays,
followed by the additional profile relays. Each setting replaces its own defaults;
omit it to retain them. Entries are trimmed, normalized, and deduplicated in order.
Empty settings or entries, malformed URLs, credentials, query strings, and fragments
cause configuration errors. These URLs are public configuration and must not contain
secrets. Login relay origins are also included in the browser's Content Security
Policy. Restart the development server after changes; production changes require
rebuilding. Cloudflare runtime variables do not change the compiled relay lists.

Runtime integrations use Cloudflare bindings and variables rather than client-side Vite
environment variables. Their authoritative definitions are in
[`wrangler.jsonc`](wrangler.jsonc) and [`src/app.d.ts`](src/app.d.ts):

- `DB` — D1 database for users, sessions, admins, ledger entries, access approval, and generation records
- `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY` — private S3-compatible image storage
- `MEDIA_CACHE_TTL_SECONDS` — optional browser cache lifetime of `/api/media` images in
  seconds; the default is 31536000, and valid values range from 1 through 31536000
- `RENDER_MEDIA_TTL_SECONDS` — optional lifetime in seconds of the presigned image URLs
  handed to render services; the default is 10800, and valid values range from 1
  through 604800
- `ARCHAI_API_URL` and the `ARCHAI_API_KEY` secret — archAI server integration
- `ROBOKASSA_LOGIN`, `ROBOKASSA_PASSWORD1`, `ROBOKASSA_PASSWORD2`,
  `ROBOKASSA_TEST_PASSWORD1`, and `ROBOKASSA_TEST_PASSWORD2` — Robokassa merchant
  credentials; all five are configured as Worker secrets in each deployment
- `ROBOKASSA_IS_TEST` — optional Robokassa mode switch; defaults to `true` and accepts
  only `true` or `false`. Set `false` explicitly for production payments
- `ROBOKASSA_TEST_DEPOSIT_LIMIT_CENTS` — optional lifetime test-deposit cap per user
  in USD cents; unset disables the limit. When set, it accepts nonnegative safe
  integers; `0` blocks all test deposits. Test checkout and settlement reject
  deposits that would bring the user's total Robokassa credits above the cap;
  exactly the cap is allowed.
  All credits linked to Robokassa invoices count, including production deposits;
  spending does not restore the allowance. Open invoices do not reserve it.
  Production payments bypass this setting. Existing credited payments remain
  credited, and duplicate notifications are acknowledged after lowering the cap
- `ROBOKASSA_HASH_ALGORITHM` — optional signature algorithm (`md5`, `sha256`, or
  `sha512`); defaults to `md5` and must match the merchant's Robokassa setting
- `COMFYUI_BASE_URL` — private VPC service binding for ComfyUI
- `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_GRAPHQL_URL`, and the
  `CLOUDFLARE_ANALYTICS_API_TOKEN` secret — account-wide D1 usage metrics for health checks
  and the admin `/usage` page;
  `CLOUDFLARE_GRAPHQL_URL` defaults to `https://api.cloudflare.com/client/v4/graphql`;
  restrict the token to Account Analytics Read
- `D1_DAILY_ROWS_READ_LIMIT` and `D1_DAILY_ROWS_WRITTEN_LIMIT` — the active account's
  daily D1 row limits; both default to the Workers Free values `5000000` and `100000`
- `METERED_DESIGNER_PUBKEYS`, and `PUBKEY_VIEWER` — access and usage display controls
- `OBJECT_REPLACEMENT_COST`, `TEXTURE_REPLACEMENT_COST`, `LIGHT_SETTINGS_COST`,
  `FLUX_KONTEXT_EDIT_COST`, `REPAINT_COST`, and `HEALTH_CACHE_TTL_SECONDS` — optional
  operational settings

Generation timeouts are optional runtime variables configured in Cloudflare (or
`.dev.vars` for local development). Omit them to retain the defaults:

| Variable                     | Default (milliseconds) | Applies to                                                                                       |
| ---------------------------- | ---------------------: | ------------------------------------------------------------------------------------------------ |
| `COMFYUI_JOB_TIMEOUT_MS`     |               `600000` | Repaint, general edit/object removal, object replacement, texture replacement, and lighting jobs |
| `COMFYUI_REQUEST_TIMEOUT_MS` |               `120000` | ComfyUI submissions, status/output requests, and cancellation requests                           |
| `RENDER_TIMEOUT_MS`          |               `120000` | archAI interior/exterior rendering, style transfer, masked texture replacement, and 4K upscaling |

Values must be decimal integers from `1` through `2147483647`, without whitespace.
Empty or invalid values cause configuration errors rather than using defaults.
Job age includes queue time; status checks look for a completed result before
applying the timeout. Changing the job timeout affects existing processing jobs
on their next status check. A job timeout does not cancel ComfyUI execution.
Browser status requests retain their 150-second timeout and retries; a longer
server request timeout can cause browser retries before the server finishes.
Other image download limits and retry policies are configured separately.

ComfyUI job polling is controlled by the optional runtime variable
`COMFYUI_POLL_INTERVAL_SECONDS`, configured in Cloudflare or `.dev.vars`. It defaults
to `2` seconds and applies to repaint, general edit/object removal, lighting, object
replacement, and texture replacement jobs. Set it to `60` to poll once per minute.
Valid values are decimal integers from `1` through `2147483`, without whitespace or
leading zeros. Empty, malformed, or out-of-range values log a warning and use the
2-second default. Processing jobs receive the current interval in each status
response; the first status check remains immediate. Transient-error retries retain
their separate backoff policy.

Never place provider credentials in `.env` variables exposed to the client. Production
secrets, including the S3 credentials, must be configured through Cloudflare;
`wrangler.jsonc` documents the expected variable and secret names.

Apply the checked-in D1 migrations before using a new database:

```sh
pnpm exec wrangler d1 migrations apply DB --local
```

Use `--remote` instead of `--local` only when intentionally applying migrations to the
configured remote database.

Administrators (access to the usage views) live in the `admins` table. After applying the
migrations, make an account that has logged in at least once an administrator with its
64-character lowercase hex pubkey:

```sh
pnpm exec wrangler d1 execute DB --remote --command \
  "INSERT INTO admins (user_id) SELECT id FROM users WHERE pubkey = '<pubkey>'"
```

`migrations/0023_admins.sql` documents the revoke and list queries.

Before serving application traffic, provision the uploads bucket in `buckets` under the name
`cadbos-uploads`. Set `url` to the full bucket-scoped S3 API endpoint and `region` to its
signing region. Existing object keys remain in `media`; the UI reads images through the
cacheable `/api/media` route, and only render services receive presigned S3 URLs.

## Deployment

The configured target is Cloudflare Workers with Static Assets. The adapter, D1 database,
S3 storage configuration and the private VPC service are represented in `wrangler.jsonc`; deployment
therefore requires access to the Cadbos Cloudflare resources and provider credentials. A
successful `pnpm build` writes the Worker bundle to `.svelte-kit/cloudflare`.

### Ledger release

Migration `0024_ledger_entries.sql` converts stored balances and generation charges
to immutable entries in integer cents and indexes historical balance reads.
Only generations reference their ledger entries; jobs retain completion-balance
snapshots without debit references. The ledger stores balance changes and reasons
without references back to operations. Deleting a generation leaves its debit intact.
Coordinate the application release with this migration: stop all
generation requests, let processing jobs finish, record existing per-user balances
and generation counts, apply the migration, and deploy the ledger-aware application
before reopening traffic. The previous application cannot read the schema after 0024.
Follow [Cloudflare's migration procedure](https://developers.cloudflare.com/d1/reference/migrations/).

Zero-cost generations migrate to linked zero-cent debits without changing their
historical balances. All ledger credits and debits accept nonnegative integer
cents. Exact zero remains zero; positive sub-cent generation costs retain the
one-cent minimum. Charges from completed jobs whose generation history was deleted
migrate to standalone debits using their stored cost, balance and completion time without
recreating deleted generation rows. Migration 0024 rejects negative or unsafe amounts
and conflicting completed-job accounting. Never delete history or substitute charges
to satisfy validation; investigate any migration failure before reopening traffic.

Check `PRAGMA foreign_key_check`, verify each generation has a matching user-owned debit,
and compare per-user ledger sums with the pre-migration balances rounded to cents.
Smoke-test sign-in, paid and zero-cost generations, Expenses, project restoration,
and admin usage; check logs for billing and account lookup errors. A rollback must
restore the database and application versions together.

### Robokassa funding

Invoices and account ledger balances use **USD cents**. On first checkout, the
server reads the existing USD/RUB feed and freezes its normalized decimal rate,
feed timestamp, RUB amount in kopecks, signed URL, test mode, and hash algorithm.
Cadbos invoice IDs are UUIDs. Each Robokassa quote has a separate immutable numeric
`inv_id`, generated server-side and linked through `invoice_id` to the Cadbos invoice.
Callbacks and provider lookups use `inv_id`; the Cadbos API uses the UUID.
Conversion uses exact decimal arithmetic and rounds half-up to the nearest kopeck:
at 82.5 RUB/USD, one USD cent costs 83 kopecks. Quotes never expire automatically;
repeated checkout returns the stored URL without requesting another rate. Quoted
invoice ownership and amounts cannot change.

The server-side client implements `PaymentProcessor<RobokassaProcessorData>`.
`getInvoiceDetails(invoiceId)` returns the persisted USD invoice fields and typed
`processorData`: the saved `quote` (including its numeric provider ID as the
`invId` decimal string), verified callback `notification` (or `null`
when absent), and a separate live `operation`. Operation status is `available`
(with parsed provider details), `not-found`, `unavailable-for-test`, or
`not-quoted`. Quoted production invoices use the SDK's `webService.opState` with
production Password №2, the saved hash algorithm, and the injected fetch transport.
Test and unquoted invoices return stored details without a provider request:
[`OpStateExt` supports production payments only](https://docs.robokassa.ru/ru/xml-interfaces).
Operation-not-found is an expected observation; authentication, transport, malformed
responses, and other API failures reject the lookup with sanitized diagnostics.
Raw XML is excluded from returned details. Lookups never change invoices, ledger
entries, or stored notification data, even when provider state disagrees with local
status. Only verified callbacks settle payments; callback handling lives in the
internal Robokassa result handler and is absent from the payment client contract.

Configure the merchant's **ResultURL** as
`https://<application-host>/api/robokassa/result`, delivery method **GET**, before
accepting payments. Keep SvelteKit CSRF protection enabled. ResultURL verifies
Password №2 using each invoice's saved mode and hash algorithm; keep the matching
credentials available when changing deployment defaults. Notifications are uncached;
HEAD cannot settle a payment. See the [SDK verification documentation](https://github.com/robokassa/sdk-node#обработка-resulturl)
and [notification settings](https://docs.robokassa.ru/ru/notifications-and-redirects).

A verified RUB payment atomically creates one linked `top-up` credit for the full
USD invoice amount. Fees are notification metadata and do not reduce the credit.
Repeated or concurrent notifications return `OK{InvId}` after confirming the linked
credit, preserving the first payment timestamp and metadata. SQL failures roll back
settlement and return a retryable error. Funding never creates approval or changes
`credits.enabled`, and never changes the provider-wallet `balances` table.
Cancellation is local: it blocks further checkout reuse but cannot revoke a payment
URL already issued by Robokassa. A verified payment after cancellation still settles;
a paid invoice cannot be cancelled.

Apply `0024_ledger_entries.sql`, `0025_invoices.sql`,
`0026_create_prompt_translation.sql`, `0027_welcome_bonus_once.sql`, then
`0028_robokassa_invoice_details.sql` with
the coordinated ledger release procedure above. Smoke-test repeated test
notifications: exactly one linked USD credit and unchanged approval. Validate the
migration sequence in an isolated local database:

```sh
pnpm exec wrangler d1 migrations apply DB --local --persist-to /tmp/cadbos-robokassa-check
pnpm exec wrangler d1 execute DB --local --persist-to /tmp/cadbos-robokassa-check --command 'PRAGMA foreign_key_check'
```

For transactions created during payment testing, see the
[invoice UUID conversion procedure](docs/operations/invoice-uuid-conversion.md).

### Client payment API

The payment API uses the existing sign-in session cookie. Discover processors with
`GET /api/payment-processors`; the response is
`{ paymentProcessors: [{ id, invoiceCurrencies, paymentCurrencies }] }`.
Only processors with valid server configuration are advertised. Currently
Robokassa supports USD invoices paid in RUB. Discovery never contacts a provider.

Create an invoice with `POST /api/invoices`:

```json
{
	"id": "bf1d4d72-69a8-460c-b18e-a2adbd40151f",
	"paymentProcessor": "robokassa",
	"amountMinor": 1000,
	"currency": "USD"
}
```

Generate a UUID before the first request:

```js
const id = crypto.randomUUID();
```

Retain that UUID and its creation terms until the result is known. Reuse them after
network failures or lost responses; do not generate another ID on every retry.
Invoice API IDs must be valid UUID strings. Numeric Robokassa IDs are server-owned
and never accepted as Cadbos invoice IDs. Amounts are positive safe integers in USD
cents. When configured, Robokassa test payments are subject to the per-user
`ROBOKASSA_TEST_DEPOSIT_LIMIT_CENTS` cap described above.

The `invoices.id` primary key provides creation deduplication. Creation returns `201`; matching
retries return `200` with the current invoice, including after cancellation or
payment. A reused ID with another owner, processor, or amount returns
`409 invoice_conflict`, without disclosing existing invoice details. Only choose
another ID after an explicit conflict; changing processor or amount also requires
a new invoice.

All successful invoice endpoints return:

```ts
{
  id: string;
  paymentProcessor: string;
  amountMinor: number;
  currency: 'USD';
  status: 'open' | 'paid' | 'cancelled';
  createdAt: number;
  updatedAt: number;
  paidAt: number | null;
  checkout: {
    paymentUrl: string;
    amountMinor: number;
    currency: string;
    isTest: boolean;
  } | null;
}
```

Timestamps are epoch milliseconds. Checkout amounts use the payment currency's
minor units (kopecks for RUB). Checkout is `null` before quoting and after
cancellation or payment; internal ownership, ledger IDs, and callback metadata
are not exposed.

| Endpoint                           | Purpose                                                         |
| ---------------------------------- | --------------------------------------------------------------- |
| `POST /api/invoices/[id]/checkout` | Obtain or reuse the stored processor's checkout.                |
| `GET /api/invoices/[id]`           | Poll local invoice status without contacting the provider.      |
| `POST /api/invoices/[id]/cancel`   | Cancel locally; repeating succeeds, paid invoices return `409`. |

Every POST requires `Content-Type: application/json` and an `Origin` matching the
application origin, in addition to the session cookie. Checkout and cancellation
accept an empty JSON object `{}`; processor, amount, and other overrides are
rejected. New invoices and checkout require an approved, enabled account, even
when its balance is zero. Owners retain read, cancellation, and matching creation
retry access after disablement. Missing and foreign invoices return `404` on
read, checkout, and cancellation.

Test checkout returns `403 test_deposit_limit_exceeded` when previous Robokassa
credits plus the invoice amount exceed the configured cap. The same check applies
when reusing a stored test checkout. Settlement enforces the cap atomically;
over-limit test callbacks return `403` with `Test deposit limit exceeded` without
crediting the account or marking the invoice paid.

The client flow is discovery, processor selection, creation, checkout, navigation
to `checkout.paymentUrl`, and local status polling on return. Use bounded polling
and allow resuming later while the invoice remains open. Refresh `/auth/me` after
`paid` to display the updated account credit. Success/failure return pages must
only resume checking; they never settle invoices or cancel them automatically.
Configure merchant SuccessURL/FailURL to the client's return page using GET and
use the retained invoice ID for the authenticated status lookup.

Creation allows 10 requests per account per minute; checkout and cancellation
each allow 30; discovery and status share a 60-read limit. All responses are
uncached. Errors use `{ error: { code, message } }`: `400` invalid input,
`401` authentication required, `403` access/origin denied, `404` invoice
unavailable, `409` conflict, `429` rate limit, `503` dependency unavailable,
or `500` unexpected failure. Rate limits include `Retry-After: 60`; retryable
dependency failures include `Retry-After: 5`. Retry mutations using the same
invoice ID and original terms.

Register additional processors server-side using the existing payment processor
interface, configuration validation, public currency capabilities, and a local
checkout reader. Keep each provider's notification route separate. Read and
cancellation remain available when Robokassa credentials are unavailable.

Use an isolated test database and test credentials for development: test-mode
callbacks also write ledger credits. Before accepting production payments,
configure ResultURL as documented above, explicitly set
`ROBOKASSA_IS_TEST=false`, and verify production credentials and hash settings.
This API adds no migrations; the existing ledger and Robokassa migration order
still applies.

### Account funding and access

`credits` owns approval and its `enabled` flag. User balances are the sum of ledger
credits minus debits; the separate `balances` table mirrors the shared provider wallet.
Use the following SQL with `wrangler d1 execute DB --local --command` for local operations,
or intentionally select `--remote` for production. Resolve the internal user ID first:

```sql
SELECT id FROM users WHERE pubkey = '<pubkey>';
```

Approve or re-enable that account, then add funding as a separate entry. The example
adds 12.00 in the application's existing currency units:

```sql
INSERT INTO credits (user_id, enabled) VALUES ('<user_id>', 1)
ON CONFLICT (user_id) DO UPDATE SET enabled = 1;

INSERT INTO ledger_entries (user_id, amount, entry_side, reason)
VALUES ('<user_id>', 1200, 'credit', 'top-up');
```

Each funding insert is a separate top-up; repeat it only when another top-up is intended.
The welcome bonus (30 cents) is requested from the profile panel through the Featurebase
messenger. Fulfil it with the same insert using the reason `welcome-bonus`; the button
disappears once the entry exists, and migration `0027` rejects a second one for the same
account. Run the approval statement above first if the account is not approved yet.

```sql
INSERT INTO ledger_entries (user_id, amount, entry_side, reason)
VALUES ('<user_id>', 30, 'credit', 'welcome-bonus');
```

Revoke access with `UPDATE credits SET enabled = 0 WHERE user_id = '<user_id>'`.
For a balance correction, append a positive integer amount with side `credit` or `debit`
and reason `balance-correction`; never update or delete ledger entries. A credit correction
counts as funding in usage metrics. Opening balances count as funding too; inferred
`historical-reconciliation` credits are excluded from deposit totals.

```sql
SELECT COALESCE(SUM(CASE WHEN entry_side = 'credit' THEN amount ELSE -amount END), 0)
       / 100.0 AS balance
FROM ledger_entries WHERE user_id = '<user_id>';
```

Expense history and lifetime spend count debits with reason `generation-charge`,
including charges for deleted images. A row can be safely deleted from `generations`
as long as its referenced ledger row remains intact. Expense rows use ledger IDs
for stable identity and expose generation details only while that generation exists. Balance snapshots follow ledger ID order, so later funding or
backdated entries do not rewrite the balance returned for an earlier generation.

## Development guidance

Repository-wide engineering rules, testing requirements, and the Svelte MCP workflow live
in [`AGENTS.md`](AGENTS.md). The AI-assisted development setup is described in
[`docs/ai-development/architecture.md`](docs/ai-development/architecture.md).

## License

Cadbos is distributed under the Cadbos Business Source License 1.1. Use and contributions
before the applicable change date are restricted as described in [`LICENSE`](LICENSE). The
repository lists 2030-07-01 as its Change Date and the GNU General Public License version 3
or later as its Change License; the complete license controls.
