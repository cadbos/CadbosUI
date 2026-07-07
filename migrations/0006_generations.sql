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

-- Consolidates `generated_images` (0003) and `credit_transactions` (0004) into
-- one row per paid generation. The two were always 1:1 — recordGeneratedImage
-- and deductCredit ran back-to-back for the same render/edit call — but lived
-- in separate tables with no shared key linking them, which is exactly the
-- redundancy this migration removes. Also adds the source image and prompt,
-- which neither table stored.
--
-- No backfill: the old tables have no reliable correlation key (two separate,
-- non-transactional inserts per call), so a heuristic join by user_id and
-- nearest timestamp could misattribute a cost to the wrong image. Both are
-- pre-launch, admin-approved-test-account data only.
DROP TABLE generated_images;

DROP TABLE credit_transactions;

CREATE TABLE generations (
	id TEXT PRIMARY KEY NOT NULL,
	user_id TEXT NOT NULL REFERENCES users (id),
	url TEXT NOT NULL CHECK (url LIKE 'http://%' OR url LIKE 'https://%'),
	source_url TEXT NOT NULL CHECK (source_url LIKE 'http://%' OR source_url LIKE 'https://%'),
	prompt TEXT NOT NULL,
	kind TEXT NOT NULL,
	amount REAL NOT NULL,
	balance_after REAL NOT NULL,
	created_at INTEGER NOT NULL
);

CREATE INDEX generations_user_created_at ON generations (user_id, created_at DESC);
