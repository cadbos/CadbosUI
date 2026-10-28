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

CREATE TABLE generations_feedback (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	generation_id TEXT NOT NULL UNIQUE REFERENCES generations (id) ON DELETE CASCADE,
	rating TEXT NOT NULL CHECK (rating IN ('like', 'dislike')),
	comment TEXT,
	created_at INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER))
);
