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

-- Module 11 (Projects) foundation. Introduces the Project -> Session -> Generation
-- hierarchy on top of the existing flat `generations` table: a project groups a
-- user's source photos/rooms, a session is one generation thread within a project
-- (forked into a new session by style-transfer, continued in place by everything
-- else), and `generations` rows attach to the session that produced them.
--
-- The new thread entity is named `project_sessions`, not `sessions` — `sessions`
-- already exists (migrations/0001_auth.sql) as the login/auth session table, and
-- reusing that name would collide with it.
CREATE TABLE projects (
	id TEXT PRIMARY KEY NOT NULL,
	user_id TEXT NOT NULL REFERENCES users (id),
	title TEXT NOT NULL DEFAULT '',
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL
);

CREATE INDEX projects_user_updated_at ON projects (user_id, updated_at DESC);

CREATE TABLE project_sessions (
	id TEXT PRIMARY KEY NOT NULL,
	project_id TEXT NOT NULL REFERENCES projects (id),
	title TEXT NOT NULL DEFAULT '',
	-- Fork lineage: both set together when style-transfer branches a new session
	-- off an existing one, both null for a session created directly (not a fork).
	parent_session_id TEXT REFERENCES project_sessions (id),
	forked_from_generation_id TEXT REFERENCES generations (id),
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL,
	CHECK (
		(parent_session_id IS NULL AND forked_from_generation_id IS NULL)
		OR (parent_session_id IS NOT NULL AND forked_from_generation_id IS NOT NULL)
	)
);

CREATE INDEX project_sessions_project_updated_at ON project_sessions (project_id, updated_at DESC);

-- Whole-project, read-only share links. The token is the entire authorization for
-- the public viewer (no auth check backs it) — generate it with the same CSPRNG
-- helper auth session ids and challenge nonces already use (randomToken(), in
-- src/lib/server/auth/session.ts). `revoked_at IS NULL` means the link is active;
-- there is no expiry column, per product decision (v1 has explicit revoke only).
CREATE TABLE project_shares (
	token TEXT PRIMARY KEY NOT NULL,
	project_id TEXT NOT NULL REFERENCES projects (id),
	created_at INTEGER NOT NULL,
	revoked_at INTEGER
);

CREATE INDEX project_shares_project_id ON project_shares (project_id);

-- session_id is nullable at the DB level: D1/SQLite can't add a NOT NULL column to
-- an already-populated table without a full rebuild. "Always set" is enforced at
-- the application layer instead (Module 11c).
ALTER TABLE generations ADD COLUMN session_id TEXT REFERENCES project_sessions (id);

CREATE INDEX generations_session_id ON generations (session_id, created_at DESC);

-- Same "carry a value from submission to completion" treatment migration 0009 gave
-- scene_hash on these two job tables: the job is submitted in one request and
-- completed in a later, separate polling request, so session_id has to be captured
-- at submission time to still be available when completeXJob() writes the
-- `generations` row.
ALTER TABLE object_replacement_jobs ADD COLUMN session_id TEXT REFERENCES project_sessions (id);

ALTER TABLE texture_replacement_jobs ADD COLUMN session_id TEXT REFERENCES project_sessions (id);

-- Backfill: one "Untitled" project + session per user who has any pre-Module-11
-- row in generations/object_replacement_jobs/texture_replacement_jobs. This does
-- NOT group by source_hash/source_url — every edit/upscale/current-result-mode row
-- shares source_hash = '' (see 0009's own warning against grouping on that), so a
-- per-source grouping would silently merge unrelated chains. Migration 0006 made
-- the same conservative call for a structurally identical ambiguous-join problem
-- ("no reliable correlation key... a heuristic join could misattribute"); this
-- follows that precedent rather than guessing.
-- lower(hex(randomblob(16))) alone would give 32 raw hex characters with no
-- dashes and no version/variant nibbles — not a value z.uuid() (or any other
-- RFC 9562 UUID parser) accepts, unlike every other id in this schema, which
-- comes from crypto.randomUUID(). Building the standard 8-4-4-4-12 layout by
-- hand and forcing the version (4) and variant (8) nibbles keeps these
-- backfilled ids shaped like real UUIDs.
INSERT INTO projects (id, user_id, title, created_at, updated_at)
SELECT
	lower(
		hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' ||
		substr(hex(randomblob(2)), 2) || '-8' || substr(hex(randomblob(2)), 2) || '-' ||
		hex(randomblob(6))
	),
	u.user_id,
	'Untitled',
	unixepoch() * 1000,
	unixepoch() * 1000
FROM (
	SELECT user_id FROM generations
	UNION
	SELECT user_id FROM object_replacement_jobs
	UNION
	SELECT user_id FROM texture_replacement_jobs
) u;

INSERT INTO project_sessions (id, project_id, title, created_at, updated_at)
SELECT
	lower(
		hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' ||
		substr(hex(randomblob(2)), 2) || '-8' || substr(hex(randomblob(2)), 2) || '-' ||
		hex(randomblob(6))
	),
	p.id, 'Untitled', p.created_at, p.updated_at
FROM projects p;

UPDATE generations
SET session_id = (
	SELECT ps.id
	FROM project_sessions ps
	JOIN projects p ON p.id = ps.project_id
	WHERE p.user_id = generations.user_id
)
WHERE session_id IS NULL;

-- Completed jobs already have a matching `generations` row inserted with the same
-- id (see completeObjectReplacementJob/completeTextureReplacementJob) — copy the
-- session_id that row just received above, an exact join, no heuristics needed.
UPDATE object_replacement_jobs
SET session_id = (SELECT g.session_id FROM generations g WHERE g.id = object_replacement_jobs.id)
WHERE status = 'completed' AND session_id IS NULL;

UPDATE texture_replacement_jobs
SET session_id = (SELECT g.session_id FROM generations g WHERE g.id = texture_replacement_jobs.id)
WHERE status = 'completed' AND session_id IS NULL;

-- Processing/failed jobs never produced a `generations` row, so there is nothing
-- to join against — fall back to the same per-user Untitled session.
UPDATE object_replacement_jobs
SET session_id = (
	SELECT ps.id
	FROM project_sessions ps
	JOIN projects p ON p.id = ps.project_id
	WHERE p.user_id = object_replacement_jobs.user_id
)
WHERE session_id IS NULL;

UPDATE texture_replacement_jobs
SET session_id = (
	SELECT ps.id
	FROM project_sessions ps
	JOIN projects p ON p.id = ps.project_id
	WHERE p.user_id = texture_replacement_jobs.user_id
)
WHERE session_id IS NULL;
