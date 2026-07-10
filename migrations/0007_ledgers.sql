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

ALTER TABLE credits RENAME TO credits_before_ledgers;
ALTER TABLE balances RENAME TO balances_before_ledgers;
ALTER TABLE generations RENAME TO generations_before_ledgers;

DROP INDEX generations_user_created_at;

CREATE TABLE generation_access (
	user_id TEXT PRIMARY KEY REFERENCES users (id),
	enabled INTEGER NOT NULL CHECK (enabled IN (0, 1))
);

CREATE TABLE ledger_accounts (
	id TEXT PRIMARY KEY,
	asset TEXT NOT NULL CHECK (asset IN ('app_credit', 'archai_token')),
	user_id TEXT REFERENCES users (id),
	created_at INTEGER NOT NULL CHECK (created_at > 0),
	CHECK (
		(asset = 'app_credit' AND user_id IS NOT NULL)
		OR (asset = 'archai_token' AND user_id IS NULL)
	)
);

CREATE UNIQUE INDEX ledger_accounts_user_asset
	ON ledger_accounts (user_id, asset)
	WHERE user_id IS NOT NULL;

CREATE UNIQUE INDEX ledger_accounts_global_asset
	ON ledger_accounts (asset)
	WHERE user_id IS NULL;

CREATE TABLE ledger_transactions (
	id TEXT PRIMARY KEY,
	occurred_at INTEGER NOT NULL CHECK (occurred_at > 0),
	finalized INTEGER NOT NULL DEFAULT 0 CHECK (finalized IN (0, 1))
);

CREATE INDEX ledger_transactions_occurred_at ON ledger_transactions (occurred_at DESC);

CREATE TABLE ledger_entries (
	transaction_id TEXT NOT NULL REFERENCES ledger_transactions (id),
	account_id TEXT NOT NULL REFERENCES ledger_accounts (id),
	amount INTEGER NOT NULL CHECK (typeof(amount) = 'integer' AND amount <> 0),
	PRIMARY KEY (transaction_id, account_id)
);

CREATE INDEX ledger_entries_account_id ON ledger_entries (account_id);

CREATE TABLE ledger_openings (
	account_id TEXT PRIMARY KEY REFERENCES ledger_accounts (id),
	transaction_id TEXT NOT NULL UNIQUE REFERENCES ledger_transactions (id)
);

CREATE TABLE packages (
	id TEXT PRIMARY KEY,
	usd_amount REAL NOT NULL CHECK (usd_amount > 0),
	credits_awarded REAL NOT NULL CHECK (credits_awarded > 0),
	archai_tokens_awarded REAL NOT NULL CHECK (archai_tokens_awarded > 0),
	enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
	created_at INTEGER NOT NULL CHECK (created_at > 0)
);

CREATE TABLE deposits (
	id TEXT PRIMARY KEY,
	user_id TEXT NOT NULL REFERENCES users (id),
	package_id TEXT NOT NULL REFERENCES packages (id),
	provider TEXT NOT NULL CHECK (length(provider) > 0),
	provider_invoice_id TEXT NOT NULL CHECK (length(provider_invoice_id) > 0),
	payment_hash TEXT NOT NULL UNIQUE CHECK (length(payment_hash) > 0),
	sats_amount INTEGER NOT NULL CHECK (sats_amount > 0),
	usd_amount REAL NOT NULL CHECK (usd_amount > 0),
	sats_per_usd_rate REAL NOT NULL CHECK (sats_per_usd_rate > 0),
	credits_awarded REAL NOT NULL CHECK (credits_awarded > 0),
	archai_tokens_awarded REAL NOT NULL CHECK (archai_tokens_awarded > 0),
	status TEXT NOT NULL DEFAULT 'pending'
		CHECK (status IN ('pending', 'paid', 'expired', 'failed')),
	created_at INTEGER NOT NULL CHECK (created_at > 0),
	expires_at INTEGER NOT NULL CHECK (expires_at > created_at),
	paid_at INTEGER,
	ledger_transaction_id TEXT UNIQUE REFERENCES ledger_transactions (id),
	UNIQUE (provider, provider_invoice_id),
	CHECK (
		(status = 'paid' AND paid_at IS NOT NULL AND ledger_transaction_id IS NOT NULL)
		OR
		(status <> 'paid' AND paid_at IS NULL AND ledger_transaction_id IS NULL)
	)
);

CREATE INDEX deposits_user_created_at ON deposits (user_id, created_at DESC);
CREATE INDEX deposits_pending ON deposits (expires_at) WHERE status = 'pending';

CREATE TABLE generations (
	id TEXT PRIMARY KEY,
	user_id TEXT NOT NULL REFERENCES users (id),
	prompt TEXT NOT NULL,
	kind TEXT NOT NULL CHECK (length(kind) > 0),
	ledger_transaction_id TEXT NOT NULL UNIQUE REFERENCES ledger_transactions (id),
	created_at INTEGER NOT NULL CHECK (created_at > 0)
);

