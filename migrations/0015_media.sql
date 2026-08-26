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

PRAGMA defer_foreign_keys = ON;

CREATE UNIQUE INDEX buckets_name ON buckets (name);

CREATE TABLE media (
	id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
	filename TEXT NOT NULL,
	bucket INTEGER NOT NULL REFERENCES buckets (id),
	checksum TEXT NOT NULL CHECK (
		checksum = '' OR (
			length(checksum) = 64 AND checksum NOT GLOB '*[^0-9a-f]*'
		)
	),
	UNIQUE (bucket, filename)
);

CREATE INDEX media_checksum ON media (checksum);

CREATE TABLE _media_sources (
	url TEXT NOT NULL,
	checksum TEXT NOT NULL
);

INSERT INTO _media_sources (url, checksum)
SELECT url, '' FROM generations;

INSERT INTO _media_sources (url, checksum)
SELECT source_url, source_hash FROM generations;

INSERT INTO _media_sources (url, checksum)
SELECT scene_url, scene_hash FROM object_replacement_jobs;

INSERT INTO _media_sources (url, checksum)
SELECT reference_url, '' FROM object_replacement_jobs;

INSERT INTO _media_sources (url, checksum)
SELECT output_url, '' FROM object_replacement_jobs WHERE output_url IS NOT NULL;

INSERT INTO _media_sources (url, checksum)
SELECT scene_url, scene_hash FROM texture_replacement_jobs;

INSERT INTO _media_sources (url, checksum)
SELECT reference_url, '' FROM texture_replacement_jobs;

INSERT INTO _media_sources (url, checksum)
SELECT output_url, '' FROM texture_replacement_jobs WHERE output_url IS NOT NULL;

INSERT INTO _media_sources (url, checksum)
SELECT scene_url, scene_hash FROM light_settings_jobs;

INSERT INTO _media_sources (url, checksum)
SELECT output_url, '' FROM light_settings_jobs WHERE output_url IS NOT NULL;

INSERT OR IGNORE INTO buckets (name, url)
SELECT 'external:' || origin, origin
FROM (
	SELECT DISTINCT
		CASE
			WHEN instr(substr(url, instr(url, '://') + 3), '/') = 0 THEN url
			ELSE substr(
				url,
				1,
				instr(url, '://') + 1 + instr(substr(url, instr(url, '://') + 3), '/')
			)
		END AS origin,
		url
	FROM _media_sources
) AS sources
WHERE NOT EXISTS (
	SELECT 1
	FROM buckets
	WHERE sources.url = rtrim(buckets.url, '/')
		OR substr(sources.url, 1, length(rtrim(buckets.url, '/')) + 1)
			= rtrim(buckets.url, '/') || '/'
);

CREATE TABLE _media_urls AS
WITH normalized AS (
	SELECT
		url,
		CASE
			WHEN length(checksum) = 64
				AND lower(checksum) NOT GLOB '*[^0-9a-f]*'
			THEN lower(checksum)
			ELSE ''
		END AS checksum
	FROM _media_sources
), grouped AS (
	SELECT
		url,
		CASE
			WHEN MIN(NULLIF(checksum, '')) = MAX(NULLIF(checksum, ''))
			THEN COALESCE(MIN(NULLIF(checksum, '')), '')
			ELSE ''
		END AS checksum
	FROM normalized
	GROUP BY url
), candidates AS (
	SELECT
		grouped.url,
		grouped.checksum,
		buckets.id AS bucket,
		rtrim(buckets.url, '/') AS bucket_url,
		ROW_NUMBER() OVER (
			PARTITION BY grouped.url
			ORDER BY length(rtrim(buckets.url, '/')) DESC, buckets.id
		) AS position
	FROM grouped
	JOIN buckets ON grouped.url = rtrim(buckets.url, '/')
		OR substr(grouped.url, 1, length(rtrim(buckets.url, '/')) + 1)
			= rtrim(buckets.url, '/') || '/'
)
SELECT
	url,
	bucket,
	substr(url, length(bucket_url) + 2) AS filename,
	checksum
FROM candidates
WHERE position = 1;

INSERT INTO media (filename, bucket, checksum)
SELECT filename, bucket, checksum
FROM _media_urls;

CREATE TABLE _media_map (
	url TEXT PRIMARY KEY NOT NULL,
	media_id INTEGER NOT NULL REFERENCES media (id)
);

INSERT INTO _media_map (url, media_id)
SELECT urls.url, media.id
FROM _media_urls urls
JOIN media ON media.bucket = urls.bucket AND media.filename = urls.filename;

