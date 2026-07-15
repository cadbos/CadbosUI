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

import { json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import type { UsageProfile, UsageProfilesResponse } from '$lib/api/contract';
import { apiError, parseBody } from '$lib/server/api';
import { fetchNostrProfile } from '$lib/nostr/profile';
import { authorizeUsageViewer, getUsageViewerDb } from '$lib/server/usage';

const usageProfilesRequestSchema = z.object({
	pubkeys: z
		.array(z.string().regex(/^[0-9a-f]{64}$/))
		.min(1)
		.max(20)
});

export const POST: RequestHandler = async ({ request, platform, locals }) => {
	const user = locals.user;
	if (!user) return apiError(401, 'unauthorized', 'Authentication required');

	const authorization = authorizeUsageViewer(platform, user);
	if (authorization) return authorization;

	const parsed = await parseBody(request, usageProfilesRequestSchema);
	if (!parsed.ok) return parsed.response;

	const viewerDb = await getUsageViewerDb(platform, user.pubkey);
	if (viewerDb instanceof Response) return viewerDb;

	const pubkeys = [...new Set(parsed.data.pubkeys)];
	const resolved = await Promise.all(
		pubkeys.map(async (pubkey) => {
			const profile = await fetchNostrProfile(pubkey);
			const summary: UsageProfile = {
				...(profile.name ? { name: profile.name } : {}),
				...(profile.picture ? { picture: profile.picture } : {})
			};
			return [pubkey, summary] as const;
		})
	);

	return json({ profiles: Object.fromEntries(resolved) } satisfies UsageProfilesResponse);
};
