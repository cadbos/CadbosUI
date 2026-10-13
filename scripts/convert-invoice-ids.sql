/*
 * Copyright (c) 2026 Cadbos company. All rights reserved.
 *
 * SPDX-License-Identifier: LicenseRef-Cadbos-BSL-1.1
 *
 * Cadbos Interior Design AI is licensed under the Business Source License 1.1.
 * Access is limited to automated analysis tools for analysis of this repository.
 * This code is not open for contribution or usage except under a separate
 * written agreement with Cadbos company.
 *
 * Commercial use in Interior Design & AEC Generative AI Services is prohibited
 * before the Change Date. See LICENSE for complete terms.
 */

PRAGMA defer_foreign_keys = ON;

CREATE TABLE _invoice_uuid_ids (old_id TEXT PRIMARY KEY NOT NULL, new_id TEXT UNIQUE NOT NULL);
INSERT INTO _invoice_uuid_ids
WITH ids AS MATERIALIZED (SELECT id, lower(hex(randomblob(16))) AS random_hex FROM invoices)
SELECT id, CASE WHEN lower(id) IN ('00000000-0000-0000-0000-000000000000', 'ffffffff-ffff-ffff-ffff-ffffffffffff')
	OR (length(id) = 36 AND substr(id, 9, 1) = '-' AND substr(id, 14, 1) = '-'
		AND substr(id, 19, 1) = '-' AND substr(id, 24, 1) = '-'
		AND length(replace(id, '-', '')) = 32
		AND lower(replace(id, '-', '')) NOT GLOB '*[^0-9a-f]*'
		AND substr(id, 15, 1) GLOB '[1-8]' AND lower(substr(id, 20, 1)) GLOB '[89ab]')
	THEN id ELSE substr(random_hex, 1, 8) || '-' || substr(random_hex, 9, 4) || '-4' || substr(random_hex, 14, 3)
		|| '-' || substr('89ab', (random() & 3) + 1, 1) || substr(random_hex, 18, 3) || '-' || substr(random_hex, 21, 12)
	END FROM ids;

CREATE TABLE _invoice_conversion_guard (valid INTEGER NOT NULL CHECK (valid = 1));
INSERT INTO _invoice_conversion_guard
SELECT CASE WHEN EXISTS (
	SELECT 1 FROM robokassa_invoice_details
	WHERE invoice_id GLOB '*[^0-9]*' OR substr(invoice_id, 1, 1) = '0' OR length(invoice_id) = 0
		OR CAST(invoice_id AS INTEGER) < 1 OR CAST(invoice_id AS INTEGER) > 9007199254740991
) THEN 0 ELSE 1 END;

DROP TRIGGER robokassa_quote_prevent_update;
DROP TRIGGER invoices_prevent_quoted_terms_update;
ALTER TABLE robokassa_invoice_details RENAME TO _robokassa_invoice_details;
DROP TRIGGER invoices_prevent_paid_update;
UPDATE invoices SET id = (SELECT new_id FROM _invoice_uuid_ids WHERE old_id = invoices.id);
CREATE TRIGGER invoices_prevent_paid_update
BEFORE UPDATE ON invoices
WHEN OLD.status = 'paid' AND (
	NEW.id IS NOT OLD.id
	OR NEW.payment_processor IS NOT OLD.payment_processor
	OR NEW.user_id IS NOT OLD.user_id
	OR NEW.amount_minor IS NOT OLD.amount_minor
	OR NEW.currency IS NOT OLD.currency
	OR NEW.status IS NOT OLD.status
	OR NEW.created_at IS NOT OLD.created_at
	OR NEW.paid_at IS NOT OLD.paid_at
	OR NEW.ledger_entry_id IS NOT OLD.ledger_entry_id
)
BEGIN
	SELECT RAISE(ABORT, 'paid invoices are immutable');
END;

