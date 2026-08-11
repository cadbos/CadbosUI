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

-- "Delete" for projects/sessions is a soft archive, not a row delete: generations
-- (and object/texture replacement jobs) reference project_sessions, and those rows
-- are real billed history that must survive a user tidying up their project list.
-- `archived_at IS NULL` means visible; there is no restore UI in v1 (same
-- no-expiry-column precedent as project_shares in migration 0011) — archiving is
-- final from the product's perspective even though the data itself is retained.
ALTER TABLE projects ADD COLUMN archived_at INTEGER;

ALTER TABLE project_sessions ADD COLUMN archived_at INTEGER;
