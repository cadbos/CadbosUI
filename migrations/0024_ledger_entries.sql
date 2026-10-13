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

CREATE TABLE ledger_entries (
	id INTEGER PRIMARY KEY NOT NULL,
	user_id TEXT NOT NULL REFERENCES users (id),
	amount INTEGER NOT NULL CHECK (typeof(amount) = 'integer' AND amount >= 0 AND amount <= 9007199254740991),
	entry_side TEXT NOT NULL CHECK (entry_side IN ('debit', 'credit')),
	reason TEXT,
	created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000) CHECK (typeof(created_at) = 'integer' AND created_at > 0)
);

CREATE INDEX ledger_entries_user_created_at ON ledger_entries (user_id, created_at DESC, id DESC);
CREATE INDEX ledger_entries_user_id_id ON ledger_entries (user_id, id);

CREATE TABLE _ledger_guard (valid INTEGER NOT NULL CHECK (valid = 1));

CREATE TABLE _ledger_completed_jobs AS
SELECT id, user_id, cost, balance_after, completed_at, rowid AS old_rowid, 1 AS source_order
FROM object_replacement_jobs WHERE status = 'completed'
UNION ALL SELECT id, user_id, cost, balance_after, completed_at, rowid, 2
FROM texture_replacement_jobs WHERE status = 'completed'
UNION ALL SELECT id, user_id, cost, balance_after, completed_at, rowid, 3
FROM light_settings_jobs WHERE status = 'completed'
UNION ALL SELECT id, user_id, cost, balance_after, completed_at, rowid, 4
FROM flux_kontext_edit_jobs WHERE status = 'completed'
UNION ALL SELECT id, user_id, cost, balance_after, completed_at, rowid, 5
FROM repaint_jobs WHERE status = 'completed';

CREATE UNIQUE INDEX _ledger_completed_jobs_id ON _ledger_completed_jobs (id);

INSERT INTO _ledger_guard
SELECT CASE WHEN EXISTS (
	SELECT 1 FROM generations WHERE amount < 0 OR created_at <= 0
		OR ABS(amount * 100) > 9007199254740991
		OR ABS(balance_after * 100) > 9007199254740991
	UNION ALL
	SELECT 1 FROM credits WHERE enabled NOT IN (0, 1)
		OR ABS(balance * 100) > 9007199254740991
	UNION ALL
	SELECT 1 FROM _ledger_completed_jobs WHERE cost < 0 OR completed_at <= 0
		OR ABS(cost * 100) > 9007199254740991
		OR ABS(balance_after * 100) > 9007199254740991
) THEN 0 ELSE 1 END;

INSERT INTO _ledger_guard
SELECT CASE WHEN EXISTS (
	SELECT 1 FROM _ledger_completed_jobs j
	JOIN generations g ON g.id = j.id
	WHERE g.user_id <> j.user_id
		OR CASE WHEN j.cost = 0 THEN 0 ELSE CAST(MAX(1, ROUND(ROUND(j.cost * 100, 8))) AS INTEGER) END
			<> CASE WHEN g.amount = 0 THEN 0 ELSE CAST(MAX(1, ROUND(ROUND(g.amount * 100, 8))) AS INTEGER) END
		OR CAST(ROUND(ROUND(j.balance_after * 100, 8)) AS INTEGER)
			<> CAST(ROUND(ROUND(g.balance_after * 100, 8)) AS INTEGER)
) THEN 0 ELSE 1 END;

CREATE TABLE _ledger_operations AS
WITH operations AS (
	SELECT id, user_id, created_at, rowid AS old_rowid, 0 AS source_order, amount, balance_after
	FROM generations
	UNION ALL
	SELECT j.id, j.user_id, j.completed_at, j.old_rowid, j.source_order, j.cost, j.balance_after
	FROM _ledger_completed_jobs j
	WHERE NOT EXISTS (SELECT 1 FROM generations g WHERE g.id = j.id)
), rounded AS (
	SELECT id, user_id, created_at, old_rowid, source_order,
		CASE WHEN amount = 0 THEN 0 ELSE CAST(MAX(1, ROUND(ROUND(amount * 100, 8))) AS INTEGER) END AS amount_cents,
		CAST(ROUND(ROUND(balance_after * 100, 8)) AS INTEGER) AS balance_cents
	FROM operations
)
SELECT *,
	ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at, source_order, old_rowid) AS ordinal,
	LAG(balance_cents, 1, 0) OVER (PARTITION BY user_id ORDER BY created_at, source_order, old_rowid) AS prior_balance_cents
