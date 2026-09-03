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

CREATE TABLE object_adder_jobs (
	id TEXT PRIMARY KEY NOT NULL,
	user_id TEXT NOT NULL REFERENCES users (id),
	comfy_prompt_id TEXT NOT NULL UNIQUE,
	scene_media_id INTEGER NOT NULL REFERENCES media (id),
	object_media_id INTEGER NOT NULL REFERENCES media (id),
	-- The object's placement on the scene, as fractions of the scene's own
	-- width/height (see ObjectAdderRect in contract.ts) — resolved against
	-- whatever pixel dimensions the server actually downloads, not a pixel
	-- rect fixed at browser-measurement time.
	rect_x REAL NOT NULL CHECK (rect_x >= 0 AND rect_x <= 1),
	rect_y REAL NOT NULL CHECK (rect_y >= 0 AND rect_y <= 1),
	rect_width REAL NOT NULL CHECK (rect_width > 0 AND rect_width <= 1),
	rect_height REAL NOT NULL CHECK (rect_height > 0 AND rect_height <= 1),
	prompt TEXT NOT NULL,
	session_id TEXT REFERENCES project_sessions (id),
	cost REAL NOT NULL CHECK (cost > 0),
	status TEXT NOT NULL CHECK (status IN ('processing', 'completed', 'failed')),
	output_media_id INTEGER REFERENCES media (id),
	error_code TEXT,
	balance_after REAL,
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL,
	completed_at INTEGER,
	CHECK (
		(status = 'processing' AND output_media_id IS NULL AND error_code IS NULL AND balance_after IS NULL AND completed_at IS NULL)
		OR (status = 'completed' AND output_media_id IS NOT NULL AND error_code IS NULL AND balance_after IS NOT NULL AND completed_at IS NOT NULL)
		OR (status = 'failed' AND output_media_id IS NULL AND error_code IS NOT NULL AND balance_after IS NULL AND completed_at IS NOT NULL)
	)
);

CREATE INDEX object_adder_jobs_user_created_at
	ON object_adder_jobs (user_id, created_at DESC);
