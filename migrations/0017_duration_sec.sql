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

-- Tracks how long each stage of generation/job processing took, in whole
-- seconds. Backfilled to 0 for all pre-existing rows, which predate duration
-- tracking, and for whichever provider's columns don't apply to a given row.

-- generations is shared by both providers, so each provider's breakdown is
-- prefixed to keep them apart in the same row.
ALTER TABLE generations ADD COLUMN comfyui_upload_queue_sec INTEGER NOT NULL DEFAULT 0 CHECK (comfyui_upload_queue_sec >= 0);
ALTER TABLE generations ADD COLUMN comfyui_queue_wait_sec INTEGER NOT NULL DEFAULT 0 CHECK (comfyui_queue_wait_sec >= 0);
ALTER TABLE generations ADD COLUMN comfyui_execution_sec INTEGER NOT NULL DEFAULT 0 CHECK (comfyui_execution_sec >= 0);
ALTER TABLE generations ADD COLUMN comfyui_download_sec INTEGER NOT NULL DEFAULT 0 CHECK (comfyui_download_sec >= 0);
ALTER TABLE generations ADD COLUMN comfyui_reupload_sec INTEGER NOT NULL DEFAULT 0 CHECK (comfyui_reupload_sec >= 0);
ALTER TABLE generations ADD COLUMN archai_render_sec INTEGER NOT NULL DEFAULT 0 CHECK (archai_render_sec >= 0);
ALTER TABLE generations ADD COLUMN archai_download_sec INTEGER NOT NULL DEFAULT 0 CHECK (archai_download_sec >= 0);
ALTER TABLE generations ADD COLUMN archai_reupload_sec INTEGER NOT NULL DEFAULT 0 CHECK (archai_reupload_sec >= 0);

-- ComfyUI job tables are already scoped to ComfyUI by their table name, so
-- their breakdown columns are unprefixed.
ALTER TABLE object_replacement_jobs ADD COLUMN upload_queue_sec INTEGER NOT NULL DEFAULT 0 CHECK (upload_queue_sec >= 0);
ALTER TABLE object_replacement_jobs ADD COLUMN queue_wait_sec INTEGER NOT NULL DEFAULT 0 CHECK (queue_wait_sec >= 0);
ALTER TABLE object_replacement_jobs ADD COLUMN execution_sec INTEGER NOT NULL DEFAULT 0 CHECK (execution_sec >= 0);
ALTER TABLE object_replacement_jobs ADD COLUMN download_sec INTEGER NOT NULL DEFAULT 0 CHECK (download_sec >= 0);
ALTER TABLE object_replacement_jobs ADD COLUMN reupload_sec INTEGER NOT NULL DEFAULT 0 CHECK (reupload_sec >= 0);

ALTER TABLE texture_replacement_jobs ADD COLUMN upload_queue_sec INTEGER NOT NULL DEFAULT 0 CHECK (upload_queue_sec >= 0);
ALTER TABLE texture_replacement_jobs ADD COLUMN queue_wait_sec INTEGER NOT NULL DEFAULT 0 CHECK (queue_wait_sec >= 0);
ALTER TABLE texture_replacement_jobs ADD COLUMN execution_sec INTEGER NOT NULL DEFAULT 0 CHECK (execution_sec >= 0);
ALTER TABLE texture_replacement_jobs ADD COLUMN download_sec INTEGER NOT NULL DEFAULT 0 CHECK (download_sec >= 0);
ALTER TABLE texture_replacement_jobs ADD COLUMN reupload_sec INTEGER NOT NULL DEFAULT 0 CHECK (reupload_sec >= 0);

ALTER TABLE light_settings_jobs ADD COLUMN upload_queue_sec INTEGER NOT NULL DEFAULT 0 CHECK (upload_queue_sec >= 0);
ALTER TABLE light_settings_jobs ADD COLUMN queue_wait_sec INTEGER NOT NULL DEFAULT 0 CHECK (queue_wait_sec >= 0);
ALTER TABLE light_settings_jobs ADD COLUMN execution_sec INTEGER NOT NULL DEFAULT 0 CHECK (execution_sec >= 0);
ALTER TABLE light_settings_jobs ADD COLUMN download_sec INTEGER NOT NULL DEFAULT 0 CHECK (download_sec >= 0);
ALTER TABLE light_settings_jobs ADD COLUMN reupload_sec INTEGER NOT NULL DEFAULT 0 CHECK (reupload_sec >= 0);

ALTER TABLE flux_kontext_edit_jobs ADD COLUMN upload_queue_sec INTEGER NOT NULL DEFAULT 0 CHECK (upload_queue_sec >= 0);
ALTER TABLE flux_kontext_edit_jobs ADD COLUMN queue_wait_sec INTEGER NOT NULL DEFAULT 0 CHECK (queue_wait_sec >= 0);
ALTER TABLE flux_kontext_edit_jobs ADD COLUMN execution_sec INTEGER NOT NULL DEFAULT 0 CHECK (execution_sec >= 0);
ALTER TABLE flux_kontext_edit_jobs ADD COLUMN download_sec INTEGER NOT NULL DEFAULT 0 CHECK (download_sec >= 0);
ALTER TABLE flux_kontext_edit_jobs ADD COLUMN reupload_sec INTEGER NOT NULL DEFAULT 0 CHECK (reupload_sec >= 0);