CREATE TABLE robokassa_invoice_details (
	invoice_id TEXT PRIMARY KEY NOT NULL REFERENCES invoices (id) ON DELETE RESTRICT,
	inv_id INTEGER NOT NULL UNIQUE CHECK (typeof(inv_id) = 'integer' AND inv_id > 0 AND inv_id <= 9007199254740991),
	payment_url TEXT NOT NULL CHECK (length(trim(payment_url)) > 0),
	rub_amount_minor INTEGER NOT NULL CHECK (typeof(rub_amount_minor) = 'integer' AND rub_amount_minor > 0 AND rub_amount_minor <= 9007199254740991),
	rub_per_usd TEXT NOT NULL CHECK (
		typeof(rub_per_usd) = 'text' AND length(rub_per_usd) > 0
		AND rub_per_usd NOT GLOB '*[^0-9.]*'
		AND length(rub_per_usd) - length(replace(rub_per_usd, '.', '')) <= 1
		AND substr(rub_per_usd, 1, 1) <> '.' AND substr(rub_per_usd, -1) <> '.'
		AND (substr(rub_per_usd, 1, 1) <> '0' OR substr(rub_per_usd, 1, 2) = '0.')
		AND (instr(rub_per_usd, '.') = 0 OR substr(rub_per_usd, -1) <> '0')
		AND CAST(rub_per_usd AS REAL) > 0
	),
	rate_as_of INTEGER NOT NULL CHECK (typeof(rate_as_of) = 'integer'),
	is_test INTEGER NOT NULL CHECK (typeof(is_test) = 'integer' AND is_test IN (0, 1)),
	hash_algorithm TEXT NOT NULL CHECK (hash_algorithm IN ('md5', 'sha256', 'sha512')),
	result_out_sum TEXT,
	result_fee TEXT,
	payer_email TEXT,
	payment_method TEXT,
	inc_curr_label TEXT
);

INSERT INTO robokassa_invoice_details (invoice_id, inv_id, payment_url, rub_amount_minor, rub_per_usd,
	rate_as_of, is_test, hash_algorithm, result_out_sum, result_fee, payer_email, payment_method, inc_curr_label)
SELECT m.new_id, CAST(d.invoice_id AS INTEGER), d.payment_url, d.rub_amount_minor, d.rub_per_usd,
	d.rate_as_of, d.is_test, d.hash_algorithm, d.result_out_sum, d.result_fee, d.payer_email, d.payment_method, d.inc_curr_label
FROM _robokassa_invoice_details d JOIN _invoice_uuid_ids m ON m.old_id = d.invoice_id;

INSERT INTO _invoice_conversion_guard
SELECT CASE WHEN (SELECT COUNT(*) FROM robokassa_invoice_details) = (SELECT COUNT(*) FROM _robokassa_invoice_details) THEN 1 ELSE 0 END;

DROP TABLE _robokassa_invoice_details;
INSERT INTO _invoice_conversion_guard
SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM pragma_foreign_key_check) THEN 1 ELSE 0 END;
DROP TABLE _invoice_uuid_ids;
DROP TABLE _invoice_conversion_guard;

CREATE TRIGGER robokassa_quote_prevent_update
BEFORE UPDATE ON robokassa_invoice_details
WHEN NEW.invoice_id IS NOT OLD.invoice_id OR NEW.inv_id IS NOT OLD.inv_id OR NEW.payment_url IS NOT OLD.payment_url
	OR NEW.rub_amount_minor IS NOT OLD.rub_amount_minor OR NEW.rub_per_usd IS NOT OLD.rub_per_usd
	OR NEW.rate_as_of IS NOT OLD.rate_as_of OR NEW.is_test IS NOT OLD.is_test
	OR NEW.hash_algorithm IS NOT OLD.hash_algorithm
BEGIN
	SELECT RAISE(ABORT, 'Robokassa quotes are immutable');
END;

CREATE TRIGGER invoices_prevent_quoted_terms_update
BEFORE UPDATE ON invoices
WHEN EXISTS (SELECT 1 FROM robokassa_invoice_details WHERE invoice_id = OLD.id)
	AND (NEW.id IS NOT OLD.id OR NEW.payment_processor IS NOT OLD.payment_processor
		OR NEW.user_id IS NOT OLD.user_id OR NEW.amount_minor IS NOT OLD.amount_minor
		OR NEW.currency IS NOT OLD.currency)
BEGIN
	SELECT RAISE(ABORT, 'quoted invoice terms are immutable');
END;

PRAGMA defer_foreign_keys = OFF;
