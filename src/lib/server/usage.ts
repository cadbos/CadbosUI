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
