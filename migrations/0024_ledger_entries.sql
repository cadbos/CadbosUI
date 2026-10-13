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

CREATE TABLE ledger_entries (
	id INTEGER PRIMARY KEY NOT NULL,
	user_id TEXT NOT NULL REFERENCES users (id),
	amount INTEGER NOT NULL CHECK (typeof(amount) = 'integer' AND amount >= 0 AND amount <= 9007199254740991),
	entry_side TEXT NOT NULL CHECK (entry_side IN ('debit', 'credit')),
	reason TEXT,
	created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000) CHECK (typeof(created_at) = 'integer' AND created_at > 0)
);

CREATE INDEX ledger_entries_user_created_at ON ledger_entries (user_id, created_at DESC, id DESC);

CREATE TRIGGER ledger_entries_prevent_update
BEFORE UPDATE ON ledger_entries
BEGIN
	SELECT RAISE(ABORT, 'ledger entries are immutable');
END;

CREATE TRIGGER ledger_entries_prevent_delete
BEFORE DELETE ON ledger_entries
BEGIN
	SELECT RAISE(ABORT, 'ledger entries are immutable');
END;
