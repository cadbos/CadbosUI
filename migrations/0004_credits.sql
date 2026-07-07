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

-- Metered evaluation accounts (e.g. designer test accounts), additive to the
-- archAI balance mirror in 0002 — not a return to the old locally-enforced
-- quota. A `credits` row only ever exists for pubkeys listed in the
-- METERED_DESIGNER_PUBKEYS env var; every other account is unaffected and
-- keeps the unlimited, archAI-is-the-only-gate behavior from 0002.
CREATE TABLE credits (
	user_id TEXT PRIMARY KEY REFERENCES users (id),
	balance REAL NOT NULL,
	updated_at INTEGER NOT NULL
);

-- One row per deduction, so a designer can see their own spend history.
-- `amount` is the real cost archAI charged for that call, not a fixed fee.
CREATE TABLE credit_transactions (
	id TEXT PRIMARY KEY,
	user_id TEXT NOT NULL REFERENCES users (id),
	amount REAL NOT NULL,
	balance_after REAL NOT NULL,
	kind TEXT NOT NULL,
	created_at INTEGER NOT NULL
);

CREATE INDEX credit_transactions_user_id_created_at ON credit_transactions (user_id, created_at);
