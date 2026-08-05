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
	kind TEXT NOT NULL CHECK (kind IN ('user_balance', 'asset_balance', 'system_control')),
	user_id TEXT REFERENCES users (id),
	created_at INTEGER NOT NULL CHECK (created_at > 0),
	CHECK (
		(asset = 'app_credit' AND kind = 'user_balance' AND user_id IS NOT NULL)
		OR (asset = 'app_credit' AND kind = 'system_control' AND user_id IS NULL)
		OR (asset = 'archai_token' AND kind IN ('asset_balance', 'system_control') AND user_id IS NULL)
	)
);

CREATE UNIQUE INDEX ledger_accounts_user_asset
	ON ledger_accounts (user_id, asset)
	WHERE user_id IS NOT NULL;

CREATE UNIQUE INDEX ledger_accounts_system_asset_kind
	ON ledger_accounts (asset, kind)
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
	usd_amount_cents INTEGER NOT NULL CHECK (typeof(usd_amount_cents) = 'integer' AND usd_amount_cents > 0),
	credits_awarded_units INTEGER NOT NULL CHECK (typeof(credits_awarded_units) = 'integer' AND credits_awarded_units > 0),
	archai_tokens_awarded_units INTEGER NOT NULL CHECK (typeof(archai_tokens_awarded_units) = 'integer' AND archai_tokens_awarded_units > 0),
	enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
	created_at INTEGER NOT NULL CHECK (created_at > 0)
);

CREATE TABLE exchange_rate_cache (
	currency TEXT PRIMARY KEY CHECK (currency = 'USD'),
	usd_per_btc REAL NOT NULL CHECK (usd_per_btc > 0),
	fetched_at INTEGER NOT NULL CHECK (fetched_at > 0),
	expires_at INTEGER NOT NULL CHECK (expires_at > fetched_at)
);

CREATE TABLE deposits (
	id TEXT PRIMARY KEY CHECK (
		length(id) = 36
		AND substr(id, 9, 1) = '-'
		AND substr(id, 14, 1) = '-'
		AND substr(id, 19, 1) = '-'
		AND substr(id, 24, 1) = '-'
		AND id NOT GLOB '*[^0-9a-f-]*'
	),
	request_id TEXT NOT NULL CHECK (
		length(request_id) = 36
		AND substr(request_id, 9, 1) = '-'
		AND substr(request_id, 14, 1) = '-'
		AND substr(request_id, 19, 1) = '-'
		AND substr(request_id, 24, 1) = '-'
		AND request_id NOT GLOB '*[^0-9a-f-]*'
	),
	user_id TEXT NOT NULL REFERENCES users (id),
	package_id TEXT NOT NULL REFERENCES packages (id),
	provider TEXT NOT NULL CHECK (provider = 'lnbits'),
	provider_checking_id TEXT UNIQUE,
	payment_hash TEXT UNIQUE,
	bolt11 TEXT,
	sats_amount INTEGER CHECK (sats_amount IS NULL OR (typeof(sats_amount) = 'integer' AND sats_amount > 0)),
	usd_amount_cents INTEGER NOT NULL CHECK (typeof(usd_amount_cents) = 'integer' AND usd_amount_cents > 0),
	sats_per_usd_rate REAL CHECK (sats_per_usd_rate IS NULL OR sats_per_usd_rate > 0),
	credits_awarded_units INTEGER NOT NULL CHECK (typeof(credits_awarded_units) = 'integer' AND credits_awarded_units > 0),
	archai_tokens_awarded_units INTEGER NOT NULL CHECK (typeof(archai_tokens_awarded_units) = 'integer' AND archai_tokens_awarded_units > 0),
	status TEXT NOT NULL CHECK (status IN ('creating', 'pending', 'paid', 'expired', 'failed')),
	created_at INTEGER NOT NULL CHECK (created_at > 0),
	expires_at INTEGER,
	paid_at INTEGER,
	provider_checked_at INTEGER,
	reconcile_after INTEGER,
	ledger_transaction_id TEXT UNIQUE REFERENCES ledger_transactions (id),
	UNIQUE (user_id, request_id),
	CHECK (
		(status IN ('creating', 'failed') AND provider_checking_id IS NULL AND payment_hash IS NULL AND bolt11 IS NULL AND expires_at IS NULL
			AND ((sats_amount IS NULL AND sats_per_usd_rate IS NULL) OR (sats_amount IS NOT NULL AND sats_per_usd_rate IS NOT NULL)))
		OR
		(status IN ('pending', 'paid', 'expired', 'failed') AND provider_checking_id IS NOT NULL AND payment_hash IS NOT NULL AND bolt11 IS NOT NULL AND sats_amount IS NOT NULL AND sats_per_usd_rate IS NOT NULL AND expires_at IS NOT NULL)
	),
	CHECK (
		(status = 'paid' AND paid_at IS NOT NULL AND ledger_transaction_id IS NOT NULL AND reconcile_after IS NULL)
		OR
		(status <> 'paid' AND paid_at IS NULL AND ledger_transaction_id IS NULL)
	)
);

