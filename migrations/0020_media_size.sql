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

-- Persists the byte size of each stored object, measured server-side when the
-- bytes are written. NULL means the size is unknown: rows written before this
-- column existed, and objects that are not held in our storage (dev mocks).
-- Deliberately not DEFAULT 0, so an unknown size is never read as an empty file.
ALTER TABLE media ADD COLUMN size INTEGER CHECK (size IS NULL OR size >= 0);
