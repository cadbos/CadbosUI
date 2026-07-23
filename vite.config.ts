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

import { heyApiPlugin } from '@hey-api/vite-plugin';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';
import adapter from '@sveltejs/adapter-cloudflare';
import { sveltekit } from '@sveltejs/kit/vite';
// Relative import: the `$lib` alias is not resolved while Vite evaluates this config.
import { heyApiOpenApiConfig } from './openapi-ts.config';
import { NOSTR_CONNECT_RELAYS } from './src/lib/nostr/connect';

export default defineConfig({
	plugins: [
		tailwindcss(),
		heyApiPlugin({ config: heyApiOpenApiConfig }),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},

			// Deployed to Cloudflare Workers (Static Assets); see wrangler.jsonc.
			adapter: adapter({
				platformProxy: {
					persist: process.env.PLAYWRIGHT_TEST === '1' ? false : undefined,
					remoteBindings: process.env.PLAYWRIGHT_TEST === '1' ? false : undefined
				}
			}),

			csp: {
				mode: 'auto',
				directives: {
					'default-src': ['self'],
					'script-src': ['self'],
					'style-src': ['self'],
					// SvelteKit applies inline `style="…"` attributes at runtime (the
					// `display:contents` wrapper and the router's screen-reader announcer).
					// Nonces/hashes can't cover style *attributes*, so scope a relaxation to
					// them only — `style-src` stays strict for <style>/<link> stylesheets.
					'style-src-attr': ['unsafe-inline'],
					'img-src': ['self', 'blob:', 'data:', 'https:'],
					'font-src': ['self'],
					// `self` for our own endpoints; the NIP-46 rendezvous relays (wss://).
					'connect-src': ['self', ...NOSTR_CONNECT_RELAYS],
					'object-src': ['none'],
					'base-uri': ['self'],
					'frame-ancestors': ['none'],
					'form-action': ['self']
				}
			}
		})
	],
	test: {
		expect: { requireAssertions: true },
		projects: [
			{
				extends: './vite.config.ts',
				test: {
					name: 'client',
					browser: {
						enabled: true,
						provider: playwright(),
						instances: [{ browser: 'chromium', headless: true }]
					},
					include: ['src/**/*.svelte.{test,spec}.{js,ts}'],
					exclude: ['src/lib/server/**']
				}
			},

			{
				extends: './vite.config.ts',
				test: {
					name: 'server',
					environment: 'node',
					include: ['src/**/*.{test,spec}.{js,ts}'],
					exclude: ['src/**/*.svelte.{test,spec}.{js,ts}']
				}
			}
		]
	}
});
