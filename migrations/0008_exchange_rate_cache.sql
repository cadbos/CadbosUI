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

-- Short-lived cache for the BTC/USD rate used to price Lightning deposits (see
-- docs/payments-lightning-sats.md §4). One row per provider so switching the
-- configured default doesn't require invalidating anything. Kept in D1, not a
-- separate KV binding, to match the existing rate_limits (migrations/0001)
-- cache-table pattern rather than adding a new binding type for one small
-- ephemeral value.
CREATE TABLE exchange_rate_cache (
	provider TEXT PRIMARY KEY,
	sats_per_usd REAL NOT NULL CHECK (sats_per_usd > 0),
	fetched_at INTEGER NOT NULL CHECK (fetched_at > 0),
	expires_at INTEGER NOT NULL CHECK (expires_at > fetched_at)
);
