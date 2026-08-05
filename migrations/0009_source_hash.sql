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

-- Content hash (SHA-256 hex) of the uploaded source image, captured at upload
-- time so a repeat upload of the same photo can reuse the existing R2 object
-- instead of duplicating it. `DEFAULT ''` only satisfies the NOT NULL backfill
-- for rows written before this migration — those rows never had a hash
-- computed, so '' deliberately can never collide with a real 64-char SHA-256
-- hex digest. Readers must not GROUP BY source_hash directly, since every
-- pre-migration row shares the same '' value; see listDistinctSourceImages().
ALTER TABLE generations ADD COLUMN source_hash TEXT NOT NULL DEFAULT '';

CREATE INDEX generations_user_source_hash ON generations (user_id, source_hash);

-- Same hash, carried on the job row from submission through to completion so
-- completeObjectReplacementJob can copy it into generations.source_hash.
ALTER TABLE object_replacement_jobs ADD COLUMN scene_hash TEXT NOT NULL DEFAULT '';

ALTER TABLE texture_replacement_jobs ADD COLUMN scene_hash TEXT NOT NULL DEFAULT '';