FROM rounded;

CREATE UNIQUE INDEX _ledger_operations_id ON _ledger_operations (id);

CREATE TABLE _ledger_events (
	user_id TEXT NOT NULL,
	amount INTEGER NOT NULL,
	entry_side TEXT NOT NULL,
	reason TEXT NOT NULL,
	operation_id TEXT,
	created_at INTEGER NOT NULL,
	ordinal INTEGER NOT NULL
);

INSERT INTO _ledger_events
SELECT user_id, ABS(balance_cents + amount_cents - prior_balance_cents),
	CASE WHEN balance_cents + amount_cents - prior_balance_cents > 0 THEN 'credit' ELSE 'debit' END,
	CASE WHEN ordinal = 1 THEN 'opening-balance' ELSE 'historical-reconciliation' END,
	NULL, created_at, ordinal * 2 - 1
FROM _ledger_operations
WHERE balance_cents + amount_cents <> prior_balance_cents;

INSERT INTO _ledger_events
SELECT user_id, amount_cents, 'debit', 'generation-charge', id, created_at, ordinal * 2
FROM _ledger_operations;

INSERT INTO _ledger_events
SELECT c.user_id, ABS(CAST(ROUND(ROUND(c.balance * 100, 8)) AS INTEGER) - COALESCE(g.balance_cents, 0)),
	CASE WHEN CAST(ROUND(ROUND(c.balance * 100, 8)) AS INTEGER) > COALESCE(g.balance_cents, 0)
		THEN 'credit' ELSE 'debit' END,
	CASE WHEN g.id IS NULL THEN 'opening-balance' ELSE 'historical-reconciliation' END,
	NULL, MAX(1, c.updated_at, COALESCE(g.created_at, 0)), COALESCE(g.ordinal * 2 + 1, 1)
FROM credits c
LEFT JOIN _ledger_operations g ON g.user_id = c.user_id
	AND g.ordinal = (SELECT MAX(last.ordinal) FROM _ledger_operations last WHERE last.user_id = c.user_id)
WHERE CAST(ROUND(ROUND(c.balance * 100, 8)) AS INTEGER) <> COALESCE(g.balance_cents, 0);

INSERT INTO _ledger_guard
SELECT CASE WHEN EXISTS (
	SELECT 1 FROM _ledger_events WHERE typeof(amount) <> 'integer'
		OR amount < 0 OR amount > 9007199254740991 OR created_at <= 0
) THEN 0 ELSE 1 END;

CREATE TABLE _ledger_ordered_events AS
SELECT ROW_NUMBER() OVER (ORDER BY user_id, created_at, ordinal) AS id, *
FROM _ledger_events;

CREATE UNIQUE INDEX _ledger_ordered_events_operation_id ON _ledger_ordered_events (operation_id);

INSERT INTO ledger_entries (id, user_id, amount, entry_side, reason, created_at)
SELECT id, user_id, amount, entry_side, reason, created_at
FROM _ledger_ordered_events;

ALTER TABLE generations ADD COLUMN ledger_entry_id INTEGER REFERENCES ledger_entries (id);
UPDATE generations
SET ledger_entry_id = (SELECT l.id FROM _ledger_ordered_events l
	WHERE l.operation_id = generations.id AND l.user_id = generations.user_id AND l.entry_side = 'debit');

INSERT INTO _ledger_guard
SELECT CASE WHEN EXISTS (SELECT 1 FROM generations WHERE ledger_entry_id IS NULL)
	THEN 0 ELSE 1 END;

ALTER TABLE generations DROP COLUMN amount;
ALTER TABLE generations DROP COLUMN balance_after;
CREATE UNIQUE INDEX generations_ledger_entry_id ON generations (ledger_entry_id);

CREATE TRIGGER generations_ledger_entry_valid_insert
BEFORE INSERT ON generations
BEGIN
	SELECT RAISE(ABORT, 'generation debit does not match') WHERE NOT EXISTS (
		SELECT 1 FROM ledger_entries l WHERE l.id = NEW.ledger_entry_id
			AND l.user_id = NEW.user_id AND l.entry_side = 'debit'
	);
END;

