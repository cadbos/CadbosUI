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

-- Module 2 (Nostr auth) — server storage. Schema follows Appendix B.8 of the SRS.
-- Identity is the Nostr pubkey (hex). No passwords, no private keys are ever stored.
-- Timestamps are epoch milliseconds (INTEGER), safe within Number.MAX_SAFE_INTEGER.

CREATE TABLE users (
	id TEXT PRIMARY KEY,
	pubkey TEXT NOT NULL UNIQUE,
	first_name TEXT,
	last_name TEXT,
	created_at INTEGER NOT NULL
);

CREATE TABLE sessions (
	id TEXT PRIMARY KEY,
	user_id TEXT NOT NULL REFERENCES users (id),
	created_at INTEGER NOT NULL,
	expires_at INTEGER NOT NULL,
	user_agent TEXT
);

CREATE INDEX sessions_expires_at ON sessions (expires_at);

-- Single-use login challenges. A challenge is consumed atomically on verify
-- (UPDATE ... WHERE used_at IS NULL), which blocks replay under concurrency.
CREATE TABLE auth_challenges (
	nonce TEXT PRIMARY KEY,
	pubkey TEXT NOT NULL,
	created_at INTEGER NOT NULL,
	used_at INTEGER
);

CREATE INDEX auth_challenges_created_at ON auth_challenges (created_at);

-- Account quota. Created here as forward-compatible scaffolding (P-7); the
-- charging/limit logic is owned by Module 6, not this sub-module.
CREATE TABLE quotas (
	user_id TEXT PRIMARY KEY REFERENCES users (id),
	balance_or_limit INTEGER NOT NULL,
	usage INTEGER NOT NULL,
	period TEXT NOT NULL
);

-- Fixed-window rate-limit buckets for the auth endpoints (anti-brute-force).
CREATE TABLE rate_limits (
	bucket TEXT PRIMARY KEY,
	count INTEGER NOT NULL,
	reset_at INTEGER NOT NULL
);