CREATE INDEX generations_user_created_at ON generations (user_id, created_at DESC);

CREATE TABLE image_generation_details (
	generation_id TEXT PRIMARY KEY REFERENCES generations (id) ON DELETE CASCADE,
	output_url TEXT NOT NULL CHECK (output_url LIKE 'http://%' OR output_url LIKE 'https://%'),
	input_url TEXT NOT NULL CHECK (input_url LIKE 'http://%' OR input_url LIKE 'https://%')
);

INSERT INTO generation_access (user_id, enabled)
SELECT user_id, enabled
FROM credits_before_ledgers;

INSERT INTO ledger_accounts (id, asset, user_id, created_at)
SELECT 'app-credit:' || credit.user_id, 'app_credit', credit.user_id, users.created_at
FROM credits_before_ledgers AS credit
JOIN users ON users.id = credit.user_id;

INSERT INTO ledger_accounts (id, asset, user_id, created_at)
SELECT
	'archai-token',
	'archai_token',
	NULL,
	CASE
		WHEN (SELECT MIN(created_at) FROM generations_before_ledgers) > 1
			THEN (SELECT MIN(created_at) - 1 FROM generations_before_ledgers)
		ELSE COALESCE(
			(SELECT MIN(updated_at) FROM balances_before_ledgers),
			unixepoch() * 1000
		)
	END;

INSERT INTO ledger_transactions (id, occurred_at)
SELECT 'generation:' || id, created_at
FROM generations_before_ledgers;

INSERT INTO generations (id, user_id, prompt, kind, ledger_transaction_id, created_at)
SELECT id, user_id, prompt, kind, 'generation:' || id, created_at
FROM generations_before_ledgers;

INSERT INTO image_generation_details (generation_id, output_url, input_url)
SELECT id, url, source_url
FROM generations_before_ledgers;

WITH credit_openings AS (
	SELECT
		account.id AS account_id,
		COALESCE(CAST(ROUND(credit.balance * 100) AS INTEGER), 0)
			+ COALESCE(SUM(CAST(ROUND(generation.amount * 100) AS INTEGER)), 0) AS amount,
		CASE
			WHEN MIN(generation.created_at) > 1 THEN MIN(generation.created_at) - 1
			ELSE COALESCE(credit.updated_at, account.created_at)
		END AS occurred_at
	FROM ledger_accounts AS account
	LEFT JOIN credits_before_ledgers AS credit ON credit.user_id = account.user_id
	LEFT JOIN generations_before_ledgers AS generation ON generation.user_id = account.user_id
	WHERE account.asset = 'app_credit'
	GROUP BY account.id, account.created_at, credit.balance, credit.updated_at
)
INSERT INTO ledger_transactions (id, occurred_at)
SELECT 'opening:' || account_id, occurred_at
FROM credit_openings
WHERE amount <> 0;

WITH credit_openings AS (
	SELECT
		account.id AS account_id,
		COALESCE(CAST(ROUND(credit.balance * 100) AS INTEGER), 0)
			+ COALESCE(SUM(CAST(ROUND(generation.amount * 100) AS INTEGER)), 0) AS amount
	FROM ledger_accounts AS account
	LEFT JOIN credits_before_ledgers AS credit ON credit.user_id = account.user_id
	LEFT JOIN generations_before_ledgers AS generation ON generation.user_id = account.user_id
	WHERE account.asset = 'app_credit'
	GROUP BY account.id, credit.balance
)
INSERT INTO ledger_entries (transaction_id, account_id, amount)
SELECT 'opening:' || account_id, account_id, amount
FROM credit_openings
WHERE amount <> 0;

INSERT INTO ledger_openings (account_id, transaction_id)
SELECT account.id, 'opening:' || account.id
FROM ledger_accounts AS account
JOIN ledger_transactions AS ledger_transaction ON ledger_transaction.id = 'opening:' || account.id
WHERE account.asset = 'app_credit';

WITH archai_opening AS (
	SELECT
		COALESCE(
			(
				SELECT CAST(ROUND(balance * 100) AS INTEGER)
				FROM balances_before_ledgers
				ORDER BY updated_at DESC, user_id DESC
				LIMIT 1
			),
			0
		) + COALESCE(
			(SELECT SUM(CAST(ROUND(amount * 100) AS INTEGER)) FROM generations_before_ledgers),
			0
		) AS amount,
		CASE
			WHEN (SELECT MIN(created_at) FROM generations_before_ledgers) > 1
				THEN (SELECT MIN(created_at) - 1 FROM generations_before_ledgers)
			ELSE COALESCE(
				(
					SELECT updated_at
					FROM balances_before_ledgers
					ORDER BY updated_at DESC, user_id DESC
					LIMIT 1
				),
				unixepoch() * 1000
			)
		END AS occurred_at
)
INSERT INTO ledger_transactions (id, occurred_at)
SELECT 'opening:archai-token', occurred_at
FROM archai_opening
WHERE amount <> 0;

