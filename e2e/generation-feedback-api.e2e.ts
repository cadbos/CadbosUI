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

import { SESSION_COOKIE } from '$lib/server/auth/config';
import { createDb } from '$lib/server/db';
import { seedGeneration } from '$lib/server/testing/generation-fixtures';
import { expect, test, SESSION_ID, USER_ID } from './helpers/generation-api';

const GENERATION_ID = '00000000-0000-4000-8000-000000000101';
const endpoint = `/api/generated-images/${GENERATION_ID}/feedback`;
const feedbackQuery =
	'SELECT id, generation_id, rating, comment, created_at FROM generations_feedback';

test.beforeEach(async ({ generationApi }) => {
	await seedGeneration(createDb(generationApi.db), {
		id: GENERATION_ID,
		userId: USER_ID,
		url: 'https://uploads.cadbos.example/result.png',
		sourceUrl: 'https://uploads.cadbos.example/scene.png',
		createdAt: Date.now(),
		sessionId: SESSION_ID
	});
});

for (const rating of ['like', 'dislike'] as const) {
	test(`stores ${rating} feedback for the creator and preserves it on identical retries`, async ({
		generationApi: { db, request }
	}) => {
		const response = await request.post(endpoint, { data: { rating } });
		expect(response.status()).toBe(204);
		expect(await response.text()).toBe('');
		const original = (await db.prepare(feedbackQuery).all()).results;
		expect(original).toEqual([
			{
				id: expect.any(Number),
				generation_id: GENERATION_ID,
				rating,
				comment: null,
				created_at: expect.any(Number)
			}
		]);

		await db.prepare('UPDATE generations_feedback SET created_at = 1').run();
		const retry = await request.post(endpoint, { data: { rating } });
		expect(retry.status()).toBe(204);
		expect(await retry.text()).toBe('');
		expect((await db.prepare(feedbackQuery).all()).results).toEqual([
			{ ...original[0], created_at: 1 }
		]);

		const conflict = await request.post(endpoint, {
			data: { rating: rating === 'like' ? 'dislike' : 'like' }
		});
		expect(conflict.status()).toBe(409);
		expect(await conflict.json()).toEqual({
			error: {
				code: 'feedback_conflict',
				message: 'Generation already has different feedback'
			}
		});
		expect((await db.prepare(feedbackQuery).all()).results).toEqual([
			{ ...original[0], created_at: 1 }
		]);
	});
}

for (const [name, comment] of [
	['omitted', undefined],
	['null', null],
	['empty', ''],
	['whitespace', '  \n\t '],
	['multiline Unicode', '  Отлично 😀\nMore light, please.  '],
	['3000 characters', 'a'.repeat(3000)],
	['3000 UTF-16 code units', '😀'.repeat(1500)]
] as const) {
	test(`stores ${name} comments exactly and accepts identical retries`, async ({
		generationApi: { db, request }
	}) => {
		const data = { rating: 'like', comment };
		expect((await request.post(endpoint, { data })).status()).toBe(204);
		await db.prepare('UPDATE generations_feedback SET created_at = 1').run();
		const original = (await db.prepare(feedbackQuery).all()).results;
		expect(original).toEqual([
			expect.objectContaining({ rating: 'like', comment: comment ?? null, created_at: 1 })
		]);
		const retry = await request.post(endpoint, {
			data: { rating: 'like', comment: comment === null ? undefined : (comment ?? null) }
		});
		expect(retry.status()).toBe(204);
		expect((await db.prepare(feedbackQuery).all()).results).toEqual(original);
	});
}

