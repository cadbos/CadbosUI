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

// Minimal D1-backed fixed-window rate limiter for the auth endpoints. The count is
// incremented atomically in a single upsert so concurrent requests can't undercount.

import { sql } from 'drizzle-orm';
import type { Database } from '$lib/server/db';

interface Window {
	windowMs: number;
	max: number;
}

// Returns true when the bucket is over its limit for the current window.
export async function touchRateLimit(
	db: Database,
	bucket: string,
	now: number,
	{ windowMs, max }: Window
): Promise<boolean> {
	const resetAt = now + windowMs;
	const row = await db.get<{ count: number }>(
		sql`INSERT INTO rate_limits (bucket, count, reset_at) VALUES (${bucket}, 1, ${resetAt})
			ON CONFLICT(bucket) DO UPDATE SET
			count = CASE WHEN reset_at <= ${now} THEN 1 ELSE count + 1 END,
			reset_at = CASE WHEN reset_at <= ${now} THEN ${resetAt} ELSE reset_at END
			RETURNING count`
	);
	return (row?.count ?? 0) > max;
}
