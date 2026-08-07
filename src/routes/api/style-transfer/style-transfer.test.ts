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
import type { D1Database } from '@cloudflare/workers-types';
import type { SessionUser } from '$lib/api/contract';
import { DEMO_PUBKEY } from '$lib/server/demo';
import { toLedgerAmountUnits } from '$lib/server/ledger-units';
import { grantGenerationAccess, makeD1 } from '$lib/server/testing/d1-shim';

const { POST } = await import('./+server');

function seedUser(db: D1Database, id: string, pubkey: string): void {
	db.prepare('INSERT INTO users (id, pubkey, created_at) VALUES (?, ?, ?)')
		.bind(id, pubkey, Date.now())
		.run();
}

type StyleTransferEvent = Parameters<typeof POST>[0];

function call(
	user: SessionUser | null,
	platform: App.Platform,
	body: unknown
): ReturnType<typeof POST> {
	return POST({
		request: new Request('https://cadbos.example/api/style-transfer', {
			method: 'POST',
			body: JSON.stringify(body)
		}),
		platform,
		locals: { user }
	} as StyleTransferEvent);
}

const body = {
	image: 'https://example.test/room.jpg',
	referenceImage: 'https://example.test/style.jpg',
	outputFormat: 'webp',
	prompt: 'preserve the room layout',
	negativePrompt: 'no people',
	styleTransferStrength: 0.7
};
const pubkey = 'a'.repeat(64);

describe('POST /api/style-transfer — billing', () => {
	it('rejects unauthenticated requests', async () => {
		const response = await call(null, { env: { DB: makeD1() } } as App.Platform, body);
		expect(response.status).toBe(401);
	});

	it('rejects an image value that is not a URL', async () => {
		const db = makeD1();
		seedUser(db, 'user-1', pubkey);
		grantGenerationAccess(db, 'user-1', 12);

		const response = await call({ pubkey }, { env: { DB: db } } as App.Platform, {
			...body,
			referenceImage: 'not-a-url'
		});
		expect(response.status).toBe(400);
	});

	it('rejects non-http image URLs', async () => {
		const db = makeD1();
		seedUser(db, 'user-1', pubkey);
		grantGenerationAccess(db, 'user-1', 12);
		const platform = { env: { DB: db } } as App.Platform;
		const dataUrl = 'data:image/png;base64,aW1hZ2U=';

		const sourceResponse = await call({ pubkey }, platform, {
			...body,
			image: dataUrl
		});
		const referenceResponse = await call({ pubkey }, platform, {
			...body,
			referenceImage: dataUrl
		});

		expect(sourceResponse.status).toBe(400);
		expect(referenceResponse.status).toBe(400);
	});

	it('rejects a style transfer strength outside the provider range', async () => {
		const db = makeD1();
		seedUser(db, 'user-1', pubkey);
		grantGenerationAccess(db, 'user-1', 12);

		const response = await call({ pubkey }, { env: { DB: db } } as App.Platform, {
			...body,
			styleTransferStrength: 1.1
		});
		expect(response.status).toBe(400);
	});

	it('debits the global token ledger without exposing the provider balance', async () => {
		const db = makeD1();
		seedUser(db, 'user-1', pubkey);
		grantGenerationAccess(db, 'user-1', 12);

		const response = await call({ pubkey }, { env: { DB: db } } as App.Platform, body);
		expect(response.status).toBe(200);
		const result = (await response.json()) as { balance: number; cost: number };

		const balanceRow = await db
			.prepare(
				'SELECT balance.balance FROM ledger_accounts account ' +
					'JOIN ledger_account_balances balance ON balance.account_id = account.id ' +
					"WHERE account.asset = 'archai_token' AND account.user_id IS NULL"
			)
			.first<{ balance: number }>();
		expect(balanceRow?.balance).toBe(-toLedgerAmountUnits(result.cost));
		expect(result.balance).toBe(12 - result.cost);
	});

	it('records the styled image, source and prompt against the authenticated profile', async () => {
		const db = makeD1();
		seedUser(db, 'user-1', pubkey);
		grantGenerationAccess(db, 'user-1', 12);

		const response = await call({ pubkey }, { env: { DB: db } } as App.Platform, body);
		expect(response.status).toBe(200);
		const result = (await response.json()) as { outputUrl: string };

		const row = await db
			.prepare(
				'SELECT generation.user_id, detail.output_url AS url, detail.input_url AS source_url, ' +
					'generation.prompt, generation.kind FROM generations generation ' +
					'JOIN image_generation_details detail ON detail.generation_id = generation.id ' +
					'WHERE generation.user_id = ?'
			)
			.bind('user-1')
			.first<{ user_id: string; url: string; source_url: string; prompt: string; kind: string }>();
		expect(row).toEqual({
			user_id: 'user-1',
			url: result.outputUrl,
			source_url: body.image,
			prompt: body.prompt,
			kind: 'style-transfer'
		});
	});

	it('rate-limits repeated style transfers from the same account', async () => {
		const db = makeD1();
		seedUser(db, 'user-1', pubkey);
		grantGenerationAccess(db, 'user-1', 1000);
		const platform = { env: { DB: db } } as App.Platform;

		const responses = [];
		for (let i = 0; i < 11; i += 1) {
			responses.push(await call({ pubkey }, platform, body));
		}

		expect(responses.slice(0, 10).every((response) => response.status === 200)).toBe(true);
		expect(responses[10].status).toBe(429);
	});

	it('bypasses D1 entirely for the dev-only demo session', async () => {
		const response = await call({ pubkey: DEMO_PUBKEY }, { env: {} } as App.Platform, body);
		expect(response.status).toBe(200);
	});

	it('blocks an account with no generation access', async () => {
		const db = makeD1();
		seedUser(db, 'user-1', pubkey);

		const response = await call({ pubkey }, { env: { DB: db } } as App.Platform, body);
		expect(response.status).toBe(403);
		const result = (await response.json()) as { error: { code: string } };
		expect(result.error.code).toBe('generation_restricted');
	});

	it('blocks style transfer once an approved account exhausts its balance', async () => {
		const db = makeD1();
		seedUser(db, 'user-1', pubkey);
		grantGenerationAccess(db, 'user-1', 0);

		const response = await call({ pubkey }, { env: { DB: db } } as App.Platform, body);
		expect(response.status).toBe(402);
		const result = (await response.json()) as { error: { code: string } };
		expect(result.error.code).toBe('insufficient_credit');
	});
});
