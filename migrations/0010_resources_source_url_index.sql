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

-- Serves listDistinctSourceImages' WHERE user_id = ? GROUP BY source_url
-- ORDER BY created_at DESC (the /api/resources gallery query) — the
-- generations_user_source_hash index from 0009 doesn't help it since it
-- groups/orders on source_url, not source_hash.
CREATE INDEX generations_user_source_url ON generations (user_id, source_url, created_at);