for (const [name, originalComment, nextComment] of [
	['adding', null, 'New comment'],
	['changing', 'Original', 'Changed'],
	['omitting', 'Original', undefined],
	['clearing', 'Original', null],
	['emptying', 'Original', ''],
	['trimming', ' Original ', 'Original'],
	['replacing empty with null', '', null]
] as const) {
	test(`rejects ${name} a stored comment without changing the original feedback`, async ({
		generationApi: { db, request }
	}) => {
		expect(
			(
				await request.post(endpoint, {
					data: { rating: 'like', comment: originalComment }
				})
			).status()
		).toBe(204);
		await db.prepare('UPDATE generations_feedback SET created_at = 1').run();
		const original = (await db.prepare(feedbackQuery).all()).results;
		const response = await request.post(endpoint, {
			data: { rating: 'like', comment: nextComment }
		});
		expect(response.status()).toBe(409);
		expect(await response.json()).toEqual({
			error: { code: 'feedback_conflict', message: 'Generation already has different feedback' }
		});
		expect((await db.prepare(feedbackQuery).all()).results).toEqual(original);
	});
}

for (const [name, comment] of [
	['3001 characters', 'a'.repeat(3001)],
	['3002 UTF-16 code units', '😀'.repeat(1501)]
] as const) {
	test(`rejects comments with ${name} without writing feedback`, async ({
		generationApi: { db, request }
	}) => {
		const response = await request.post(endpoint, { data: { rating: 'like', comment } });
		expect(response.status()).toBe(400);
		expect(await response.json()).toEqual({
			error: { code: 'invalid_request', message: 'Invalid request body' }
		});
		expect((await db.prepare(feedbackQuery).all()).results).toEqual([]);
	});
}

test('preserves the first comment when same-rating submissions conflict concurrently', async ({
	generationApi: { db, request }
}) => {
	const comments = ['First comment', 'Second comment'];
	const responses = await Promise.all(
		comments.map((comment) => request.post(endpoint, { data: { rating: 'like', comment } }))
	);
	expect(responses.map((response) => response.status()).sort()).toEqual([204, 409]);
	expect((await db.prepare(feedbackQuery).all()).results).toEqual([
		expect.objectContaining({
			generation_id: GENERATION_ID,
			rating: 'like',
			comment: comments[responses.findIndex((response) => response.status() === 204)]
		})
	]);
});

