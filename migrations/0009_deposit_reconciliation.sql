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

ALTER TABLE deposits ADD COLUMN provider_checked_at INTEGER;
ALTER TABLE deposits ADD COLUMN reconcile_after INTEGER;

UPDATE deposits
SET reconcile_after = created_at
WHERE status IN ('pending', 'expired', 'failed');

CREATE INDEX deposits_reconcile_after
	ON deposits (reconcile_after, created_at)
	WHERE reconcile_after IS NOT NULL;
