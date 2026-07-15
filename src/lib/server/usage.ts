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
import type { D1Database } from '@cloudflare/workers-types';
import type { SessionUser } from '$lib/api/contract';
import { apiError } from '$lib/server/api';
import { getDb } from '$lib/server/auth/repository';
import { getUserIdByPubkey } from '$lib/server/billing';
import { DEMO_PUBKEY } from '$lib/server/demo';

export async function getUsageViewerDb(
	platform: App.Platform | undefined,
	pubkey: string
): Promise<D1Database | Response> {
	const db = getDb(platform);
	const userId = await getUserIdByPubkey(db, pubkey);
	return userId ? db : apiError(500, 'account_error', 'Account record not found');
}

export function authorizeUsageViewer(
	platform: App.Platform | undefined,
	user: SessionUser
): Response | null {
	if (!isAdminPubkey(user.pubkey, platform?.env?.ADMIN_PUBKEYS)) {
		return apiError(403, 'forbidden', 'Admin access required');
	}
	if (dev && user.pubkey === DEMO_PUBKEY) {
		return apiError(500, 'account_error', 'Account record not found');
	}
	return null;
}

function isAdminPubkey(pubkey: string, adminPubkeys: string | undefined): boolean {
	return (
		adminPubkeys
			?.split(',')
			.map((adminPubkey) => adminPubkey.trim())
			.includes(pubkey) ?? false
	);
}
