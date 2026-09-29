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

-- The reference image a generation was made with — a custom style
-- reference (style-transfer), the new object (object-replacement) or the
-- texture (texture-replacement). NULL for every other kind, and for a style
-- transfer that used a built-in preset rather than an uploaded image. Lets
-- the Resources gallery list the user's references next to their source
-- photos with one indexed query instead of digging through job tables and
-- form_snapshot JSON.
ALTER TABLE generations ADD COLUMN reference_media_id INTEGER REFERENCES media (id);

-- A completed replacement job's generation row shares the job's id (see
-- object-replacement-jobs.ts / texture-replacement-jobs.ts), so its
-- reference comes straight from the job.
UPDATE generations
SET reference_media_id = (
	SELECT j.reference_media_id FROM object_replacement_jobs j WHERE j.id = generations.id
)
WHERE kind = 'object-replacement';

UPDATE generations
SET reference_media_id = (
	SELECT j.reference_media_id FROM texture_replacement_jobs j WHERE j.id = generations.id
)
WHERE kind = 'texture-replacement';

-- A style transfer's custom reference was only ever kept inside
-- form_snapshot (migrations/0018), as a media key: the bucket name
-- (URI-encoded) + '/' + filename (see $lib/server/media's mediaKey). The key
-- is split at its first '/' so the lookup goes through media's
-- UNIQUE (bucket, filename) index instead of comparing every media row.
-- The key's bucket part is URI-encoded, so each bucket name is encoded the
-- same way before comparing. Bucket names are either S3 names (lowercase
-- letters, digits, '.' and '-', which encoding leaves as is) or, for media
-- migrations/0015 moved over from plain URLs, 'external:' + a URL origin —
-- whose only characters encodeURIComponent changes are ':' and '/' ('%'
-- first, so the escapes themselves aren't re-escaped). buckets is a handful
-- of rows, so encoding its names costs nothing; the media lookup itself
-- still goes through its index. Style transfers recorded before
-- form_snapshot existed carry no reference to recover and stay NULL.
--
-- json_extract() raises on malformed JSON, and SQLite doesn't promise to
-- evaluate AND operands left to right, so every read of form_snapshot goes
-- through a CASE on json_valid() — a malformed row (parseStoredFormSnapshot
-- already tolerates those) stays NULL instead of failing the migration.
UPDATE generations
SET reference_media_id = (
	SELECT m.id FROM buckets b
	JOIN media m ON m.bucket = b.id
	WHERE replace(replace(replace(b.name, '%', '%25'), ':', '%3A'), '/', '%2F') = substr(
			CASE WHEN json_valid(generations.form_snapshot)
				THEN json_extract(generations.form_snapshot, '$.styleReferenceImage.mediaKey') END,
			1,
			instr(
				CASE WHEN json_valid(generations.form_snapshot)
					THEN json_extract(generations.form_snapshot, '$.styleReferenceImage.mediaKey') END,
				'/'
			) - 1
		)
		AND m.filename = substr(
			CASE WHEN json_valid(generations.form_snapshot)
				THEN json_extract(generations.form_snapshot, '$.styleReferenceImage.mediaKey') END,
			instr(
				CASE WHEN json_valid(generations.form_snapshot)
					THEN json_extract(generations.form_snapshot, '$.styleReferenceImage.mediaKey') END,
				'/'
			) + 1
		)
	ORDER BY m.id
	LIMIT 1
)
WHERE kind = 'style-transfer'
	AND CASE WHEN json_valid(form_snapshot)
		THEN json_extract(form_snapshot, '$.styleReferenceImage.mediaKey') END IS NOT NULL;

CREATE INDEX generations_user_reference
	ON generations (user_id, reference_media_id, created_at);
