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

import { dev } from '$app/environment';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { SessionUser } from '$lib/api/contract';
import { apiError } from '$lib/server/api';
import { getDb } from '$lib/server/db';
import { DEMO_PUBKEY } from '$lib/server/demo';

export async function authorizeUsageViewer(
	platform: App.Platform | undefined,
	user: SessionUser
): Promise<Response | null> {
	if (dev && user.pubkey === DEMO_PUBKEY) {
		return apiError(500, 'account_error', 'Account record not found');
	}
	const admin = await getDb(platform).get<{ found: number }>(
		sql`SELECT 1 AS found FROM admins a JOIN users u ON u.id = a.user_id WHERE u.pubkey = ${user.pubkey}`
	);
	return admin ? null : apiError(403, 'forbidden', 'Admin access required');
}

// A day's usage arrives as the viewer's local-day bounds in epoch milliseconds,
// so the server never has to guess the viewer's time zone.
export const usageRangeShape = {
	from: z.coerce.number().int().min(0),
	to: z.coerce.number().int().min(1)
};

export function isOrderedRange(range: { from: number; to: number }): boolean {
	return range.to > range.from;
}

// The UTC day that Cloudflare's analytics counters are queried for; today when omitted.
export const analyticsDateParamsSchema = z.strictObject({ date: z.iso.date().optional() });