WITH archai_opening AS (
	SELECT
		COALESCE(
			(
				SELECT CAST(ROUND(balance * 100) AS INTEGER)
				FROM balances_before_ledgers
				ORDER BY updated_at DESC, user_id DESC
				LIMIT 1
			),
			0
		) + COALESCE(
			(SELECT SUM(CAST(ROUND(amount * 100) AS INTEGER)) FROM generations_before_ledgers),
			0
		) AS amount
)
INSERT INTO ledger_entries (transaction_id, account_id, amount)
SELECT 'opening:archai-token', 'archai-token', amount
FROM archai_opening
WHERE amount <> 0;

INSERT INTO ledger_openings (account_id, transaction_id)
SELECT 'archai-token', 'opening:archai-token'
WHERE EXISTS (
	SELECT 1 FROM ledger_transactions WHERE id = 'opening:archai-token'
);

INSERT INTO ledger_entries (transaction_id, account_id, amount)
SELECT 'generation:' || generation.id, account.id, -CAST(ROUND(generation.amount * 100) AS INTEGER)
FROM generations_before_ledgers AS generation
JOIN ledger_accounts AS account
	ON account.user_id = generation.user_id AND account.asset = 'app_credit'
WHERE generation.amount <> 0;

INSERT INTO ledger_entries (transaction_id, account_id, amount)
SELECT 'generation:' || id, 'archai-token', -CAST(ROUND(amount * 100) AS INTEGER)
FROM generations_before_ledgers
WHERE amount <> 0;

UPDATE ledger_transactions SET finalized = 1;

CREATE VIEW ledger_account_balances AS
SELECT
	account.id AS account_id,
	account.asset,
	account.user_id,
	COALESCE(SUM(entry.amount), 0) AS balance,
	COALESCE(MAX(ledger_transaction.occurred_at), account.created_at) AS updated_at
FROM ledger_accounts AS account
LEFT JOIN ledger_entries AS entry ON entry.account_id = account.id
LEFT JOIN ledger_transactions AS ledger_transaction
	ON ledger_transaction.id = entry.transaction_id
GROUP BY account.id, account.asset, account.user_id, account.created_at;

CREATE TRIGGER ledger_accounts_prevent_update
BEFORE UPDATE ON ledger_accounts
BEGIN
	SELECT RAISE(ABORT, 'ledger accounts are immutable');
END;

CREATE TRIGGER ledger_accounts_prevent_delete
BEFORE DELETE ON ledger_accounts
BEGIN
	SELECT RAISE(ABORT, 'ledger accounts are immutable');
END;

CREATE TRIGGER ledger_transactions_prevent_update
BEFORE UPDATE ON ledger_transactions
WHEN
	OLD.finalized IS NOT 0
	OR NEW.finalized IS NOT 1
	OR OLD.id IS NOT NEW.id
	OR OLD.occurred_at IS NOT NEW.occurred_at
BEGIN
	SELECT RAISE(ABORT, 'ledger transactions are immutable');
END;

CREATE TRIGGER ledger_transactions_prevent_delete
BEFORE DELETE ON ledger_transactions
BEGIN
	SELECT RAISE(ABORT, 'ledger transactions are immutable');
END;

CREATE TRIGGER ledger_entries_prevent_insert_after_finalization
BEFORE INSERT ON ledger_entries
WHEN (
	SELECT finalized FROM ledger_transactions WHERE id = NEW.transaction_id
) = 1
BEGIN
	SELECT RAISE(ABORT, 'ledger transaction is finalized');
END;

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

CREATE TRIGGER ledger_openings_prevent_update
BEFORE UPDATE ON ledger_openings
BEGIN
	SELECT RAISE(ABORT, 'ledger openings are immutable');
END;

CREATE TRIGGER ledger_openings_prevent_delete
BEFORE DELETE ON ledger_openings
BEGIN
	SELECT RAISE(ABORT, 'ledger openings are immutable');
END;

CREATE TRIGGER paid_deposits_prevent_update
BEFORE UPDATE ON deposits
WHEN OLD.status = 'paid'
BEGIN
	SELECT RAISE(ABORT, 'paid deposits are immutable');
END;

CREATE TRIGGER paid_deposits_prevent_delete
BEFORE DELETE ON deposits
WHEN OLD.status = 'paid'
BEGIN
	SELECT RAISE(ABORT, 'paid deposits are immutable');
END;

CREATE TRIGGER generations_prevent_delete
BEFORE DELETE ON generations
BEGIN
	SELECT RAISE(ABORT, 'financial generations are immutable');
END;

CREATE TRIGGER generations_prevent_ledger_reassignment
BEFORE UPDATE ON generations
BEGIN
	SELECT RAISE(ABORT, 'generation ledger transactions are immutable');
END;

DROP TABLE generations_before_ledgers;
DROP TABLE credits_before_ledgers;
DROP TABLE balances_before_ledgers;
