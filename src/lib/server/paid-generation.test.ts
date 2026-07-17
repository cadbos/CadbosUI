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

import { describe, expect, it, vi } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import { GenerationProviderError } from '$lib/server/generation';
import { getGenerationOperation } from '$lib/server/generations';
import { grantGenerationAccess, makeD1 } from '$lib/server/testing/d1-shim';
import { runPaidGeneration } from './paid-generation';

function seedUser(db: D1Database): void {
	db.prepare('INSERT INTO users (id, pubkey, created_at) VALUES (?, ?, ?)')
		.bind('user-1', 'pubkey-1', Date.now())
		.run();
	grantGenerationAccess(db, 'user-1', 5);
}

const operationInput = {
	sourceUrl: 'https://cdn.example.test/room.jpg',
	prompt: 'cozy',
	kind: 'render' as const
};

async function readOnlyOperation(db: D1Database) {
	const row = await db
		.prepare('SELECT id FROM generation_operations WHERE user_id = ?')
		.bind('user-1')
		.first<{ id: string }>();
	if (!row) throw new Error('test operation was not created');
	return getGenerationOperation(db, 'user-1', row.id);
}

describe('runPaidGeneration', () => {
	it('marks an explicit provider failure failed without charging', async () => {
		const db = makeD1();
		seedUser(db);

		await expect(
			runPaidGeneration(db, 'user-1', operationInput, async () => {
				throw new GenerationProviderError('Render failed', 'explicit_failure');
			})
		).rejects.toThrow('Render failed');

		await expect(readOnlyOperation(db)).resolves.toMatchObject({ status: 'failed' });
		expect(
			db.prepare('SELECT COUNT(*) AS count FROM generations').first<{ count: number }>()
		).toEqual({ count: 0 });
	});

	it('leaves an ambiguous provider outcome pending and never retries it', async () => {
		const db = makeD1();
		seedUser(db);
		const provider = vi.fn(async () => {
			throw new GenerationProviderError('Render failed', 'ambiguous');
		});

		await expect(runPaidGeneration(db, 'user-1', operationInput, provider)).rejects.toThrow(
			'Render failed'
		);

		expect(provider).toHaveBeenCalledOnce();
		await expect(readOnlyOperation(db)).resolves.toMatchObject({ status: 'pending' });
		expect(
			db.prepare('SELECT COUNT(*) AS count FROM generations').first<{ count: number }>()
		).toEqual({ count: 0 });
	});
});