CREATE INDEX deposits_user_created_at ON deposits (user_id, created_at DESC);
CREATE INDEX deposits_reconcile_after
	ON deposits (reconcile_after, created_at)
	WHERE reconcile_after IS NOT NULL;

CREATE TABLE payment_events (
	id TEXT PRIMARY KEY CHECK (
		length(id) = 36
		AND substr(id, 9, 1) = '-'
		AND substr(id, 14, 1) = '-'
		AND substr(id, 19, 1) = '-'
		AND substr(id, 24, 1) = '-'
		AND id NOT GLOB '*[^0-9a-f-]*'
	),
	deposit_id TEXT NOT NULL REFERENCES deposits (id),
	type TEXT NOT NULL CHECK (type IN (
		'attempt_created',
		'rate_locked',
		'invoice_created',
		'provider_pending',
		'provider_paid',
		'provider_expired',
		'provider_failed',
		'provider_error',
		'ledger_posted'
	)),
	deduplication_key TEXT,
	data TEXT NOT NULL CHECK (json_valid(data)),
	occurred_at INTEGER NOT NULL CHECK (occurred_at > 0),
	UNIQUE (deposit_id, deduplication_key)
);

CREATE INDEX payment_events_deposit_occurred_at
	ON payment_events (deposit_id, occurred_at, id);

CREATE TABLE generation_operations (
	id TEXT PRIMARY KEY CHECK (
		length(id) = 36
		AND substr(id, 9, 1) = '-'
		AND substr(id, 14, 1) = '-'
		AND substr(id, 19, 1) = '-'
		AND substr(id, 24, 1) = '-'
		AND id NOT GLOB '*[^0-9a-f-]*'
	),
	user_id TEXT NOT NULL REFERENCES users (id),
	input_url TEXT NOT NULL CHECK (input_url LIKE 'http://%' OR input_url LIKE 'https://%'),
	prompt TEXT NOT NULL,
	kind TEXT NOT NULL CHECK (length(kind) > 0),
	cost_units INTEGER CHECK (cost_units IS NULL OR (typeof(cost_units) = 'integer' AND cost_units >= 0)),
	output_url TEXT CHECK (output_url IS NULL OR output_url LIKE 'http://%' OR output_url LIKE 'https://%'),
	balance_after_units INTEGER CHECK (balance_after_units IS NULL OR typeof(balance_after_units) = 'integer'),
	status TEXT NOT NULL CHECK (status IN ('pending', 'confirmed', 'completed', 'failed')),
	created_at INTEGER NOT NULL CHECK (created_at > 0),
	confirmed_at INTEGER,
	completed_at INTEGER,
	failed_at INTEGER,
	CHECK (
		(status = 'pending' AND cost_units IS NULL AND output_url IS NULL AND balance_after_units IS NULL AND confirmed_at IS NULL AND completed_at IS NULL AND failed_at IS NULL)
		OR
		(status = 'confirmed' AND cost_units IS NOT NULL AND output_url IS NOT NULL AND balance_after_units IS NULL AND confirmed_at IS NOT NULL AND completed_at IS NULL AND failed_at IS NULL)
		OR
		(status = 'completed' AND cost_units IS NOT NULL AND output_url IS NOT NULL AND balance_after_units IS NOT NULL AND confirmed_at IS NOT NULL AND completed_at IS NOT NULL AND failed_at IS NULL)
		OR
		(status = 'failed' AND cost_units IS NULL AND output_url IS NULL AND balance_after_units IS NULL AND confirmed_at IS NULL AND completed_at IS NULL AND failed_at IS NOT NULL)
	)
);

CREATE INDEX generation_operations_user_status
	ON generation_operations (user_id, status, created_at);

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

INSERT INTO ledger_accounts (id, asset, kind, user_id, created_at)
SELECT 'app-credit:' || credit.user_id, 'app_credit', 'user_balance', credit.user_id, users.created_at
FROM credits_before_ledgers AS credit
JOIN users ON users.id = credit.user_id;

