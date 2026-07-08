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

-- Split image-specific generation data from the generic generation ledger so
-- non-image generation kinds can share the same accounting/history table.
ALTER TABLE generations RENAME TO generations_before_image_details;

CREATE TABLE generations (
	id TEXT PRIMARY KEY NOT NULL,
	user_id TEXT NOT NULL REFERENCES users (id),
	prompt TEXT,
	kind TEXT NOT NULL,
	amount REAL NOT NULL,
	balance_after REAL NOT NULL,
	created_at INTEGER NOT NULL CHECK (created_at > 0)
);

INSERT INTO generations (id, user_id, prompt, kind, amount, balance_after, created_at)
SELECT id, user_id, prompt, kind, amount, balance_after, created_at
FROM generations_before_image_details;

CREATE TABLE image_generations_details (
	id TEXT PRIMARY KEY NOT NULL,
	generation_id TEXT NOT NULL UNIQUE REFERENCES generations (id) ON DELETE CASCADE,
	output_url TEXT NOT NULL CHECK (output_url LIKE 'http://%' OR output_url LIKE 'https://%'),
	input_url TEXT NOT NULL CHECK (input_url LIKE 'http://%' OR input_url LIKE 'https://%')
);

INSERT INTO image_generations_details (id, generation_id, output_url, input_url)
SELECT id, id, url, source_url
FROM generations_before_image_details;

DROP TABLE generations_before_image_details;

CREATE INDEX generations_user_created_at ON generations (user_id, created_at DESC);
