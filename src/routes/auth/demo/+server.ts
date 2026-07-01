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
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { SESSION_COOKIE } from '$lib/server/auth/config';
import { DEMO_SESSION_ID, DEMO_USER } from '$lib/server/demo';

// Demo-only login — available only in development builds (demo/showcase branch).
// Sets a fixed session cookie that hooks.server.ts recognises without D1.
export const POST: RequestHandler = ({ cookies }) => {
	if (!dev) return new Response(null, { status: 404 });

	cookies.set(SESSION_COOKIE, DEMO_SESSION_ID, {
		path: '/',
		httpOnly: true,
		secure: false,
		sameSite: 'lax'
	});

	return json({ user: DEMO_USER });
};