CREATE TABLE generations_new (
	id TEXT PRIMARY KEY NOT NULL,
	user_id TEXT NOT NULL REFERENCES users (id),
	result_media_id INTEGER NOT NULL REFERENCES media (id),
	source_media_id INTEGER NOT NULL REFERENCES media (id),
	prompt TEXT NOT NULL,
	kind TEXT NOT NULL,
	amount REAL NOT NULL,
	balance_after REAL NOT NULL,
	created_at INTEGER NOT NULL,
	session_id TEXT REFERENCES project_sessions (id)
);

INSERT INTO generations_new (
	id, user_id, result_media_id, source_media_id, prompt, kind, amount,
	balance_after, created_at, session_id
)
SELECT
	g.id,
	g.user_id,
	result_media.media_id,
	source_media.media_id,
	g.prompt,
	g.kind,
	g.amount,
	g.balance_after,
	g.created_at,
	g.session_id
FROM generations g
JOIN _media_map result_media ON result_media.url = g.url
JOIN _media_map source_media ON source_media.url = g.source_url;

CREATE TABLE _media_guard (
	source_count INTEGER NOT NULL,
	mapped_count INTEGER NOT NULL,
	CONSTRAINT media_guard_counts_match CHECK (source_count = mapped_count)
);

INSERT INTO _media_guard (source_count, mapped_count)
SELECT
	(SELECT COUNT(*) FROM generations),
	COUNT(*)
FROM generations g
JOIN _media_map result_media ON result_media.url = g.url
JOIN _media_map source_media ON source_media.url = g.source_url;

DROP TABLE generations;
ALTER TABLE generations_new RENAME TO generations;

CREATE INDEX generations_user_created_at ON generations (user_id, created_at DESC);
CREATE INDEX generations_user_source_media
	ON generations (user_id, source_media_id, created_at);
CREATE INDEX generations_session_id ON generations (session_id, created_at DESC);

CREATE TABLE object_replacement_jobs_new (
	id TEXT PRIMARY KEY NOT NULL,
	user_id TEXT NOT NULL REFERENCES users (id),
	comfy_prompt_id TEXT NOT NULL UNIQUE,
	scene_media_id INTEGER NOT NULL REFERENCES media (id),
	reference_media_id INTEGER NOT NULL REFERENCES media (id),
	replacement_object TEXT NOT NULL,
	cost REAL NOT NULL CHECK (cost > 0),
	status TEXT NOT NULL CHECK (status IN ('processing', 'completed', 'failed')),
	output_media_id INTEGER REFERENCES media (id),
	error_code TEXT,
	balance_after REAL,
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL,
	completed_at INTEGER,
	session_id TEXT REFERENCES project_sessions (id),
	CHECK (
		(status = 'processing' AND output_media_id IS NULL AND error_code IS NULL AND balance_after IS NULL AND completed_at IS NULL)
		OR (status = 'completed' AND output_media_id IS NOT NULL AND error_code IS NULL AND balance_after IS NOT NULL AND completed_at IS NOT NULL)
		OR (status = 'failed' AND output_media_id IS NULL AND error_code IS NOT NULL AND balance_after IS NULL AND completed_at IS NOT NULL)
	)
);

INSERT INTO object_replacement_jobs_new (
	id, user_id, comfy_prompt_id, scene_media_id, reference_media_id,
	replacement_object, cost, status, output_media_id, error_code, balance_after,
	created_at, updated_at, completed_at, session_id
)
SELECT
	j.id,
	j.user_id,
	j.comfy_prompt_id,
	scene_media.media_id,
	reference_media.media_id,
	j.replacement_object,
	j.cost,
	j.status,
	output_media.media_id,
	j.error_code,
	j.balance_after,
	j.created_at,
	j.updated_at,
	j.completed_at,
	j.session_id
FROM object_replacement_jobs j
JOIN _media_map scene_media ON scene_media.url = j.scene_url
JOIN _media_map reference_media ON reference_media.url = j.reference_url
LEFT JOIN _media_map output_media ON output_media.url = j.output_url;

INSERT INTO _media_guard (source_count, mapped_count)
SELECT
	(SELECT COUNT(*) FROM object_replacement_jobs),
	COUNT(*)
FROM object_replacement_jobs j
JOIN _media_map scene_media ON scene_media.url = j.scene_url
JOIN _media_map reference_media ON reference_media.url = j.reference_url;

