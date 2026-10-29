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

import { z } from 'zod';
import type { ProjectDetailResponse } from '$lib/api/contract';
import { SESSION_COOKIE } from '$lib/server/auth/config';
import { createDb } from '$lib/server/db';
import { mediaKey } from '$lib/server/media';
import { issueShareToken } from '$lib/server/projects';
import { seedGeneration, TEST_S3_BUCKET } from '$lib/server/testing/generation-fixtures';
import { expect, test, SESSION_ID, USER_ID } from './helpers/generation-api';

const PROJECT_ID = '00000000-0000-4000-8000-000000000010';
const GENERATION_ID = '00000000-0000-4000-8000-000000000101';
const SECOND_ID = '00000000-0000-4000-8000-000000000102';
const LATEST_ID = '00000000-0000-4000-8000-000000000103';
const RESOURCE_PATH = `/api/resources/${encodeURIComponent(mediaKey(TEST_S3_BUCKET.name, 'scene.png'))}`;
const COMMENT = '  Отлично 😀\nMore light, please.  ';
const FEEDBACK_PATH = `/api/generated-images/${GENERATION_ID}/feedback`;
const feedbackQuery = 'SELECT * FROM generations_feedback ORDER BY id';

const generationSchema = z.object({
	id: z.string(),
	rating: z.enum(['like', 'dislike']).nullable(),
	comment: z.string().nullable()
});
const scenesSchema = z
	.object({ images: z.array(generationSchema) })
	.transform((body) => body.images);
const reads = [
	{ name: 'iterations', path: '/api/generated-images', schema: scenesSchema, foreignStatus: 200 },
	{
		name: 'milestones',
		path: '/api/generated-images?view=milestones',
		schema: scenesSchema,
		foreignStatus: 200
	},
	{
		name: 'generation detail',
		path: `/api/generated-images/${GENERATION_ID}`,
		schema: generationSchema.transform((body) => [body]),
		foreignStatus: 404
	},
	{
		name: 'project timeline',
		path: `/api/projects/${PROJECT_ID}`,
		schema: z
			.object({ sessions: z.array(z.object({ generations: z.array(generationSchema) })) })
			.transform((body) => body.sessions.flatMap((session) => session.generations)),
		foreignStatus: 404
	},
	{
		name: 'resource detail',
		path: RESOURCE_PATH,
		schema: z
			.object({ generations: z.array(generationSchema) })
			.transform((body) => body.generations),
		foreignStatus: 404
	}
];

test.beforeEach(async ({ generationApi: { db } }) => {
	await db
		.prepare('UPDATE media SET checksum = ? WHERE filename = ?')
		.bind('a'.repeat(64), 'scene.png')
		.run();
	await db
		.prepare(
			'INSERT INTO projects (id, user_id, title, created_at, updated_at) VALUES (?, ?, ?, 1, 1)'
		)
		.bind(PROJECT_ID, USER_ID, 'Rated project')
		.run();
	await db
		.prepare('UPDATE project_sessions SET project_id = ? WHERE id = ?')
		.bind(PROJECT_ID, SESSION_ID)
		.run();
	await seedGeneration(createDb(db), {
		id: GENERATION_ID,
		userId: USER_ID,
		url: 'https://uploads.cadbos.example/first.png',
		sourceUrl: 'https://uploads.cadbos.example/scene.png',
		createdAt: 1,
		sessionId: SESSION_ID
	});
});

for (const [rating, comment] of [
	[null, null],
	['like', null],
	['dislike', null],
	['like', COMMENT],
	['dislike', '']
] as const) {
	test(`returns ${rating ?? 'null'} ratings with ${comment === null ? 'null' : comment === '' ? 'empty' : 'text'} comments across authenticated generation reads`, async ({
		generationApi: { db, request }
	}) => {
		if (rating !== null) {
			expect((await request.post(FEEDBACK_PATH, { data: { rating, comment } })).status()).toBe(204);
		}
		const before = (await db.prepare(feedbackQuery).all()).results;
		for (const read of reads) {
			const response = await request.get(read.path);
			expect(response.status(), read.name).toBe(200);
			expect(read.schema.parse(await response.json()), read.name).toEqual([
				{ id: GENERATION_ID, rating, comment }
			]);
			expect(response.headers()['cache-control'], read.name).toBe('private, no-store');
		}
		expect((await db.prepare(feedbackQuery).all()).results).toEqual(before);
	});
}

