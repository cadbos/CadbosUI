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

import type { RequestHandler } from './$types';
import { SESSION_COOKIE } from '$lib/server/auth/config';
import { deleteSession, getDb } from '$lib/server/auth/repository';
import { clearSessionCookie } from '$lib/server/auth/session';

export const POST: RequestHandler = async ({ platform, cookies, locals }) => {
	const sessionId = cookies.get(SESSION_COOKIE);
	if (locals.user && sessionId) await deleteSession(getDb(platform), sessionId);
	clearSessionCookie(cookies);
	return new Response(null, { status: 204 });
};
