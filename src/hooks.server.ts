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
import type { Handle } from '@sveltejs/kit';
import { defaultLocale, t } from '$lib/i18n/index.svelte';
import { SESSION_COOKIE } from '$lib/server/auth/config';
import { findValidSession, getDb } from '$lib/server/auth/repository';
import { clearSessionCookie } from '$lib/server/auth/session';
import {
	addIntegrityToHtml,
	addIntegrityToLinkHeader,
	getClientIntegrityManifest,
	type ClientIntegrityManifest
} from '$lib/server/client-integrity';
import { DEMO_SESSION_ID, DEMO_USER } from '$lib/server/demo';

const securityHeaders: Record<string, string> = {
	'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
	'X-Content-Type-Options': 'nosniff',
	'X-Frame-Options': 'DENY',
	'Referrer-Policy': 'strict-origin-when-cross-origin',
	'Permissions-Policy': 'camera=(), microphone=(), geolocation=()'
};

export const handle: Handle = async ({ event, resolve }) => {
	const sessionId = event.cookies.get(SESSION_COOKIE);
	event.locals.sessionLookupUnavailable = false;

	// Demo bypass: in dev mode a special session cookie skips D1 entirely so the
	// showcase branch works without a local D1 database being configured.
	if (dev && sessionId === DEMO_SESSION_ID) {
		event.locals.user = DEMO_USER;
	} else if (sessionId) {
		try {
			event.locals.user = await findValidSession(getDb(event.platform), sessionId, Date.now());
		} catch (error) {
			event.locals.sessionLookupUnavailable = true;
			event.locals.user = null;
			console.error(
				JSON.stringify({
					level: 'error',
					area: 'auth',
					event: 'session_lookup_error',
					method: event.request.method,
					route: event.route.id,
					message: safeErrorMessage(error, 'Unknown session lookup error').replaceAll(
						sessionId,
						'[redacted]'
					)
				})
			);
		}
		if (!event.locals.sessionLookupUnavailable && !event.locals.user) {
			clearSessionCookie(event.cookies);
		}
	} else {
		event.locals.user = null;
	}

	let integrityManifest: ClientIntegrityManifest | undefined;
	let integrityState: 'disabled' | 'enabled' | 'failed' = dev ? 'disabled' : 'enabled';

	const response = await resolve(event, {
		transformPageChunk: async ({ html }) => {
			if (!dev) {
				try {
					integrityManifest = await getClientIntegrityManifest(event);
				} catch (error) {
					integrityState = 'failed';
					console.error(
						JSON.stringify({
							event: 'client_integrity_manifest_error',
							message: safeErrorMessage(error)
						})
					);
				}
			}

			const translated = translateAppTemplate(html, integrityState);
			return integrityManifest
				? addIntegrityToHtml(translated, event.url, integrityManifest)
				: translated;
		}
	});

	if (event.locals.sessionLookupUnavailable) response.headers.set('Cache-Control', 'no-store');

	const linkHeader = response.headers.get('link');
	if (linkHeader && integrityManifest) {
		response.headers.set(
			'link',
			addIntegrityToLinkHeader(linkHeader, event.url, integrityManifest)
		);
	}

	for (const [name, value] of Object.entries(securityHeaders)) {
		response.headers.set(name, value);
	}

	return response;
};

function translateAppTemplate(
	html: string,
	integrityState: 'disabled' | 'enabled' | 'failed'
): string {
	return html
		.replace('%lang%', defaultLocale)
		.replace('%client.integrityState%', integrityState)
		.replace('%client.loading%', escapeHtml(t('clientLoad.loading')))
		.replace('%client.failed%', escapeHtml(t('clientLoad.failed')))
		.replace('%client.refresh%', escapeHtml(t('clientLoad.refresh')))
		.replace('%client.javascriptRequired%', escapeHtml(t('clientLoad.javascriptRequired')));
}

function escapeHtml(value: string): string {
	return value.replace(/[&<>"']/g, (character) => {
		const entities: Record<string, string> = {
			'&': '&amp;',
			'<': '&lt;',
			'>': '&gt;',
			'"': '&quot;',
			"'": '&#39;'
		};
		return entities[character];
	});
}

function safeErrorMessage(
	error: unknown,
	defaultMessage: string = 'Unknown client integrity error'
): string {
	return error instanceof Error ? error.message : defaultMessage;
}
