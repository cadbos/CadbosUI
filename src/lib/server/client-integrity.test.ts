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

import { describe, expect, it } from 'vitest';
import {
	addIntegrityToHtml,
	addIntegrityToLinkHeader,
	validateClientIntegrityManifest
} from '$lib/server/client-integrity';

const integrity = `sha384-${'a'.repeat(64)}`;
const manifest = validateClientIntegrityManifest({
	'/_app/immutable/app.js': integrity,
	'/_app/immutable/app.css': integrity
});
const pageUrl = new URL('https://cadbos.example/create/interior');

describe('client integrity manifest', () => {
	it('validates a SHA-384 asset map', () => {
		expect(manifest).toEqual({
			'/_app/immutable/app.js': integrity,
			'/_app/immutable/app.css': integrity
		});
	});

	it.each([
		null,
		[],
		{},
		{ '/other/app.js': integrity },
		{ '/_app/immutable/app.png': integrity },
		{ '/_app/immutable/app.js': 'sha256-invalid' }
	])('rejects malformed input %#', (value) => {
		expect(() => validateClientIntegrityManifest(value)).toThrow();
	});
});

describe('addIntegrityToHtml', () => {
	it('decorates manifest resources and preserves unrelated links', () => {
		const html = [
			'<link rel="stylesheet" href="../../_app/immutable/app.css">',
			'<link rel="icon" href="/favicon.svg">',
			'<script type="module" src="/_app/immutable/app.js"></script>'
		].join('');

		expect(addIntegrityToHtml(html, pageUrl, manifest)).toBe(
			`<link rel="stylesheet" href="../../_app/immutable/app.css" integrity="${integrity}" crossorigin="anonymous">` +
				'<link rel="icon" href="/favicon.svg">' +
				`<script type="module" src="/_app/immutable/app.js" integrity="${integrity}" crossorigin="anonymous"></script>`
		);
	});
});

describe('addIntegrityToLinkHeader', () => {
	it('decorates relative preload entries without splitting quoted commas', () => {
		const header =
			'<../../_app/immutable/app.css>; rel="preload"; as="style"; title="one,two", <../../_app/immutable/app.js>; rel="modulepreload", <https://cdn.example/app.js>; rel="modulepreload"';

		expect(addIntegrityToLinkHeader(header, pageUrl, manifest)).toBe(
			`<../../_app/immutable/app.css>; rel="preload"; as="style"; title="one,two"; integrity="${integrity}"; crossorigin="anonymous", ` +
				`<../../_app/immutable/app.js>; rel="modulepreload"; integrity="${integrity}"; crossorigin="anonymous", ` +
				'<https://cdn.example/app.js>; rel="modulepreload"'
		);
	});
});