for (const cookie of ['', `${SESSION_COOKIE}=invalid`, `${SESSION_COOKIE}=expired`]) {
	test(`requires a valid session with cookie ${cookie || '(missing)'}`, async ({
		generationApi: { db, request }
	}) => {
		await db
			.prepare('INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
			.bind('expired', USER_ID, 1, 2)
			.run();
		const response = await request.post(endpoint, { headers: { cookie }, data: '{' });
		expect(response.status()).toBe(401);
		expect(await response.json()).toEqual({
			error: { code: 'unauthorized', message: 'Authentication required' }
		});
		expect((await db.prepare(feedbackQuery).all()).results).toEqual([]);
	});
}

for (const body of [
	'{}',
	'{',
	'null',
	'[]',
	'{"rating":"love"}',
	'{"rating":1}',
	'{"rating":null}',
	'{"rating":"like","userId":"someone-else"}',
	'{"rating":"like","comment":1}',
	'{"rating":"like","comment":true}',
	'{"rating":"like","comment":[]}',
	'{"rating":"like","comment":{}}'
]) {
	test(`rejects invalid body ${body}`, async ({ generationApi: { db, request } }) => {
		const response = await request.post(endpoint, {
			data: body,
			headers: { 'content-type': 'application/json' }
		});
		expect(response.status()).toBe(400);
		expect(await response.json()).toEqual({
			error: { code: 'invalid_request', message: 'Invalid request body' }
		});
		expect((await db.prepare(feedbackQuery).all()).results).toEqual([]);
	});
}

for (const hasFeedback of [false, true]) {
	test(`hides foreign generations ${hasFeedback ? 'with' : 'without'} feedback`, async ({
		generationApi: { db, request }
	}) => {
		await db
			.prepare('INSERT INTO users (id, pubkey, created_at) VALUES (?, ?, ?)')
			.bind('other-user', 'b'.repeat(64), Date.now())
			.run();
		await db
			.prepare('INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
			.bind('other-auth', 'other-user', Date.now(), Date.now() + 60_000)
			.run();
		if (hasFeedback) {
			expect(
				(
					await request.post(endpoint, { data: { rating: 'like', comment: 'Original feedback' } })
				).status()
			).toBe(204);
		}
		const before = (await db.prepare(feedbackQuery).all()).results;
		for (const rating of ['like', 'dislike']) {
			const response = await request.post(endpoint, {
				data: { rating, comment: 'Original feedback' },
				headers: { cookie: `${SESSION_COOKIE}=other-auth` }
			});
			expect(response.status()).toBe(404);
			expect(await response.json()).toEqual({
				error: { code: 'generation_not_found', message: 'Generation not found' }
			});
			expect((await db.prepare(feedbackQuery).all()).results).toEqual(before);
		}
	});
}

test('rejects a missing generation', async ({ generationApi: { db, request } }) => {
	const response = await request.post('/api/generated-images/missing/feedback', {
		data: { rating: 'like', comment: 'Original feedback' }
	});
	expect(response.status()).toBe(404);
	expect(await response.json()).toEqual({
		error: { code: 'generation_not_found', message: 'Generation not found' }
	});
	expect((await db.prepare(feedbackQuery).all()).results).toEqual([]);
});

test('accepts concurrent identical submissions without duplicate rows', async ({
	generationApi: { db, request }
}) => {
	const responses = await Promise.all([
		request.post(endpoint, { data: { rating: 'like', comment: 'Original feedback' } }),
		request.post(endpoint, { data: { rating: 'like', comment: 'Original feedback' } })
	]);
	expect(responses.map((response) => response.status())).toEqual([204, 204]);
	expect((await db.prepare(feedbackQuery).all()).results).toEqual([
		expect.objectContaining({
			generation_id: GENERATION_ID,
			rating: 'like',
			comment: 'Original feedback'
		})
	]);
});

test('preserves the first rating when conflicting submissions run concurrently', async ({
	generationApi: { db, request }
}) => {
	const ratings = ['like', 'dislike'];
	const responses = await Promise.all(
		ratings.map((rating) =>
			request.post(endpoint, { data: { rating, comment: 'Original feedback' } })
		)
	);
	expect(responses.map((response) => response.status()).sort()).toEqual([204, 409]);
	expect((await db.prepare(feedbackQuery).all()).results).toEqual([
		expect.objectContaining({
			generation_id: GENERATION_ID,
			rating: ratings[responses.findIndex((response) => response.status() === 204)],
			comment: 'Original feedback'
		})
	]);
});

test('reports an authentication outage without writing feedback', async ({
	generationApi: { db, request }
}) => {
	const originalPrepare = db.prepare;
	try {
		db.prepare = () => {
			throw new Error('Session lookup unavailable');
		};
		const response = await request.post(endpoint, {
			data: { rating: 'like', comment: 'Original feedback' }
		});
		expect(response.status()).toBe(503);
		expect(response.headers()['retry-after']).toBe('5');
		expect(await response.json()).toEqual({
			error: {
				code: 'authentication_unavailable',
				message: 'Authentication service temporarily unavailable'
			}
		});
	} finally {
		db.prepare = originalPrepare;
	}
	expect((await db.prepare(feedbackQuery).all()).results).toEqual([]);
});

test('surfaces storage failures without writing feedback and allows a later retry', async ({
	generationApi: { db, request }
}) => {
	await db
		.prepare(
			`CREATE TRIGGER reject_feedback BEFORE INSERT ON generations_feedback
			BEGIN SELECT RAISE(ABORT, 'Feedback storage unavailable'); END`
		)
		.run();
	const response = await request.post(endpoint, {
		data: { rating: 'like', comment: 'Original feedback' }
	});
	expect(response.status()).toBe(500);
	expect(await response.json()).toEqual({
		error: { code: 'feedback_error', message: 'Unable to store generation feedback' }
	});
	expect((await db.prepare(feedbackQuery).all()).results).toEqual([]);
	await db.prepare('DROP TRIGGER reject_feedback').run();
	expect(
		(
			await request.post(endpoint, { data: { rating: 'like', comment: 'Original feedback' } })
		).status()
	).toBe(204);
});
