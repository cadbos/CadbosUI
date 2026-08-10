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

import type { RequestEvent } from '@sveltejs/kit';

const MANIFEST_PATH = '/_app/client-integrity.json';
const MANIFEST_FETCH_TIMEOUT_MS = 5_000;
const ASSET_PATH_PATTERN = /^\/_app\/immutable\/.+\.(?:css|js)$/;
const SHA384_PATTERN = /^sha384-[A-Za-z0-9+/]{64}$/;
const RESOURCE_TAG_PATTERN = /<(?:link|script)\b[^>]*>/gi;
const RESOURCE_URL_PATTERN = /\s(?:href|src)=(['"])(.*?)\1/i;

export type ClientIntegrityManifest = Readonly<Record<string, string>>;

let manifestPromise: Promise<ClientIntegrityManifest> | undefined;

export function validateClientIntegrityManifest(value: unknown): ClientIntegrityManifest {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error('Client integrity manifest must be an object');
	}

	const entries = Object.entries(value);
	if (entries.length === 0) throw new Error('Client integrity manifest must not be empty');

	const manifest: Record<string, string> = {};
	for (const [path, integrity] of entries) {
		if (!ASSET_PATH_PATTERN.test(path)) {
			throw new Error('Client integrity manifest contains an invalid asset path');
		}
		if (typeof integrity !== 'string' || !SHA384_PATTERN.test(integrity)) {
			throw new Error('Client integrity manifest contains an invalid SHA-384 value');
		}
		manifest[path] = integrity;
	}

	return Object.freeze(manifest);
}

export function addIntegrityToHtml(
	html: string,
	pageUrl: URL,
	manifest: ClientIntegrityManifest
): string {
	return html.replace(RESOURCE_TAG_PATTERN, (tag) => {
		const resourceUrl = tag.match(RESOURCE_URL_PATTERN)?.[2];
		if (!resourceUrl || /\sintegrity=/i.test(tag)) return tag;

		const integrity = integrityForUrl(resourceUrl, pageUrl, manifest);
		if (!integrity) return tag;

		return tag.replace(/\s*\/?>$/, (ending) => {
			const close = ending.trimStart();
			return ` integrity="${integrity}" crossorigin="anonymous"${close}`;
		});
	});
}

export function addIntegrityToLinkHeader(
	header: string,
	pageUrl: URL,
	manifest: ClientIntegrityManifest
): string {
	return splitLinkHeader(header)
		.map((entry) => {
			if (/;\s*integrity=/i.test(entry)) return entry;

			const resourceUrl = entry.match(/^\s*<([^>]+)>/)?.[1];
			if (!resourceUrl) return entry;

			const integrity = integrityForUrl(resourceUrl, pageUrl, manifest);
			if (!integrity) return entry;

			return `${entry}; integrity="${integrity}"; crossorigin="anonymous"`;
		})
		.join(', ');
}

export function getClientIntegrityManifest(event: RequestEvent): Promise<ClientIntegrityManifest> {
	manifestPromise ??= fetchClientIntegrityManifest(event).catch((error: unknown) => {
		manifestPromise = undefined;
		throw error;
	});
	return manifestPromise;
}

async function fetchClientIntegrityManifest(event: RequestEvent): Promise<ClientIntegrityManifest> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), MANIFEST_FETCH_TIMEOUT_MS);
	try {
		const assetFetcher = event.platform?.env.ASSETS;
		const fetcher = assetFetcher
			? (assetFetcher.fetch.bind(assetFetcher) as unknown as typeof event.fetch)
			: event.fetch;
		const resource = assetFetcher ? new URL(MANIFEST_PATH, event.url).toString() : MANIFEST_PATH;
		const response = await fetcher(resource, { signal: controller.signal });

		if (!response.ok) {
			throw new Error(`Client integrity manifest request failed with status ${response.status}`);
		}

		let value: unknown;
		try {
			value = await response.json();
		} catch (error) {
			throw new Error('Client integrity manifest is not valid JSON', { cause: error });
		}

		return validateClientIntegrityManifest(value);
	} finally {
		clearTimeout(timeout);
	}
}

function integrityForUrl(
	resourceUrl: string,
	pageUrl: URL,
	manifest: ClientIntegrityManifest
): string | undefined {
	const resolved = new URL(resourceUrl, pageUrl);
	if (resolved.origin !== pageUrl.origin) return undefined;
	return manifest[resolved.pathname];
}

function splitLinkHeader(header: string): string[] {
	const entries: string[] = [];
	let start = 0;
	let quoted = false;
	let angled = false;
	let escaped = false;

	for (let index = 0; index < header.length; index += 1) {
		const character = header[index];
		if (escaped) {
			escaped = false;
			continue;
		}
		if (quoted && character === '\\') {
			escaped = true;
			continue;
		}
		if (character === '"') quoted = !quoted;
		if (!quoted && character === '<') angled = true;
		if (!quoted && character === '>') angled = false;
		if (!quoted && !angled && character === ',') {
			entries.push(header.slice(start, index).trim());
			start = index + 1;
		}
	}

	entries.push(header.slice(start).trim());
	return entries;
}
