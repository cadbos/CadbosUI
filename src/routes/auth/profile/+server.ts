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
import type { RequestHandler } from './$types';
import { apiError, parseBody, profileUpdateRequestSchema } from '$lib/server/api';
import { getDb, updateUserProfile } from '$lib/server/auth/repository';

export const PATCH: RequestHandler = async ({ request, platform, locals }) => {
	if (!locals.user) return apiError(401, 'unauthorized', 'Authentication required');

	const parsed = await parseBody(request, profileUpdateRequestSchema);
	if (!parsed.ok) return parsed.response;

	const user = await updateUserProfile(
		getDb(platform),
		locals.user.pubkey,
		parsed.data.firstName,
		parsed.data.lastName
	);

	return json({ user });
};
