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

import { afterEach, describe, expect, it, vi } from 'vitest';

const archai = vi.hoisted(() => ({
	postRenderInterior: vi.fn(),
	postEditByPrompt: vi.fn()
}));

vi.mock('$lib/server/archai', () => archai);

const { editInterior, renderInterior } = await import('./generation');

const withKey = { env: { ARCHAI_API_KEY: 'test-key' } } as App.Platform;
const withoutKey = { env: {} } as App.Platform;

afterEach(() => {
	vi.clearAllMocks();
});

describe('renderInterior', () => {
	it('falls back to the dev mock when no API key is configured', async () => {
		const result = await renderInterior(withoutKey, {
			image: 'https://example.test/room.jpg',
			prompt: 'cozy',
			outputFormat: 'webp'
		});
		expect(result.outputUrl).toMatch(/^https:\/\//);
	});

	it('normalizes an array output to its first element (И-MA-4)', async () => {
		archai.postRenderInterior.mockResolvedValue({
			data: {
				output: ['https://example.test/a.jpg', 'https://example.test/b.jpg'],
				cost: 1,
				balance: 24
			}
		});

		const result = await renderInterior(withKey, {
			image: 'https://example.test/room.jpg',
			prompt: 'cozy',
			outputFormat: 'webp'
		});

		expect(result).toEqual({ outputUrl: 'https://example.test/a.jpg', cost: 1, balance: 24 });
	});

	it('normalizes a string output unchanged', async () => {
		archai.postRenderInterior.mockResolvedValue({
			data: { output: 'https://example.test/a.jpg', cost: 1, balance: 24 }
		});

		const result = await renderInterior(withKey, {
			image: 'https://example.test/room.jpg',
			prompt: '',
			outputFormat: 'webp'
		});

		expect(result.outputUrl).toBe('https://example.test/a.jpg');
	});

	it('throws a generic error without leaking provider details', async () => {
		archai.postRenderInterior.mockResolvedValue({
			error: { message: 'insufficient balance: account 9f3a' }
		});

		await expect(
			renderInterior(withKey, {
				image: 'https://example.test/room.jpg',
				prompt: '',
				outputFormat: 'webp'
			})
		).rejects.toThrow('Render failed');
	});
});

describe('editInterior', () => {
	it('falls back to the dev mock when no API key is configured', async () => {
		const result = await editInterior(withoutKey, {
			image: 'https://example.test/prev-render.jpg',
			prompt: 'make the wall sage green'
		});
		expect(result.outputUrl).toMatch(/^https:\/\//);
	});

	it('normalizes the single-string output (И-MA-ED2)', async () => {
		archai.postEditByPrompt.mockResolvedValue({
			data: { output: 'https://example.test/edited.jpg', cost: 1, balance: 23 }
		});

		const result = await editInterior(withKey, {
			image: 'https://example.test/prev-render.jpg',
			prompt: 'make the wall sage green'
		});

		expect(result).toEqual({ outputUrl: 'https://example.test/edited.jpg', cost: 1, balance: 23 });
	});

	it('sends image/prompt with no outputFormat field (И-MA-ED1)', async () => {
		archai.postEditByPrompt.mockResolvedValue({
			data: { output: 'https://example.test/edited.jpg', cost: 1, balance: 23 }
		});

		await editInterior(withKey, {
			image: 'https://example.test/prev-render.jpg',
			prompt: 'replace the sofa with a leather armchair'
		});

		const call = archai.postEditByPrompt.mock.calls[0][0];
		expect(call.body).toEqual({
			image: 'https://example.test/prev-render.jpg',
			prompt: 'replace the sofa with a leather armchair'
		});
	});

	it('throws a generic error without leaking provider details', async () => {
		archai.postEditByPrompt.mockResolvedValue({
			error: { message: 'internal provider trace 9f3a' }
		});

		await expect(
			editInterior(withKey, {
				image: 'https://example.test/prev-render.jpg',
				prompt: 'replace the sofa'
			})
		).rejects.toThrow('Render failed');
	});

	it('throws when the response has no output URL', async () => {
		archai.postEditByPrompt.mockResolvedValue({
			data: { output: '', cost: 0, balance: 25 }
		});

		await expect(
			editInterior(withKey, {
				image: 'https://example.test/prev-render.jpg',
				prompt: 'replace the sofa'
			})
		).rejects.toThrow('Render failed');
	});
});
