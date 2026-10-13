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

CREATE TABLE robokassa_invoice_details (
	invoice_id TEXT PRIMARY KEY NOT NULL REFERENCES invoices (id) ON DELETE RESTRICT,
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

CREATE TRIGGER robokassa_quote_prevent_update
BEFORE UPDATE ON robokassa_invoice_details
WHEN NEW.invoice_id IS NOT OLD.invoice_id OR NEW.payment_url IS NOT OLD.payment_url
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