INSERT INTO ledger_accounts (id, asset, kind, user_id, created_at)
VALUES
	('app-credit:system', 'app_credit', 'system_control', NULL, COALESCE((SELECT MIN(created_at) FROM users), unixepoch() * 1000)),
	('archai-token', 'archai_token', 'asset_balance', NULL, COALESCE((SELECT MIN(created_at) FROM users), unixepoch() * 1000)),
	('archai-token:system', 'archai_token', 'system_control', NULL, COALESCE((SELECT MIN(created_at) FROM users), unixepoch() * 1000));

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
	WHERE account.kind = 'user_balance'
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
	WHERE account.kind = 'user_balance'
	GROUP BY account.id, credit.balance
)
INSERT INTO ledger_entries (transaction_id, account_id, amount)
SELECT 'opening:' || account_id, account_id, amount
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
	WHERE account.kind = 'user_balance'
	GROUP BY account.id, credit.balance
)
INSERT INTO ledger_entries (transaction_id, account_id, amount)
SELECT 'opening:' || account_id, 'app-credit:system', -amount
FROM credit_openings
WHERE amount <> 0;

INSERT INTO ledger_openings (account_id, transaction_id)
SELECT account.id, 'opening:' || account.id
FROM ledger_accounts AS account
JOIN ledger_transactions AS ledger_transaction ON ledger_transaction.id = 'opening:' || account.id
WHERE account.kind = 'user_balance';

WITH archai_opening AS (
	SELECT
		COALESCE((
			SELECT CAST(ROUND(balance * 100) AS INTEGER)
			FROM balances_before_ledgers
			ORDER BY updated_at DESC, user_id DESC
			LIMIT 1
		), 0) + COALESCE((
			SELECT SUM(CAST(ROUND(amount * 100) AS INTEGER)) FROM generations_before_ledgers
		), 0) AS amount,
		CASE
			WHEN (SELECT MIN(created_at) FROM generations_before_ledgers) > 1
				THEN (SELECT MIN(created_at) - 1 FROM generations_before_ledgers)
			ELSE COALESCE((
				SELECT updated_at FROM balances_before_ledgers
				ORDER BY updated_at DESC, user_id DESC LIMIT 1
			), unixepoch() * 1000)
		END AS occurred_at
)
INSERT INTO ledger_transactions (id, occurred_at)
SELECT 'opening:archai-token', occurred_at
FROM archai_opening
WHERE amount <> 0;

WITH archai_opening AS (
	SELECT COALESCE((
		SELECT CAST(ROUND(balance * 100) AS INTEGER)
		FROM balances_before_ledgers
		ORDER BY updated_at DESC, user_id DESC LIMIT 1
	), 0) + COALESCE((
		SELECT SUM(CAST(ROUND(amount * 100) AS INTEGER)) FROM generations_before_ledgers
	), 0) AS amount
)
INSERT INTO ledger_entries (transaction_id, account_id, amount)
SELECT 'opening:archai-token', 'archai-token', amount
FROM archai_opening
WHERE amount <> 0;

WITH archai_opening AS (
	SELECT COALESCE((
		SELECT CAST(ROUND(balance * 100) AS INTEGER)
		FROM balances_before_ledgers
		ORDER BY updated_at DESC, user_id DESC LIMIT 1
	), 0) + COALESCE((
		SELECT SUM(CAST(ROUND(amount * 100) AS INTEGER)) FROM generations_before_ledgers
	), 0) AS amount
)
INSERT INTO ledger_entries (transaction_id, account_id, amount)
SELECT 'opening:archai-token', 'archai-token:system', -amount
FROM archai_opening
WHERE amount <> 0;

INSERT INTO ledger_openings (account_id, transaction_id)
SELECT 'archai-token', 'opening:archai-token'
WHERE EXISTS (SELECT 1 FROM ledger_transactions WHERE id = 'opening:archai-token');

INSERT INTO ledger_entries (transaction_id, account_id, amount)
SELECT 'generation:' || generation.id, account.id, -CAST(ROUND(generation.amount * 100) AS INTEGER)
FROM generations_before_ledgers AS generation
JOIN ledger_accounts AS account ON account.user_id = generation.user_id AND account.kind = 'user_balance'
WHERE generation.amount <> 0;

INSERT INTO ledger_entries (transaction_id, account_id, amount)
SELECT 'generation:' || id, 'app-credit:system', CAST(ROUND(amount * 100) AS INTEGER)
FROM generations_before_ledgers
WHERE amount <> 0 AND EXISTS (
	SELECT 1 FROM ledger_accounts WHERE user_id = generations_before_ledgers.user_id AND kind = 'user_balance'
);

INSERT INTO ledger_entries (transaction_id, account_id, amount)
SELECT 'generation:' || id, 'archai-token', -CAST(ROUND(amount * 100) AS INTEGER)
FROM generations_before_ledgers
WHERE amount <> 0;

INSERT INTO ledger_entries (transaction_id, account_id, amount)
SELECT 'generation:' || id, 'archai-token:system', CAST(ROUND(amount * 100) AS INTEGER)
FROM generations_before_ledgers
WHERE amount <> 0;

UPDATE ledger_transactions SET finalized = 1;

