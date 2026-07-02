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

-- Replaces the placeholder `quotas` table (Module 2 scaffolding: a fake local
-- allowance never actually representative of real funds) with a cache of the
-- real per-account balance archAI reports after each generation. Enforcement is
-- left entirely to archAI — it's the only source of truth for real money — so
-- this table exists purely to display the balance as of the last generation.
DROP TABLE quotas;

CREATE TABLE balances (
	user_id TEXT PRIMARY KEY REFERENCES users (id),
	balance REAL NOT NULL,
	updated_at INTEGER NOT NULL
);
