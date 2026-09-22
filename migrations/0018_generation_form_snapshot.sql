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

-- Persists the full form settings (RequestFormSnapshot, JSON-encoded) that
-- produced a generation, so it can be reopened later and its exact settings
-- restored — not just its prompt. NULL for rows written before this column
-- existed, and for `upscale` (no user-adjustable form settings to restore).
ALTER TABLE generations ADD COLUMN form_snapshot TEXT;

-- The async job tables capture the snapshot at submission time (when the
-- client's form state is still available) and carry it through to
-- `generations` on completion, the same way each job's own settings columns
-- (e.g. `replacement_object`) already do.
ALTER TABLE object_replacement_jobs ADD COLUMN form_snapshot TEXT;
ALTER TABLE texture_replacement_jobs ADD COLUMN form_snapshot TEXT;
ALTER TABLE light_settings_jobs ADD COLUMN form_snapshot TEXT;
ALTER TABLE flux_kontext_edit_jobs ADD COLUMN form_snapshot TEXT;
