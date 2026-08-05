# Lightning payments

Cadbos sells fixed $1, $3, and $5 packages for 3, 9, and 15 app credits. The
browser receives a BOLT11 invoice and pays it with any Lightning wallet.

## Architecture

Cadbos talks only to the LNbits REST API. LNbits uses an Alby Hub NWC connection
as its funding source:

```text
Cadbos Worker -> LNbits REST API -> NWC -> Alby Hub
```

The Alby Hub pairing URL is stored only in LNbits. Cadbos stores only the LNbits
base URL and invoice key; no NWC credential reaches the application or browser.

The payment path consists of:

- `GET /api/packages`, which returns enabled packages to an authenticated user;
- `POST /api/deposits`, which accepts an idempotency UUID and a package ID;
- `GET /api/deposits/[id]`, which checks LNbits and returns the owned attempt;
- `POST /api/webhooks/lnbits`, which treats the callback as an untrusted wake-up
  signal and verifies state with an authenticated LNbits lookup;
- `src/workers/deposit-reconciler.ts`, which retries unfinished attempts every
  minute when callbacks or request responses are lost.

Invoices expire after 15 minutes. Expired attempts remain in scheduled
reconciliation for a 24-hour late-settlement window; the webhook and an owned
status lookup can also recognize a later payment, which is credited exactly once.

## Failure recovery

A deposit row and `attempt_created` event are persisted before any provider call.
The USD/BTC rate and exact sat amount are then snapshotted before invoice
creation. The LNbits invoice contains `extra.cadbos_attempt_id`.

If invoice creation has an ambiguous result, Cadbos keeps every stored field and
event. A retry searches LNbits payment history for that attempt ID before it may
create another invoice. Invoice creation is serialized with a three-minute
database lease shared by API requests, status polling, webhooks, and the scheduled
worker. Claiming a `creating` attempt advances both its creation lease and its
reconciliation time atomically. A caller that loses the claim returns the stored
`creating` attempt without contacting LNbits. The lease is cleared when an invoice
or a provider failure is persisted.

Provider observations and errors are appended to `payment_events`; events cannot
be updated or deleted. Scheduled reconciliation claims at most 25 due deposits per
run and processes no more than five provider requests concurrently. Its logs contain
only aggregate outcome counts and sanitized error names.

## Accounting

Sats, USD, provider IDs, and the BOLT11 invoice remain immutable payment-history
attributes. They are not mixed into the internal ledger.

The internal ledger has two assets: `app_credit` and `archai_token`. Every paid
deposit writes one finalized transaction with four entries:

| Asset        | Account                | Entry           |
| ------------ | ---------------------- | --------------- |
| app credit   | user's balance         | package amount  |
| app credit   | system control         | negative amount |
| archAI token | provider asset balance | package amount  |
| archAI token | system control         | negative amount |

Generation spending uses the inverse four-entry transfer. A database trigger
rejects finalization unless each asset represented in a transaction has at least
two entries whose sum is zero. Ledger accounts, finalized transactions, entries,
openings, paid deposits, and payment events are immutable.

Provider settlement is recorded before ledger finalization. If finalization
fails, the paid-provider event and all invoice data remain available and the
attempt stays scheduled for recovery. The deterministic transaction ID
`deposit:<deposit-id>` and database uniqueness constraints make crediting
idempotent.

`paid_at` is the first time Cadbos successfully verifies the payment with LNbits.
That timestamp is stored in the deduplicated `provider_paid` event and reused by
later finalization attempts. LNbits metadata is not treated as Cadbos settlement
time.

Payment status is requested from LNbits by the stored payment hash. Cadbos credits
an attempt only when the response payment hash, checking ID, millisatoshi amount,
`paid` flag, and status all agree with the immutable invoice snapshot and with one
another. Malformed, contradictory, or mismatched responses are provider failures.

## Configuration

Cadbos and the reconciliation Worker require:

```dotenv
LNBITS_BASE_URL=https://lnbits.example.com
LNBITS_INVOICE_KEY=replace-with-the-wallet-invoice-key
PAYMENTS_WEBHOOK_URL=https://cadbos.example.com/api/webhooks/lnbits
```

The invoice key is server-only. LNbits is configured separately with
`LNBITS_BACKEND_WALLET_CLASS=NWCWallet` and the Alby Hub `NWC_PAIRING_URL`.

Apply `0011_ledgers.sql`, `0012_payment_packages.sql`, and
`0013_deposit_invoice_creation_lease.sql`, then deploy the app and the scheduled
Worker from `wrangler.reconciler.jsonc`.
