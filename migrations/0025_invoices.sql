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

CREATE TABLE invoices (
	id TEXT PRIMARY KEY NOT NULL,
	payment_processor TEXT NOT NULL CHECK (typeof(payment_processor) = 'text' AND length(trim(payment_processor)) > 0),
	user_id TEXT NOT NULL REFERENCES users (id),
	ledger_entry_id INTEGER UNIQUE REFERENCES ledger_entries (id),
	amount_minor INTEGER NOT NULL CHECK (typeof(amount_minor) = 'integer' AND amount_minor > 0 AND amount_minor <= 9007199254740991),
	currency TEXT NOT NULL CHECK (currency = 'USD'),
	status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'paid', 'cancelled')),
	created_at INTEGER NOT NULL CHECK (typeof(created_at) = 'integer'),
	updated_at INTEGER NOT NULL CHECK (typeof(updated_at) = 'integer'),
	paid_at INTEGER CHECK (paid_at IS NULL OR typeof(paid_at) = 'integer'),
	CHECK (updated_at >= created_at),
	CHECK ((status = 'paid') = (paid_at IS NOT NULL)),
	CHECK ((status = 'paid') = (ledger_entry_id IS NOT NULL))
);

CREATE TRIGGER invoices_ledger_entry_valid_insert
BEFORE INSERT ON invoices
WHEN NEW.ledger_entry_id IS NOT NULL
BEGIN
	SELECT RAISE(ABORT, 'invoice credit does not match') WHERE NOT EXISTS (
		SELECT 1 FROM ledger_entries l WHERE l.id = NEW.ledger_entry_id
			AND l.user_id = NEW.user_id AND l.entry_side = 'credit'
			AND l.reason = 'top-up' AND l.amount = NEW.amount_minor
	);
END;

CREATE TRIGGER invoices_ledger_entry_valid_update
BEFORE UPDATE OF user_id, amount_minor, ledger_entry_id ON invoices
WHEN NEW.ledger_entry_id IS NOT NULL
BEGIN
	SELECT RAISE(ABORT, 'invoice credit does not match') WHERE NOT EXISTS (
		SELECT 1 FROM ledger_entries l WHERE l.id = NEW.ledger_entry_id
			AND l.user_id = NEW.user_id AND l.entry_side = 'credit'
			AND l.reason = 'top-up' AND l.amount = NEW.amount_minor
	);
END;

CREATE TRIGGER invoices_prevent_paid_update
BEFORE UPDATE ON invoices
WHEN OLD.status = 'paid' AND (
	NEW.id IS NOT OLD.id
	OR NEW.payment_processor IS NOT OLD.payment_processor
	OR NEW.user_id IS NOT OLD.user_id
	OR NEW.amount_minor IS NOT OLD.amount_minor
	OR NEW.currency IS NOT OLD.currency
	OR NEW.status IS NOT OLD.status
	OR NEW.paid_at IS NOT OLD.paid_at
	OR NEW.ledger_entry_id IS NOT OLD.ledger_entry_id
)
BEGIN
	SELECT RAISE(ABORT, 'paid invoices are immutable');
END;
