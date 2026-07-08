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

-- Paid operations are no longer always image-generating operations: auto-prompt
-- charges credits but returns text. Keep image history in `generations`, and use
-- this ledger for every paid credit deduction.
CREATE TABLE credit_transactions (
	id TEXT PRIMARY KEY,
	user_id TEXT NOT NULL REFERENCES users (id),
	amount REAL NOT NULL,
	balance_after REAL NOT NULL,
	kind TEXT NOT NULL,
	created_at INTEGER NOT NULL
);

INSERT INTO credit_transactions (id, user_id, amount, balance_after, kind, created_at)
SELECT id, user_id, amount, balance_after, kind, created_at FROM generations;

CREATE INDEX credit_transactions_user_id_created_at
	ON credit_transactions (user_id, created_at DESC);
