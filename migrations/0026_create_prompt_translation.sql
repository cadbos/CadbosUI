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

-- The prompt actually sent to archAI by a Create render (interior/exterior).
-- Create translates a Russian prompt to English through Workers AI before the
-- call (src/lib/server/prompt-translation.ts), so `prompt` keeps the user's
-- own text and this column keeps what archAI received — the untranslated
-- prompt when translation was skipped or failed. NULL for every other kind
-- and for rows written before this column existed.
ALTER TABLE generations ADD COLUMN archai_prompt TEXT;

-- Workers AI usage per UTC day, summed from the `usage.neurons` each call
-- reports. Workers AI's free allocation resets daily at 00:00 UTC, so the
-- usage page compares today's row against that allocation.
CREATE TABLE workers_ai_daily_usage (
	date TEXT PRIMARY KEY,
	requests INTEGER NOT NULL CHECK (requests >= 0),
	neurons REAL NOT NULL CHECK (neurons >= 0)
);
