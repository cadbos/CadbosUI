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

-- Job queue for the repaint ComfyUI workflow (Flux.2 multi-image edit): the
-- scene photo plus a solid swatch of the chosen color, and the free-text
-- target to recolor. Same shape as flux_kontext_edit_jobs (0016) with the
-- duration (0017) and form snapshot (0018) columns from the start. The swatch
-- is generated server-side from `color` and never stored, so only the color
-- itself is kept.
CREATE TABLE repaint_jobs (
	id TEXT PRIMARY KEY NOT NULL,
	user_id TEXT NOT NULL REFERENCES users (id),
	comfy_prompt_id TEXT NOT NULL UNIQUE,
	scene_media_id INTEGER NOT NULL REFERENCES media (id),
	session_id TEXT REFERENCES project_sessions (id),
	target TEXT NOT NULL,
	color TEXT NOT NULL CHECK (length(color) = 7 AND color GLOB '#[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]'),
	cost REAL NOT NULL CHECK (cost > 0),
	status TEXT NOT NULL CHECK (status IN ('processing', 'completed', 'failed')),
	output_media_id INTEGER REFERENCES media (id),
	error_code TEXT,
	balance_after REAL,
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL,
	completed_at INTEGER,
	upload_queue_sec INTEGER NOT NULL DEFAULT 0 CHECK (upload_queue_sec >= 0),
	queue_wait_sec INTEGER NOT NULL DEFAULT 0 CHECK (queue_wait_sec >= 0),
	execution_sec INTEGER NOT NULL DEFAULT 0 CHECK (execution_sec >= 0),
	download_sec INTEGER NOT NULL DEFAULT 0 CHECK (download_sec >= 0),
	reupload_sec INTEGER NOT NULL DEFAULT 0 CHECK (reupload_sec >= 0),
	form_snapshot TEXT,
	CHECK (
		(status = 'processing' AND output_media_id IS NULL AND error_code IS NULL AND balance_after IS NULL AND completed_at IS NULL)
		OR (status = 'completed' AND output_media_id IS NOT NULL AND error_code IS NULL AND balance_after IS NOT NULL AND completed_at IS NOT NULL)
		OR (status = 'failed' AND output_media_id IS NULL AND error_code IS NOT NULL AND balance_after IS NULL AND completed_at IS NOT NULL)
	)
);

CREATE INDEX repaint_jobs_user_created_at
	ON repaint_jobs (user_id, created_at DESC);
