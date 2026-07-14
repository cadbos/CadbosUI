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

import { normalizeImageContentType, type ImageMime } from '$lib/server/image-utils';
import { uploadImageBytes } from '$lib/server/uploads';

export const MAX_IMAGE_UPLOAD_SIZE = 8 * 1024 * 1024;

const REMOTE_IMAGE_FETCH_TIMEOUT_MS = 30_000;
const MAX_REDIRECTS = 3;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const BLOCKED_HOSTNAME_SUFFIXES = ['.localhost', '.local', '.internal', '.home', '.lan'];

export type RemoteImageImportErrorCode =
	| 'invalid_url'
	| 'unsupported_image_type'
	| 'image_too_large'
	| 'remote_fetch_failed';

export class RemoteImageImportError extends Error {
	readonly code: RemoteImageImportErrorCode;

	constructor(code: RemoteImageImportErrorCode) {
		super(code);
		this.name = 'RemoteImageImportError';
		this.code = code;
	}
}

function isIpLiteral(hostname: string): boolean {
	return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname) || hostname.includes(':');
}

function isBlockedHostname(hostname: string): boolean {
	return (
		hostname === 'localhost' ||
		BLOCKED_HOSTNAME_SUFFIXES.some((suffix) => hostname.endsWith(suffix)) ||
		isIpLiteral(hostname)
	);
}

export function validateRemoteImageUrl(value: string, applicationOrigin: string): URL {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new RemoteImageImportError('invalid_url');
	}

	// String-based hostname checks do not prevent DNS rebinding. This is acceptable while the
	// Worker has no VPC Service binding; revisit if network bindings are introduced.
	const hostname = url.hostname.toLowerCase().replace(/\.+$/, '');
	if (
		url.protocol !== 'https:' ||
		url.username ||
		url.password ||
		(url.port !== '' && url.port !== '443') ||
		url.origin === applicationOrigin ||
		isBlockedHostname(hostname)
	) {
		throw new RemoteImageImportError('invalid_url');
	}

	return url;
}

function errorKind(error: unknown): string {
	return error instanceof Error ? error.name : typeof error;
}

async function cancelBody(response: Response): Promise<void> {
	if (!response.body) return;
	try {
		await response.body.cancel();
	} catch (error) {
		console.error('Remote image response cancellation failed:', errorKind(error));
	}
}

async function fetchRemoteImage(
	initialUrl: URL,
	applicationOrigin: string,
	fetcher: typeof fetch
): Promise<Response> {
	let url = initialUrl;
	const signal = AbortSignal.timeout(REMOTE_IMAGE_FETCH_TIMEOUT_MS);

	for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
		let response: Response;
		try {
			response = await fetcher(url, {
				headers: { accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif' },
				redirect: 'manual',
				signal
			});
		} catch (error) {
			console.error('Remote image fetch failed:', errorKind(error));
			throw new RemoteImageImportError('remote_fetch_failed');
		}

		if (!REDIRECT_STATUSES.has(response.status)) {
			if (!response.ok) {
				await cancelBody(response);
				throw new RemoteImageImportError('remote_fetch_failed');
			}
			return response;
		}

		await cancelBody(response);
		if (redirects === MAX_REDIRECTS) throw new RemoteImageImportError('remote_fetch_failed');

		const location = response.headers.get('location');
		if (!location) throw new RemoteImageImportError('remote_fetch_failed');

		try {
			url = validateRemoteImageUrl(new URL(location, url).toString(), applicationOrigin);
		} catch (error) {
			if (error instanceof RemoteImageImportError) throw error;
			console.error('Remote image redirect validation failed:', errorKind(error));
			throw new RemoteImageImportError('remote_fetch_failed');
		}
	}

	throw new RemoteImageImportError('remote_fetch_failed');
}

async function readImageBody(response: Response): Promise<ArrayBuffer> {
	const contentLength = response.headers.get('content-length');
	if (contentLength !== null && Number(contentLength) > MAX_IMAGE_UPLOAD_SIZE) {
		await cancelBody(response);
		throw new RemoteImageImportError('image_too_large');
	}
	if (!response.body) throw new RemoteImageImportError('remote_fetch_failed');

	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let totalSize = 0;

	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			if (!value) continue;

			totalSize += value.byteLength;
			if (totalSize > MAX_IMAGE_UPLOAD_SIZE) {
				try {
					await reader.cancel();
				} catch (error) {
					console.error('Remote image body cancellation failed:', errorKind(error));
				}
				throw new RemoteImageImportError('image_too_large');
			}
			chunks.push(value);
		}
	} catch (error) {
		if (error instanceof RemoteImageImportError) throw error;
		console.error('Remote image body read failed:', errorKind(error));
		throw new RemoteImageImportError('remote_fetch_failed');
	} finally {
		reader.releaseLock();
	}

	if (totalSize === 0) throw new RemoteImageImportError('remote_fetch_failed');

	const bytes = new Uint8Array(totalSize);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return bytes.buffer;
}

export async function importRemoteImage(
	platform: App.Platform | undefined,
	value: string,
	applicationOrigin: string,
	fetcher: typeof fetch = globalThis.fetch
): Promise<{ url: string; mime: ImageMime; size: number; dimensions?: [number, number] }> {
	const url = validateRemoteImageUrl(value, applicationOrigin);
	const response = await fetchRemoteImage(url, applicationOrigin, fetcher);
	const mime = normalizeImageContentType(response.headers.get('content-type'));
	if (mime === null) {
		await cancelBody(response);
		throw new RemoteImageImportError('unsupported_image_type');
	}

	const bytes = await readImageBody(response);
	return uploadImageBytes(platform, bytes, mime);
}
