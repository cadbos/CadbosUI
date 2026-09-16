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

-- Job queue for the Flux Kontext ComfyUI edit-by-prompt workflow, backing the
-- edit panel's freeform / add-object / remove-object tools (replaces the old
-- archAI edit-by-prompt call). Same shape as light_settings_jobs (0013,
-- post-0015 media-id form) — one scene image, one free-text instruction; which
-- of the three UI tools produced the instruction is client-side bookkeeping
-- only (RenderResult.editOp.type), not tracked here, same as the old archAI
-- path never tracked it either.
CREATE TABLE flux_kontext_edit_jobs (
	id TEXT PRIMARY KEY NOT NULL,
	user_id TEXT NOT NULL REFERENCES users (id),
	comfy_prompt_id TEXT NOT NULL UNIQUE,
	scene_media_id INTEGER NOT NULL REFERENCES media (id),
	session_id TEXT REFERENCES project_sessions (id),
	instruction TEXT NOT NULL,
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

CREATE INDEX flux_kontext_edit_jobs_user_created_at
	ON flux_kontext_edit_jobs (user_id, created_at DESC);
