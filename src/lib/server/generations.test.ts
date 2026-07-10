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

import { beforeEach, describe, expect, it } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import { fromLedgerAmountUnits } from '$lib/server/ledger-units';
import { getCredit } from './billing';
import {
	deleteGeneratedImage,
	getGeneratedImageForUser,
	listCreditHistory,
	listGeneratedImages,
	recordGeneration
} from './generations';
import { grantGenerationAccess, makeD1, seedGeneratedImage } from './testing/d1-shim';

function seedUser(db: D1Database, id: string, pubkey: string): void {
	db.prepare('INSERT INTO users (id, pubkey, created_at) VALUES (?, ?, ?)')
		.bind(id, pubkey, Date.now())
		.run();
}

async function readLedgerBalance(
	db: D1Database,
	asset: 'app_credit' | 'archai_token',
	userId: string | null
): Promise<number | null> {
	const row = await db
		.prepare(
			'SELECT balance.balance FROM ledger_accounts account ' +
				'JOIN ledger_account_balances balance ON balance.account_id = account.id ' +
				'WHERE account.asset = ? AND account.user_id IS ?'
		)
		.bind(asset, userId)
		.first<{ balance: number }>();
	return row ? fromLedgerAmountUnits(row.balance) : null;
}

const generationInput = {
	url: 'https://cdn.example.test/out.webp',
	sourceUrl: 'https://cdn.example.test/room.jpg',
	prompt: 'cozy',
	kind: 'render' as const,
	amount: 1.5
};

let db: D1Database;

beforeEach(() => {
	db = makeD1();
});

describe('recordGeneration', () => {
	it('atomically debits both ledgers and records normalized generation details', async () => {
		seedUser(db, 'user-1', 'pubkey-1');
		grantGenerationAccess(db, 'user-1', 5);

		const result = await recordGeneration(db, 'user-1', generationInput);

		expect(result.balance).toBe(3.5);
		await expect(readLedgerBalance(db, 'app_credit', 'user-1')).resolves.toBe(3.5);
		await expect(readLedgerBalance(db, 'archai_token', null)).resolves.toBe(-1.5);
		const entries = await db
			.prepare('SELECT amount, typeof(amount) AS type FROM ledger_entries ORDER BY account_id')
			.all<{ amount: number; type: string }>();
		expect(entries.results).toEqual([
			{ amount: 500, type: 'integer' },
			{ amount: -150, type: 'integer' },
			{ amount: -150, type: 'integer' }
		]);
		expect(
			await db
				.prepare(
					'SELECT ledger_transaction.finalized FROM ledger_transactions ledger_transaction ' +
						'JOIN generations generation ON generation.ledger_transaction_id = ledger_transaction.id ' +
						'WHERE generation.user_id = ?'
				)
				.bind('user-1')
				.first<{ finalized: number }>()
		).toEqual({ finalized: 1 });
		await expect(listGeneratedImages(db, 'user-1', 0, 10)).resolves.toEqual({
			images: [expect.objectContaining({ url: generationInput.url })],
			hasMore: false
		});
	});

	it('isolates app-credit balances per user', async () => {
		seedUser(db, 'user-1', 'pubkey-1');
		seedUser(db, 'user-2', 'pubkey-2');
		grantGenerationAccess(db, 'user-1', 5);
		grantGenerationAccess(db, 'user-2', 5);

		await recordGeneration(db, 'user-1', { ...generationInput, amount: 2 });

		expect((await getCredit(db, 'user-1'))?.balance).toBe(3);
		expect((await getCredit(db, 'user-2'))?.balance).toBe(5);
	});

	it('rejects an overdraft and rolls back the entire generation batch', async () => {
		seedUser(db, 'user-1', 'pubkey-1');
		grantGenerationAccess(db, 'user-1', 1);

		await expect(recordGeneration(db, 'user-1', generationInput)).rejects.toThrow();

		await expect(readLedgerBalance(db, 'app_credit', 'user-1')).resolves.toBe(1);
		await expect(readLedgerBalance(db, 'archai_token', null)).resolves.toBe(0);
		expect(
			db
				.prepare(
					"SELECT (SELECT COUNT(*) FROM ledger_transactions WHERE id LIKE 'generation:%') AS transactions, " +
						'(SELECT COUNT(*) FROM generations) AS generations, ' +
						'(SELECT COUNT(*) FROM image_generation_details) AS details'
				)
				.first<{ transactions: number; generations: number; details: number }>()
		).toEqual({ transactions: 0, generations: 0, details: 0 });
	});

	it('allows only one competing debit when their combined cost exceeds the balance', async () => {
		seedUser(db, 'user-1', 'pubkey-1');
		grantGenerationAccess(db, 'user-1', 2);

		const attempts = await Promise.allSettled([
			recordGeneration(db, 'user-1', generationInput),
			recordGeneration(db, 'user-1', {
				...generationInput,
				url: 'https://cdn.example.test/competing.webp'
			})
		]);

		expect(attempts.filter((attempt) => attempt.status === 'fulfilled')).toHaveLength(1);
		expect(attempts.filter((attempt) => attempt.status === 'rejected')).toHaveLength(1);
		await expect(readLedgerBalance(db, 'app_credit', 'user-1')).resolves.toBe(0.5);
		await expect(readLedgerBalance(db, 'archai_token', null)).resolves.toBe(-1.5);
		expect(
			db.prepare('SELECT COUNT(*) AS count FROM generations').first<{ count: number }>()
		).toEqual({ count: 1 });
	});

	it('records a zero-cost generation without zero-value ledger entries', async () => {
		seedUser(db, 'user-1', 'pubkey-1');
		grantGenerationAccess(db, 'user-1', 5);

		const result = await recordGeneration(db, 'user-1', { ...generationInput, amount: 0 });

		expect(result.balance).toBe(5);
		await expect(listCreditHistory(db, 'user-1')).resolves.toEqual([]);
		expect((await listGeneratedImages(db, 'user-1', 0, 10)).images).toHaveLength(1);
		expect(
			await db
				.prepare(
					'SELECT ledger_transaction.finalized FROM ledger_transactions ledger_transaction ' +
						'JOIN generations generation ON generation.ledger_transaction_id = ledger_transaction.id ' +
						'WHERE generation.user_id = ?'
				)
				.bind('user-1')
				.first<{ finalized: number }>()
		).toEqual({ finalized: 1 });
	});

	it('rejects invalid costs before writing any generation data', async () => {
		seedUser(db, 'user-1', 'pubkey-1');
		grantGenerationAccess(db, 'user-1', 5);

		await expect(
			recordGeneration(db, 'user-1', { ...generationInput, amount: -1 })
		).rejects.toThrow('generation cost must be a finite non-negative number');
		await expect(listGeneratedImages(db, 'user-1', 0, 10)).resolves.toEqual({
			images: [],
			hasMore: false
		});
	});

	it('rejects costs below the ledger unit precision before writing any generation data', async () => {
		seedUser(db, 'user-1', 'pubkey-1');
		grantGenerationAccess(db, 'user-1', 5);

		await expect(
			recordGeneration(db, 'user-1', { ...generationInput, amount: 0.001 })
		).rejects.toThrow('ledger amount is below unit precision');
		await expect(listGeneratedImages(db, 'user-1', 0, 10)).resolves.toEqual({
			images: [],
			hasMore: false
		});
	});

	it('rolls back a zero-cost generation when the user ledger account is missing', async () => {
		seedUser(db, 'user-1', 'pubkey-1');

		await expect(
			recordGeneration(db, 'user-1', { ...generationInput, amount: 0 })
		).rejects.toThrow();
		expect(
			db.prepare('SELECT COUNT(*) AS count FROM generations').first<{ count: number }>()
		).toEqual({
			count: 0
		});
		expect(
			db.prepare('SELECT COUNT(*) AS count FROM ledger_transactions').first<{ count: number }>()
		).toEqual({ count: 0 });
	});
});

