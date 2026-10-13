# Invoice UUID conversion for payment test data

This procedure preserves transactions created during payment testing,
before the invoice ID design was finalized. Production databases use
the schema defined by the committed migrations. This conversion applies only to
the test dataset.

## Test data conversion

Use [the operational conversion SQL](../../scripts/convert-invoice-ids.sql) once
to bring the test data into the finalized schema.

The operational SQL preserves issued payment URLs, frozen quotes, callback data,
invoice status and timestamps, every ledger entry and ledger link, and existing
valid UUIDs. Numeric Cadbos IDs become UUIDv4 IDs; their original numeric values
remain available as `inv_id` on quoted Robokassa invoices. Unquoted invoices have
no provider ID until checkout. Existing signed URLs and callbacks keep their
original numeric IDs.

## Updating the test database

1. Build and test the application before updating the test database. Coordinate the
   conversion with deployment of the application that uses separate invoice and
   provider IDs.
2. Pause invoice creation, checkout, cancellation, invoice reads, and the Robokassa
   callback endpoint at the deployment's traffic control layer. Return retryable
   failures to callbacks; never acknowledge a notification that was not settled.
   Drain in-flight payment requests. Keep generation/accounting writes paused
   while recording and comparing ledger totals.
3. Record the current application version and a D1 Time Travel recovery point.
   Export a protected database backup using Wrangler. Do not commit backups or
   payment URLs to the repository.
4. Record the following reconciliation results before conversion. Also retain a
   protected snapshot of invoices, provider details and ledger entries from the
   backup for field-level comparison.

   ```sql
   SELECT status, COUNT(*) AS invoices, SUM(amount_minor) AS usd_cents
   FROM invoices GROUP BY status;
   SELECT COUNT(*) AS quotes, SUM(rub_amount_minor) AS rub_kopecks,
     SUM(result_out_sum IS NOT NULL) AS settled_notifications
   FROM robokassa_invoice_details;
   SELECT user_id, COUNT(*) AS entries,
     SUM(CASE WHEN entry_side = 'credit' THEN amount ELSE -amount END) AS balance_cents
   FROM ledger_entries GROUP BY user_id;
   PRAGMA foreign_key_check;
   ```

5. Execute the complete SQL file in one Wrangler invocation. D1 executes the file
   transactionally and restores the original database if the import fails. The
   file defers foreign-key checks while updating the references, rejects invalid
   or conflicting provider IDs, and checks foreign keys before completion.

   ```sh
   pnpm wrangler d1 execute --remote "<database-name>" --file scripts/convert-invoice-ids.sql
   ```

   Replace `<database-name>` with the target test database's name or D1 binding.

6. Deploy the matching application while payment traffic remains paused. Verify
   reconciliation results and field-level preservation against the protected
   backup. The details row's new `inv_id` must equal its original `invoice_id`;
   its new `invoice_id` must reference the matching UUID invoice. Check that
   conversion tables are gone and accounting/quote immutability triggers remain.
7. Verify authenticated invoice access using UUIDs, rejection of numeric API IDs,
   reuse of stored checkout URLs, and settlement/replay of a controlled test
   callback. Verify exactly one linked credit, full USD credit, numeric
   `OK{InvId}`, and unchanged approval. Resume payment and generation traffic,
   then monitor sanitized callback and invoice API errors.

If conversion or deployment verification fails, keep payment traffic paused.
A rollback must restore the database and application versions together using the
recorded recovery point. Reconcile any subsequent ledger activity before a
restore; do not discard new financial history.

## Verifying the test data conversion

The conversion tests use a fixture matching the schema used during payment
testing. They cover paid/open/cancelled and unquoted invoices, conversion
rollback, field preservation, and immutable accounting. Payment tests exercise
UUID-to-provider-ID resolution and replay protection without contacting real
providers.

Use that fixture in an isolated local database for Wrangler conversion checks.

References: [D1 foreign keys](https://developers.cloudflare.com/d1/sql-api/foreign-keys/),
[D1 import transactions](https://developers.cloudflare.com/d1/best-practices/import-export-data/),
[D1 recovery](https://developers.cloudflare.com/d1/reference/time-travel/).