test('preserves mixed ratings, pagination, filters, and resource reference associations', async ({
	generationApi: { db, request }
}) => {
	for (const [id, createdAt] of [
		[SECOND_ID, 2],
		[LATEST_ID, 3]
	] as const) {
		await seedGeneration(createDb(db), {
			id,
			userId: USER_ID,
			url: `https://uploads.cadbos.example/${id}.png`,
			sourceUrl: 'https://uploads.cadbos.example/scene.png',
			createdAt,
			sessionId: SESSION_ID
		});
	}
	await db
		.prepare(
			`UPDATE generations SET kind = 'style-transfer', reference_media_id = source_media_id,
			source_media_id = (SELECT id FROM media WHERE filename = 'reference.png') WHERE id = ?`
		)
		.bind(SECOND_ID)
		.run();
	expect(
		(await request.post(FEEDBACK_PATH, { data: { rating: 'like', comment: COMMENT } })).status()
	).toBe(204);
	expect(
		(
			await request.post(`/api/generated-images/${LATEST_ID}/feedback`, {
				data: { rating: 'dislike', comment: '' }
			})
		).status()
	).toBe(204);
	const before = (await db.prepare(feedbackQuery).all()).results;
	const expected = [
		{ id: LATEST_ID, rating: 'dislike', comment: '' },
		{ id: SECOND_ID, rating: null, comment: null },
		{ id: GENERATION_ID, rating: 'like', comment: COMMENT }
	];
	for (const read of reads.filter((read) => read.name !== 'generation detail')) {
		const response = await request.get(read.path);
		expect(response.status(), read.name).toBe(200);
		expect(read.schema.parse(await response.json()), read.name).toEqual(
			read.name === 'milestones' ? expected.slice(0, 1) : expected
		);
	}
	for (const path of ['/api/generated-images', RESOURCE_PATH]) {
		for (const [offset, hasMore] of [
			[0, true],
			[1, false]
		] as const) {
			const response = await request.get(`${path}?size=2&offset=${offset * 2}`);
			expect(response.status()).toBe(200);
			const body = await response.json();
			const schema = path === RESOURCE_PATH ? reads[4].schema : scenesSchema;
			expect(schema.parse(body)).toEqual(expected.slice(offset * 2, offset * 2 + 2));
			expect(body.pagination).toEqual({ offset: offset * 2, size: 2, hasMore });
		}
	}
	for (const filter of [`projectId=${PROJECT_ID}`, `sessionId=${SESSION_ID}`]) {
		const response = await request.get(`/api/generated-images?${filter}`);
		expect(response.status()).toBe(200);
		expect(scenesSchema.parse(await response.json())).toEqual(expected);
	}
	const resource = await request.get(RESOURCE_PATH);
	const resourceBody = await resource.json();
	expect(resourceBody.generations[1]).toMatchObject({
		id: SECOND_ID,
		rating: null,
		comment: null,
		roles: ['style-reference']
	});
	expect((await db.prepare(feedbackQuery).all()).results).toEqual(before);
});

for (const read of reads) {
	test(`restricts ${read.name} ratings to the creator`, async ({
		generationApi: { db, request }
	}) => {
		expect(
			(await request.post(FEEDBACK_PATH, { data: { rating: 'like', comment: COMMENT } })).status()
		).toBe(204);
		const anonymous = await request.get(read.path, { headers: { cookie: '' } });
		expect(anonymous.status()).toBe(401);
		await db
			.prepare('INSERT INTO users (id, pubkey, created_at) VALUES (?, ?, 1)')
			.bind('other-user', 'b'.repeat(64))
			.run();
		await db
			.prepare('INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
			.bind('other-auth', 'other-user', Date.now(), Date.now() + 60_000)
			.run();
		const foreign = await request.get(read.path, {
			headers: { cookie: `${SESSION_COOKIE}=other-auth` }
		});
		expect(foreign.status()).toBe(read.foreignStatus);
		if (read.foreignStatus === 200) {
			expect(read.schema.parse(await foreign.json())).toEqual([]);
		}
	});

	test(`surfaces ${read.name} feedback lookup failures and recovers on retry`, async ({
		generationApi: { db, request }
	}) => {
		expect(
			(await request.post(FEEDBACK_PATH, { data: { rating: 'like', comment: COMMENT } })).status()
		).toBe(204);
		const before = (await db.prepare(feedbackQuery).all()).results;
		const originalPrepare = db.prepare;
		try {
			db.prepare = (query) => {
				if (query.includes('generations_feedback')) throw new Error('Feedback lookup unavailable');
				return originalPrepare.call(db, query);
			};
			const response = await request.get(read.path);
			expect(response.status()).toBe(500);
		} finally {
			db.prepare = originalPrepare;
		}
		const retried = await request.get(read.path);
		expect(retried.status()).toBe(200);
		expect(read.schema.parse(await retried.json())).toEqual([
			{ id: GENERATION_ID, rating: 'like', comment: COMMENT }
		]);
		expect((await db.prepare(feedbackQuery).all()).results).toEqual(before);
	});
}

for (const rating of ['like', 'dislike'] as const) {
	test(`omits ${rating} feedback from public shares, including requests by the creator`, async ({
		generationApi: { db, request }
	}) => {
		expect(
			(await request.post(FEEDBACK_PATH, { data: { rating, comment: COMMENT } })).status()
		).toBe(204);
		const token = await issueShareToken(createDb(db), USER_ID, PROJECT_ID);
		expect(token).not.toBeNull();
		for (const cookie of ['', `${SESSION_COOKIE}=generation-auth`]) {
			const project = await request.get(`/api/share/${token}`, { headers: { cookie } });
			expect(project.status()).toBe(200);
			const body = (await project.json()) as ProjectDetailResponse;
			expect(body.sessions[0].generations).toHaveLength(1);
			expect(body.sessions[0].generations[0]).not.toHaveProperty('rating');
			expect(body.sessions[0].generations[0]).not.toHaveProperty('comment');
			const detail = await request.get(`/api/share/${token}/generations/${GENERATION_ID}`, {
				headers: { cookie }
			});
			expect(detail.status()).toBe(200);
			const generation = await detail.json();
			expect(generation).not.toHaveProperty('rating');
			expect(generation).not.toHaveProperty('comment');
		}
	});
}