describe('listCreditHistory', () => {
	it('is empty before any generation', async () => {
		seedUser(db, 'user-1', 'pubkey-1');
		grantGenerationAccess(db, 'user-1', 5);
		await expect(listCreditHistory(db, 'user-1')).resolves.toEqual([]);
	});

	it('orders spend newest first and derives each running balance from the ledger', async () => {
		seedUser(db, 'user-1', 'pubkey-1');
		grantGenerationAccess(db, 'user-1', 5);
		await recordGeneration(db, 'user-1', { ...generationInput, amount: 1 });
		await recordGeneration(db, 'user-1', {
			...generationInput,
			url: 'https://cdn.example.test/edit.webp',
			kind: 'edit',
			amount: 2
		});

		const history = await listCreditHistory(db, 'user-1');

		expect(
			history.map(({ kind, amount, balanceAfter }) => ({ kind, amount, balanceAfter }))
		).toEqual([
			{ kind: 'edit', amount: 2, balanceAfter: 2 },
			{ kind: 'render', amount: 1, balanceAfter: 4 }
		]);
	});
});

describe('generated images', () => {
	it('returns only an image owned by the requesting user', async () => {
		seedUser(db, 'user-1', 'pubkey-1');
		seedUser(db, 'user-2', 'pubkey-2');
		seedGeneratedImage(db, 'image-1', 'user-2', 1000);

		await expect(getGeneratedImageForUser(db, 'user-1', 'image-1')).resolves.toBeNull();
		await expect(getGeneratedImageForUser(db, 'user-2', 'image-1')).resolves.toEqual({
			id: 'image-1',
			userId: 'user-2',
			url: 'https://cdn.example.test/image-1.webp',
			createdAt: 1000
		});
	});

	it('deletes image details while retaining the immutable financial generation', async () => {
		seedUser(db, 'user-1', 'pubkey-1');
		seedUser(db, 'user-2', 'pubkey-2');
		seedGeneratedImage(db, 'image-1', 'user-1', 1000);

		await expect(deleteGeneratedImage(db, 'user-2', 'image-1')).resolves.toBe(false);
		await expect(deleteGeneratedImage(db, 'user-1', 'image-1')).resolves.toBe(true);
		await expect(getGeneratedImageForUser(db, 'user-1', 'image-1')).resolves.toBeNull();
		expect(
			db.prepare('SELECT id FROM generations WHERE id = ?').bind('image-1').first<{ id: string }>()
		).toEqual({ id: 'image-1' });
	});

	it('paginates one user’s image details newest first', async () => {
		seedUser(db, 'user-1', 'pubkey-1');
		seedUser(db, 'user-2', 'pubkey-2');
		seedGeneratedImage(db, 'oldest', 'user-1', 1000);
		seedGeneratedImage(db, 'newest', 'user-1', 3000);
		seedGeneratedImage(db, 'middle', 'user-1', 2000);
		seedGeneratedImage(db, 'other-user-image', 'user-2', 4000);

		const firstPage = await listGeneratedImages(db, 'user-1', 0, 2);
		const secondPage = await listGeneratedImages(db, 'user-1', 1, 2);

		expect(firstPage.images.map((image) => image.id)).toEqual(['newest', 'middle']);
		expect(firstPage.hasMore).toBe(true);
		expect(secondPage.images.map((image) => image.id)).toEqual(['middle', 'oldest']);
		expect(secondPage.hasMore).toBe(false);
	});
});
