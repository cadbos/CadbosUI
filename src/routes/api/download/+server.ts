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

import { error } from '@sveltejs/kit';
import { imageExtensionFromMime } from '$lib/server/image-utils';
import type { RequestHandler } from './$types';

// Forces a real download of a render/edit result hosted on archAI's external
// CDN. Browsers only honor the <a download> attribute for same-origin links —
// for a cross-origin archAI URL it just navigates away from the page instead,
// discarding all client-side form state. Re-serving the image from our own
// origin with Content-Disposition: attachment sidesteps that entirely.
//
// Session is enforced centrally in hooks.server.ts (guardedPaths). Render/edit
// results aren't persisted server-side (post-MVP), so there's no server-side
// record to validate the URL against — only https and an image/* response are
// required, which keeps this from being usable as an open fetch-any-URL proxy.
export const GET: RequestHandler = async ({ url, fetch }) => {
	const target = url.searchParams.get('url');
	if (!target) throw error(400, 'Missing url parameter');

	let parsed: URL;
	try {
		parsed = new URL(target);
	} catch {
		throw error(400, 'Invalid url parameter');
	}
	if (parsed.protocol !== 'https:') throw error(400, 'Only https URLs are supported');

	const requestedFilename = url.searchParams.get('filename') || 'render';

	let upstream: Response;
	try {
		upstream = await fetch(parsed);
	} catch {
		throw error(502, 'Failed to fetch the image');
	}
	if (!upstream.ok || !upstream.body) throw error(502, 'Failed to fetch the image');

	const contentType = upstream.headers.get('content-type') ?? '';
	if (!contentType.startsWith('image/')) throw error(502, 'Unexpected content type');
	const extension = imageExtensionFromMime(contentType);
	const filename =
		extension && !hasExtension(requestedFilename)
			? `${requestedFilename}.${extension}`
			: requestedFilename;

	return new Response(upstream.body, {
		headers: {
			'content-type': contentType,
			'content-disposition': `attachment; filename="${contentDispositionFilename(filename)}"`,
			'cache-control': 'private, no-store'
		}
	});
};

function hasExtension(filename: string): boolean {
	return /\.[a-z0-9]+$/i.test(filename);
}

function contentDispositionFilename(filename: string): string {
	let escaped = '';
	for (let index = 0; index < filename.length; index += 1) {
		const character = filename[index];
		const characterCode = character.charCodeAt(0);
		if (characterCode < 0x20 || characterCode === 0x7f) {
			escaped += '_';
		} else if (character === '"' || character === '\\') {
			escaped += `\\${character}`;
		} else {
			escaped += character;
		}
	}
	return escaped;
}