CREATE TRIGGER generations_ledger_entry_valid_update
BEFORE UPDATE OF user_id, ledger_entry_id ON generations
BEGIN
	SELECT RAISE(ABORT, 'generation debit does not match') WHERE NOT EXISTS (
		SELECT 1 FROM ledger_entries l WHERE l.id = NEW.ledger_entry_id
			AND l.user_id = NEW.user_id AND l.entry_side = 'debit'
	);
END;

CREATE TABLE credits_new (
	user_id TEXT PRIMARY KEY REFERENCES users (id),
	enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1))
);
INSERT INTO credits_new (user_id, enabled) SELECT user_id, enabled FROM credits;
DROP TABLE credits;
ALTER TABLE credits_new RENAME TO credits;

CREATE TRIGGER ledger_entries_prevent_update
BEFORE UPDATE ON ledger_entries
BEGIN
	SELECT RAISE(ABORT, 'ledger entries are immutable');
END;

CREATE TRIGGER ledger_entries_prevent_delete
BEFORE DELETE ON ledger_entries
BEGIN
	SELECT RAISE(ABORT, 'ledger entries are immutable');
END;

CREATE TABLE object_replacement_jobs_new (
	id TEXT PRIMARY KEY NOT NULL,
	user_id TEXT NOT NULL REFERENCES users (id),
	comfy_prompt_id TEXT NOT NULL UNIQUE,
	scene_media_id INTEGER NOT NULL REFERENCES media (id),
	reference_media_id INTEGER NOT NULL REFERENCES media (id),
	replacement_object TEXT NOT NULL,
	cost REAL NOT NULL CHECK (cost >= 0),
	balance_after REAL,
	status TEXT NOT NULL CHECK (status IN ('processing', 'completed', 'failed')),
	output_media_id INTEGER REFERENCES media (id),
	error_code TEXT,
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL,
	completed_at INTEGER,
	session_id TEXT REFERENCES project_sessions (id),
	upload_queue_sec INTEGER NOT NULL DEFAULT 0 CHECK (upload_queue_sec >= 0),
	queue_wait_sec INTEGER NOT NULL DEFAULT 0 CHECK (queue_wait_sec >= 0),
	execution_sec INTEGER NOT NULL DEFAULT 0 CHECK (execution_sec >= 0),
	download_sec INTEGER NOT NULL DEFAULT 0 CHECK (download_sec >= 0),
	reupload_sec INTEGER NOT NULL DEFAULT 0 CHECK (reupload_sec >= 0),
	form_snapshot TEXT,
	CHECK (
		(status = 'processing' AND balance_after IS NULL AND output_media_id IS NULL AND error_code IS NULL AND completed_at IS NULL)
		OR (status = 'completed' AND balance_after IS NOT NULL AND output_media_id IS NOT NULL AND error_code IS NULL AND completed_at IS NOT NULL)
		OR (status = 'failed' AND balance_after IS NULL AND output_media_id IS NULL AND error_code IS NOT NULL AND completed_at IS NOT NULL)
	)
);
INSERT INTO object_replacement_jobs_new (
	id, user_id, comfy_prompt_id, scene_media_id, reference_media_id, replacement_object,
	cost, balance_after, status, output_media_id, error_code, created_at, updated_at, completed_at,
	session_id, upload_queue_sec, queue_wait_sec, execution_sec, download_sec, reupload_sec, form_snapshot
)
SELECT id, user_id, comfy_prompt_id, scene_media_id, reference_media_id, replacement_object,
	cost, balance_after, status, output_media_id, error_code, created_at, updated_at, completed_at,
	session_id, upload_queue_sec, queue_wait_sec, execution_sec, download_sec, reupload_sec, form_snapshot
FROM object_replacement_jobs;
DROP TABLE object_replacement_jobs;
ALTER TABLE object_replacement_jobs_new RENAME TO object_replacement_jobs;
CREATE INDEX object_replacement_jobs_user_created_at ON object_replacement_jobs (user_id, created_at DESC);