CREATE VIEW ledger_account_balances AS
SELECT
	account.id AS account_id,
	account.asset,
	account.kind,
	account.user_id,
	COALESCE(SUM(entry.amount), 0) AS balance,
	COALESCE(MAX(ledger_transaction.occurred_at), account.created_at) AS updated_at
FROM ledger_accounts AS account
LEFT JOIN ledger_entries AS entry ON entry.account_id = account.id
LEFT JOIN ledger_transactions AS ledger_transaction ON ledger_transaction.id = entry.transaction_id
GROUP BY account.id, account.asset, account.kind, account.user_id, account.created_at;

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

CREATE TRIGGER ledger_transactions_enforce_balance
BEFORE UPDATE OF finalized ON ledger_transactions
WHEN NEW.finalized = 1 AND EXISTS (
	SELECT account.asset
	FROM ledger_entries AS entry
	JOIN ledger_accounts AS account ON account.id = entry.account_id
	WHERE entry.transaction_id = NEW.id
	GROUP BY account.asset
	HAVING SUM(entry.amount) <> 0 OR COUNT(*) < 2
)
BEGIN
	SELECT RAISE(ABORT, 'ledger transaction is not balanced');
END;

CREATE TRIGGER ledger_transactions_prevent_update
BEFORE UPDATE ON ledger_transactions
WHEN OLD.finalized IS NOT 0 OR NEW.finalized IS NOT 1 OR OLD.id IS NOT NEW.id OR OLD.occurred_at IS NOT NEW.occurred_at
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
WHEN (SELECT finalized FROM ledger_transactions WHERE id = NEW.transaction_id) = 1
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

CREATE TRIGGER payment_events_prevent_update
BEFORE UPDATE ON payment_events
BEGIN
	SELECT RAISE(ABORT, 'payment events are immutable');
END;

CREATE TRIGGER payment_events_prevent_delete
BEFORE DELETE ON payment_events
BEGIN
	SELECT RAISE(ABORT, 'payment events are immutable');
END;

CREATE TRIGGER deposits_enforce_transition
BEFORE UPDATE ON deposits
WHEN NOT (
	OLD.id IS NEW.id
	AND OLD.request_id IS NEW.request_id
	AND OLD.user_id IS NEW.user_id
	AND OLD.package_id IS NEW.package_id
	AND OLD.provider IS NEW.provider
	AND OLD.usd_amount_cents IS NEW.usd_amount_cents
	AND OLD.credits_awarded_units IS NEW.credits_awarded_units
	AND OLD.archai_tokens_awarded_units IS NEW.archai_tokens_awarded_units
	AND OLD.created_at IS NEW.created_at
	AND (
		(OLD.status = 'creating' AND NEW.status IN ('creating', 'pending', 'failed'))
		OR (OLD.status = 'pending' AND NEW.status IN ('pending', 'paid', 'expired', 'failed'))
		OR (OLD.status IN ('expired', 'failed') AND NEW.status IN (OLD.status, 'paid'))
		OR (OLD.status = 'paid' AND NEW.status = 'paid')
	)
)
BEGIN
	SELECT RAISE(ABORT, 'invalid deposit transition');
END;

CREATE TRIGGER paid_deposits_prevent_update
BEFORE UPDATE ON deposits
WHEN OLD.status = 'paid'
BEGIN
	SELECT RAISE(ABORT, 'paid deposits are immutable');
END;

CREATE TRIGGER deposits_prevent_delete
BEFORE DELETE ON deposits
BEGIN
	SELECT RAISE(ABORT, 'deposits are immutable');
END;

CREATE TRIGGER generation_operations_enforce_transition
BEFORE UPDATE ON generation_operations
WHEN NOT (
	(OLD.status = 'pending' AND NEW.status IN ('confirmed', 'failed') AND OLD.id IS NEW.id AND OLD.user_id IS NEW.user_id AND OLD.input_url IS NEW.input_url AND OLD.prompt IS NEW.prompt AND OLD.kind IS NEW.kind AND OLD.created_at IS NEW.created_at)
	OR
	(OLD.status = 'confirmed' AND NEW.status = 'completed' AND OLD.id IS NEW.id AND OLD.user_id IS NEW.user_id AND OLD.input_url IS NEW.input_url AND OLD.prompt IS NEW.prompt AND OLD.kind IS NEW.kind AND OLD.cost_units IS NEW.cost_units AND OLD.output_url IS NEW.output_url AND OLD.created_at IS NEW.created_at AND OLD.confirmed_at IS NEW.confirmed_at)
)
BEGIN
	SELECT RAISE(ABORT, 'invalid generation operation transition');
END;

CREATE TRIGGER generation_operations_prevent_delete
BEFORE DELETE ON generation_operations
BEGIN
	SELECT RAISE(ABORT, 'generation operations are immutable');
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