DROP TABLE object_replacement_jobs;
ALTER TABLE object_replacement_jobs_new RENAME TO object_replacement_jobs;

CREATE INDEX object_replacement_jobs_user_created_at
	ON object_replacement_jobs (user_id, created_at DESC);

CREATE TABLE texture_replacement_jobs_new (
	id TEXT PRIMARY KEY NOT NULL,
	user_id TEXT NOT NULL REFERENCES users (id),
	comfy_prompt_id TEXT NOT NULL UNIQUE,
	scene_media_id INTEGER NOT NULL REFERENCES media (id),
	reference_media_id INTEGER NOT NULL REFERENCES media (id),
	replacement_surface TEXT NOT NULL,
	cost REAL NOT NULL CHECK (cost > 0),
	status TEXT NOT NULL CHECK (status IN ('processing', 'completed', 'failed')),
	output_media_id INTEGER REFERENCES media (id),
	error_code TEXT,
	balance_after REAL,
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL,
	completed_at INTEGER,
	session_id TEXT REFERENCES project_sessions (id),
	CHECK (
		(status = 'processing' AND output_media_id IS NULL AND error_code IS NULL AND balance_after IS NULL AND completed_at IS NULL)
		OR (status = 'completed' AND output_media_id IS NOT NULL AND error_code IS NULL AND balance_after IS NOT NULL AND completed_at IS NOT NULL)
		OR (status = 'failed' AND output_media_id IS NULL AND error_code IS NOT NULL AND balance_after IS NULL AND completed_at IS NOT NULL)
	)
);

INSERT INTO texture_replacement_jobs_new (
	id, user_id, comfy_prompt_id, scene_media_id, reference_media_id,
	replacement_surface, cost, status, output_media_id, error_code, balance_after,
	created_at, updated_at, completed_at, session_id
)
SELECT
	j.id,
	j.user_id,
	j.comfy_prompt_id,
	scene_media.media_id,
	reference_media.media_id,
	j.replacement_surface,
	j.cost,
	j.status,
	output_media.media_id,
	j.error_code,
	j.balance_after,
	j.created_at,
	j.updated_at,
	j.completed_at,
	j.session_id
FROM texture_replacement_jobs j
JOIN _media_map scene_media ON scene_media.url = j.scene_url
JOIN _media_map reference_media ON reference_media.url = j.reference_url
LEFT JOIN _media_map output_media ON output_media.url = j.output_url;

INSERT INTO _media_guard (source_count, mapped_count)
SELECT
	(SELECT COUNT(*) FROM texture_replacement_jobs),
	COUNT(*)
FROM texture_replacement_jobs j
JOIN _media_map scene_media ON scene_media.url = j.scene_url
JOIN _media_map reference_media ON reference_media.url = j.reference_url;

DROP TABLE texture_replacement_jobs;
ALTER TABLE texture_replacement_jobs_new RENAME TO texture_replacement_jobs;

CREATE INDEX texture_replacement_jobs_user_created_at
	ON texture_replacement_jobs (user_id, created_at DESC);

CREATE TABLE light_settings_jobs_new (
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

INSERT INTO light_settings_jobs_new (
	id, user_id, comfy_prompt_id, scene_media_id, session_id, instruction, cost,
	status, output_media_id, error_code, balance_after, created_at, updated_at,
	completed_at
)
SELECT
	j.id,
	j.user_id,
	j.comfy_prompt_id,
	scene_media.media_id,
	j.session_id,
	j.instruction,
	j.cost,
	j.status,
	output_media.media_id,
	j.error_code,
	j.balance_after,
	j.created_at,
	j.updated_at,
	j.completed_at
FROM light_settings_jobs j
JOIN _media_map scene_media ON scene_media.url = j.scene_url
LEFT JOIN _media_map output_media ON output_media.url = j.output_url;

INSERT INTO _media_guard (source_count, mapped_count)
SELECT
	(SELECT COUNT(*) FROM light_settings_jobs),
	COUNT(*)
FROM light_settings_jobs j
JOIN _media_map scene_media ON scene_media.url = j.scene_url;

DROP TABLE light_settings_jobs;
ALTER TABLE light_settings_jobs_new RENAME TO light_settings_jobs;

CREATE INDEX light_settings_jobs_user_created_at
	ON light_settings_jobs (user_id, created_at DESC);

DROP TABLE _media_guard;
DROP TABLE _media_map;
DROP TABLE _media_urls;
DROP TABLE _media_sources;

PRAGMA defer_foreign_keys = OFF;