CREATE TABLE texture_replacement_jobs_new (
	id TEXT PRIMARY KEY NOT NULL,
	user_id TEXT NOT NULL REFERENCES users (id),
	comfy_prompt_id TEXT NOT NULL UNIQUE,
	scene_media_id INTEGER NOT NULL REFERENCES media (id),
	reference_media_id INTEGER NOT NULL REFERENCES media (id),
	replacement_surface TEXT NOT NULL,
	cost REAL NOT NULL CHECK (cost >= 0),
	balance_after REAL,
	status TEXT NOT NULL CHECK (status IN ('processing', 'completed', 'failed')),
	output_media_id INTEGER REFERENCES media (id),
	error_code TEXT,
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL,
	completed_at INTEGER,
	session_id TEXT REFERENCES project_sessions (id),
	upload_queue_sec INTEGER NOT NULL DEFAULT 0 CHECK (upload_queue_sec >= 0),
	queue_wait_sec INTEGER NOT NULL DEFAULT 0 CHECK (queue_wait_sec >= 0),
	execution_sec INTEGER NOT NULL DEFAULT 0 CHECK (execution_sec >= 0),
	download_sec INTEGER NOT NULL DEFAULT 0 CHECK (download_sec >= 0),
	reupload_sec INTEGER NOT NULL DEFAULT 0 CHECK (reupload_sec >= 0),
	form_snapshot TEXT,
	CHECK (
		(status = 'processing' AND balance_after IS NULL AND output_media_id IS NULL AND error_code IS NULL AND completed_at IS NULL)
		OR (status = 'completed' AND balance_after IS NOT NULL AND output_media_id IS NOT NULL AND error_code IS NULL AND completed_at IS NOT NULL)
		OR (status = 'failed' AND balance_after IS NULL AND output_media_id IS NULL AND error_code IS NOT NULL AND completed_at IS NOT NULL)
	)
);
INSERT INTO texture_replacement_jobs_new (
	id, user_id, comfy_prompt_id, scene_media_id, reference_media_id, replacement_surface,
	cost, balance_after, status, output_media_id, error_code, created_at, updated_at, completed_at,
	session_id, upload_queue_sec, queue_wait_sec, execution_sec, download_sec, reupload_sec, form_snapshot
)
SELECT id, user_id, comfy_prompt_id, scene_media_id, reference_media_id, replacement_surface,
	cost, balance_after, status, output_media_id, error_code, created_at, updated_at, completed_at,
	session_id, upload_queue_sec, queue_wait_sec, execution_sec, download_sec, reupload_sec, form_snapshot
FROM texture_replacement_jobs;
DROP TABLE texture_replacement_jobs;
ALTER TABLE texture_replacement_jobs_new RENAME TO texture_replacement_jobs;
CREATE INDEX texture_replacement_jobs_user_created_at ON texture_replacement_jobs (user_id, created_at DESC);

CREATE TABLE light_settings_jobs_new (
	id TEXT PRIMARY KEY NOT NULL,
	user_id TEXT NOT NULL REFERENCES users (id),
	comfy_prompt_id TEXT NOT NULL UNIQUE,
	scene_media_id INTEGER NOT NULL REFERENCES media (id),
	session_id TEXT REFERENCES project_sessions (id),
	instruction TEXT NOT NULL,
	cost REAL NOT NULL CHECK (cost >= 0),
	balance_after REAL,
	status TEXT NOT NULL CHECK (status IN ('processing', 'completed', 'failed')),
	output_media_id INTEGER REFERENCES media (id),
	error_code TEXT,
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
		(status = 'processing' AND balance_after IS NULL AND output_media_id IS NULL AND error_code IS NULL AND completed_at IS NULL)
		OR (status = 'completed' AND balance_after IS NOT NULL AND output_media_id IS NOT NULL AND error_code IS NULL AND completed_at IS NOT NULL)
		OR (status = 'failed' AND balance_after IS NULL AND output_media_id IS NULL AND error_code IS NOT NULL AND completed_at IS NOT NULL)
	)
);
INSERT INTO light_settings_jobs_new (
	id, user_id, comfy_prompt_id, scene_media_id, session_id, instruction, cost, balance_after, status,
	output_media_id, error_code, created_at, updated_at, completed_at, upload_queue_sec,
	queue_wait_sec, execution_sec, download_sec, reupload_sec, form_snapshot
)
SELECT id, user_id, comfy_prompt_id, scene_media_id, session_id, instruction, cost, balance_after, status,
	output_media_id, error_code, created_at, updated_at, completed_at, upload_queue_sec,
	queue_wait_sec, execution_sec, download_sec, reupload_sec, form_snapshot
FROM light_settings_jobs;
DROP TABLE light_settings_jobs;
ALTER TABLE light_settings_jobs_new RENAME TO light_settings_jobs;
CREATE INDEX light_settings_jobs_user_created_at ON light_settings_jobs (user_id, created_at DESC);

CREATE TABLE flux_kontext_edit_jobs_new (
	id TEXT PRIMARY KEY NOT NULL,
	user_id TEXT NOT NULL REFERENCES users (id),
	comfy_prompt_id TEXT NOT NULL UNIQUE,
	scene_media_id INTEGER NOT NULL REFERENCES media (id),
	session_id TEXT REFERENCES project_sessions (id),
	instruction TEXT NOT NULL,
	cost REAL NOT NULL CHECK (cost >= 0),
	balance_after REAL,
	status TEXT NOT NULL CHECK (status IN ('processing', 'completed', 'failed')),
	output_media_id INTEGER REFERENCES media (id),
	error_code TEXT,
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
		(status = 'processing' AND balance_after IS NULL AND output_media_id IS NULL AND error_code IS NULL AND completed_at IS NULL)
		OR (status = 'completed' AND balance_after IS NOT NULL AND output_media_id IS NOT NULL AND error_code IS NULL AND completed_at IS NOT NULL)
		OR (status = 'failed' AND balance_after IS NULL AND output_media_id IS NULL AND error_code IS NOT NULL AND completed_at IS NOT NULL)
	)
);
INSERT INTO flux_kontext_edit_jobs_new (
	id, user_id, comfy_prompt_id, scene_media_id, session_id, instruction, cost, balance_after, status,
	output_media_id, error_code, created_at, updated_at, completed_at, upload_queue_sec,
	queue_wait_sec, execution_sec, download_sec, reupload_sec, form_snapshot
)
SELECT id, user_id, comfy_prompt_id, scene_media_id, session_id, instruction, cost, balance_after, status,
	output_media_id, error_code, created_at, updated_at, completed_at, upload_queue_sec,
	queue_wait_sec, execution_sec, download_sec, reupload_sec, form_snapshot
FROM flux_kontext_edit_jobs;
DROP TABLE flux_kontext_edit_jobs;
ALTER TABLE flux_kontext_edit_jobs_new RENAME TO flux_kontext_edit_jobs;
CREATE INDEX flux_kontext_edit_jobs_user_created_at ON flux_kontext_edit_jobs (user_id, created_at DESC);

CREATE TABLE repaint_jobs_new (
	id TEXT PRIMARY KEY NOT NULL,
	user_id TEXT NOT NULL REFERENCES users (id),
	comfy_prompt_id TEXT NOT NULL UNIQUE,
	scene_media_id INTEGER NOT NULL REFERENCES media (id),
	session_id TEXT REFERENCES project_sessions (id),
	target TEXT NOT NULL,
	color TEXT NOT NULL CHECK (length(color) = 7 AND color GLOB '#[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]'),
	cost REAL NOT NULL CHECK (cost >= 0),
	balance_after REAL,
	status TEXT NOT NULL CHECK (status IN ('processing', 'completed', 'failed')),
	output_media_id INTEGER REFERENCES media (id),
	error_code TEXT,
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
		(status = 'processing' AND balance_after IS NULL AND output_media_id IS NULL AND error_code IS NULL AND completed_at IS NULL)
		OR (status = 'completed' AND balance_after IS NOT NULL AND output_media_id IS NOT NULL AND error_code IS NULL AND completed_at IS NOT NULL)
		OR (status = 'failed' AND balance_after IS NULL AND output_media_id IS NULL AND error_code IS NOT NULL AND completed_at IS NOT NULL)
	)
);
INSERT INTO repaint_jobs_new (
	id, user_id, comfy_prompt_id, scene_media_id, session_id, target, color, cost, balance_after, status,
	output_media_id, error_code, created_at, updated_at, completed_at, upload_queue_sec,
	queue_wait_sec, execution_sec, download_sec, reupload_sec, form_snapshot
)
SELECT id, user_id, comfy_prompt_id, scene_media_id, session_id, target, color, cost, balance_after, status,
	output_media_id, error_code, created_at, updated_at, completed_at, upload_queue_sec,
	queue_wait_sec, execution_sec, download_sec, reupload_sec, form_snapshot
FROM repaint_jobs;
DROP TABLE repaint_jobs;
ALTER TABLE repaint_jobs_new RENAME TO repaint_jobs;
CREATE INDEX repaint_jobs_user_created_at ON repaint_jobs (user_id, created_at DESC);

DROP TABLE _ledger_ordered_events;
DROP TABLE _ledger_events;
DROP TABLE _ledger_operations;
DROP TABLE _ledger_completed_jobs;
DROP TABLE _ledger_guard;
