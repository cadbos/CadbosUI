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

import type { D1Database } from '@cloudflare/workers-types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RenderResponse, RequestFormSnapshot, SessionUser } from '$lib/api/contract';
import { normalizeImageContentType } from '$lib/image-mime';
import { defaultPhotoAdjustments, MAX_PROCESSED_PHOTO_SIZE } from '$lib/photo-adjustments';
import { createDb } from '$lib/server/db';
import { mediaKey } from '$lib/server/media';
import { makeD1 } from '$lib/server/testing/d1-shim';
import {
	seedManagedMedia,
	TEST_FORM_SNAPSHOT,
	TEST_S3_BUCKET,
	TEST_S3_ENV
} from '$lib/server/testing/generation-fixtures';
import { seedCredit } from '$lib/server/testing/ledger-fixtures';
import { seedForeignSession } from '$lib/server/testing/session-fixtures';
import { uploadImageBytes } from '$lib/server/uploads';

vi.mock('$lib/server/uploads', () => ({
	uploadImageBytes: vi.fn()
}));

const { POST } = await import('./+server');

const USER_ID = 'photo-user';
const PUBKEY = 'a'.repeat(64);
const SESSION_ID = '00000000-0000-4000-8000-000000000152';
const SOURCE_KEY = mediaKey(TEST_S3_BUCKET.name, 'test/source.webp');
const RESULT_FILENAME = 'test/processed.png';
const PNG_BYTES = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=',
	'base64'
);
const SNAPSHOT: RequestFormSnapshot = {
	...TEST_FORM_SNAPSHOT,
	editOperationType: 'photo-processing',
	photoAdjustments: { ...defaultPhotoAdjustments(), exposure: 20, temperature: -8, grain: 4 }
};

interface SavedRow {
	id: string;
	user_id: string;
	source_filename: string;
	result_filename: string;
	kind: string;
	amount: number;
	entry_side: string;
	reason: string;
	session_id: string;
	form_snapshot: string;
}

async function seedUser(db: D1Database, balance?: number): Promise<void> {
	const now = Date.now();
	await db
		.prepare('INSERT INTO users (id, pubkey, created_at) VALUES (?, ?, ?)')
		.bind(USER_ID, PUBKEY, now)
		.run();
	await db
		.prepare(
			'INSERT INTO projects (id, user_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
		)
		.bind('photo-project', USER_ID, 'Photo project', now, now)
		.run();
	await db
		.prepare(
			'INSERT INTO project_sessions (id, project_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
		)
		.bind(SESSION_ID, 'photo-project', 'Photo session', now, now)
		.run();
	if (balance !== undefined) await seedCredit(createDb(db), USER_ID, balance, 0, now);
	await seedManagedMedia(createDb(db));
}

function formData(
	options: {
		file?: Blob;
		sessionId?: string;
		imageKey?: string;
		formSnapshot?: unknown;
	} = {}
): FormData {
	const form = new FormData();
	form.append(
		'file',
		options.file ?? new Blob([PNG_BYTES], { type: 'image/png' }),
		'processed.png'
	);
	form.set('imageKey', options.imageKey ?? SOURCE_KEY);
	form.set('sessionId', options.sessionId ?? SESSION_ID);
	form.set('formSnapshot', JSON.stringify(options.formSnapshot ?? SNAPSHOT));
	return form;
}

function call(
	db: D1Database,
	data: FormData = formData(),
	user: SessionUser | null = { pubkey: PUBKEY },
	headers?: HeadersInit
): ReturnType<typeof POST> {
	return POST({
		request: new Request('https://cadbos.example/api/photo-processing', {
			method: 'POST',
			body: data,
			headers
		}),
		platform: { env: { ...TEST_S3_ENV, DB: db } } as App.Platform,
		locals: { user, sessionLookupUnavailable: false }
	} as Parameters<typeof POST>[0]);
}

beforeEach(() => {
	vi.mocked(uploadImageBytes).mockReset();
	vi.mocked(uploadImageBytes).mockImplementation(async (_platform, _bucket, bytes, mime) => {
		const normalizedMime = normalizeImageContentType(mime);
		if (!normalizedMime) throw new Error('Unsupported upload mock MIME');
		return {
			key: RESULT_FILENAME,
			mime: normalizedMime,
			size: bytes.byteLength,
			hash: 'processed-checksum'
		};
	});
});

describe('POST /api/photo-processing', () => {
	it('requires authentication before accepting uploads', async () => {
		const response = await call(makeD1(), formData(), null);
		expect(response.status).toBe(401);
		expect(uploadImageBytes).not.toHaveBeenCalled();
	});

	it('rejects another user’s session without storing the image', async () => {
		const db = makeD1();
		await seedUser(db);
		const foreignSessionId = await seedForeignSession(createDb(db));

		const response = await call(db, formData({ sessionId: foreignSessionId }));
		expect(response.status).toBe(404);
		expect(await response.json()).toMatchObject({ error: { code: 'session_not_found' } });
		expect(uploadImageBytes).not.toHaveBeenCalled();
	});

	it.each([
		{ ...SNAPSHOT, photoAdjustments: { ...SNAPSHOT.photoAdjustments, exposure: 101 } },
		{ ...SNAPSHOT, photoAdjustments: { ...SNAPSHOT.photoAdjustments, grain: -1 } },
		{ ...SNAPSHOT, photoAdjustments: { ...SNAPSHOT.photoAdjustments, contrast: 0.5 } },
		{ ...SNAPSHOT, photoAdjustments: undefined },
		{ ...SNAPSHOT, editOperationType: 'upscale' }
	])('rejects invalid or incomplete processing settings %#', async (formSnapshot) => {
		const db = makeD1();
		await seedUser(db);
		const response = await call(db, formData({ formSnapshot }));
		expect(response.status).toBe(400);
		expect(await response.json()).toMatchObject({ error: { code: 'invalid_request' } });
		expect(uploadImageBytes).not.toHaveBeenCalled();
	});

	it('rejects malformed settings JSON', async () => {
		const data = formData();
		data.set('formSnapshot', '{');
		const response = await call(makeD1(), data);
		expect(response.status).toBe(400);
		expect(uploadImageBytes).not.toHaveBeenCalled();
	});

	it.each(['image/jpeg', 'image/webp', 'image/avif', 'image/svg+xml'])(
		'rejects a PNG payload claiming MIME %s',
		async (type) => {
			const db = makeD1();
			await seedUser(db);
			const response = await call(db, formData({ file: new Blob([PNG_BYTES], { type }) }));
			expect(response.status).toBe(415);
			expect(await response.json()).toMatchObject({ error: { code: 'unsupported_image_type' } });
			expect(uploadImageBytes).not.toHaveBeenCalled();
		}
	);

	it.each(['avif', 'avis'])(
		'accepts an AVIF container with %s as its major brand',
		async (brand) => {
			const db = makeD1();
			await seedUser(db);
			const bytes = Buffer.from([0, 0, 0, 24, 102, 116, 121, 112]);
			const file = new Blob([bytes, brand, new Uint8Array(4), 'avifmif1'], { type: 'image/avif' });
			const response = await call(db, formData({ file }));
			expect(response.status).toBe(200);
			expect(uploadImageBytes).toHaveBeenCalledTimes(1);
			expect(vi.mocked(uploadImageBytes).mock.calls[0][3]).toBe('image/avif');
		}
	);

	it('accepts AVIF as a compatible brand and rejects a generic ISOBMFF file', async () => {
		const db = makeD1();
		await seedUser(db);
		const header = Buffer.from([0, 0, 0, 24, 102, 116, 121, 112]);
		const accepted = await call(
			db,
			formData({
				file: new Blob([header, 'mif1', new Uint8Array(4), 'mif1avif'], { type: 'image/avif' })
			})
		);
		expect(accepted.status).toBe(200);
		const rejected = await call(
			db,
			formData({
				file: new Blob([header, 'mif1', new Uint8Array(4), 'mif1heic'], { type: 'image/avif' })
			})
		);
		expect(rejected.status).toBe(415);
		expect(uploadImageBytes).toHaveBeenCalledTimes(1);
	});

	it('rejects non-image bytes even when the declared MIME is allowed', async () => {
		const db = makeD1();
		await seedUser(db);
		const response = await call(
			db,
			formData({ file: new Blob(['not a photo'], { type: 'image/png' }) })
		);
		expect(response.status).toBe(415);
		expect(uploadImageBytes).not.toHaveBeenCalled();
	});

	it('rejects an oversized upload before parsing the multipart body', async () => {
		const response = await call(
			makeD1(),
			formData(),
			{ pubkey: PUBKEY },
			{
				'content-length': String(MAX_PROCESSED_PHOTO_SIZE + 128 * 1024 + 1)
			}
		);
		expect(response.status).toBe(413);
		expect(await response.json()).toMatchObject({ error: { code: 'image_too_large' } });
		expect(uploadImageBytes).not.toHaveBeenCalled();
	});

	it('enforces the file size limit without trusting the content-length header', async () => {
		const response = await call(
			makeD1(),
			formData({
				file: new Blob([new Uint8Array(MAX_PROCESSED_PHOTO_SIZE + 1)], { type: 'image/png' })
			})
		);
		expect(response.status).toBe(413);
		expect(uploadImageBytes).not.toHaveBeenCalled();
	});

	it('requires a stored source image', async () => {
		const db = makeD1();
		await seedUser(db);
		const response = await call(
			db,
			formData({ imageKey: mediaKey(TEST_S3_BUCKET.name, 'missing.png') })
		);
		expect(response.status).toBe(404);
		expect(await response.json()).toMatchObject({ error: { code: 'image_not_found' } });
		expect(uploadImageBytes).not.toHaveBeenCalled();
	});

	it.each([12.5, 0, -1, undefined])(
		'saves source, result and settings for free with credit balance %s',
		async (balance) => {
			const db = makeD1();
			await seedUser(db, balance);
			const ledgerBefore = await db.prepare('SELECT * FROM ledger_entries ORDER BY id').all();
			const response = await call(db);
			expect(response.status).toBe(200);
			const result = (await response.json()) as RenderResponse;
			expect(result).toMatchObject({
				id: expect.any(String),
				output: {
					key: mediaKey(TEST_S3_BUCKET.name, RESULT_FILENAME),
					url: `/api/media/${mediaKey(TEST_S3_BUCKET.name, RESULT_FILENAME)}`
				},
				cost: 0,
				balance: balance ?? 0
			});
			const row = await db
				.prepare(
					'SELECT g.id, g.user_id, source.filename AS source_filename, result.filename AS result_filename, ' +
						'g.kind, l.amount, l.entry_side, l.reason, g.session_id, g.form_snapshot FROM generations g ' +
						'JOIN ledger_entries l ON l.id = g.ledger_entry_id AND l.user_id = g.user_id ' +
						'JOIN media source ON source.id = g.source_media_id ' +
						'JOIN media result ON result.id = g.result_media_id WHERE g.id = ?'
				)
				.bind(result.id)
				.first<SavedRow>();
			expect(row).toMatchObject({
				id: result.id,
				user_id: USER_ID,
				source_filename: 'test/source.webp',
				result_filename: RESULT_FILENAME,
				kind: 'photo-processing',
				amount: 0,
				entry_side: 'debit',
				reason: 'generation-charge',
				session_id: SESSION_ID
			});
			expect(JSON.parse(row?.form_snapshot ?? 'null')).toEqual(SNAPSHOT);
			const credits = await db
				.prepare('SELECT enabled FROM credits WHERE user_id = ?')
				.bind(USER_ID)
				.first<{ enabled: number }>();
			expect(credits).toEqual(balance === undefined ? null : { enabled: 0 });
			const { results: ledgerAfter } = await db
				.prepare('SELECT * FROM ledger_entries ORDER BY id')
				.all();
			expect(ledgerAfter).toHaveLength(ledgerBefore.results.length + 1);
			expect(ledgerAfter.slice(0, -1)).toEqual(ledgerBefore.results);
			expect(ledgerAfter.at(-1)).toMatchObject({
				user_id: USER_ID,
				amount: 0,
				entry_side: 'debit',
				reason: 'generation-charge'
			});
			expect(uploadImageBytes).toHaveBeenCalledTimes(1);
			const storedBytes = vi.mocked(uploadImageBytes).mock.calls[0][2];
			expect(Buffer.from(storedBytes)).toEqual(PNG_BYTES);
		}
	);

	it('surfaces a storage failure and does not write a successful history entry', async () => {
		const db = makeD1();
		await seedUser(db, 12);
		const ledgerBefore = await db.prepare('SELECT * FROM ledger_entries ORDER BY id').all();
		vi.mocked(uploadImageBytes).mockRejectedValueOnce(new Error('private upload failure'));
		const logger = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		try {
			const response = await call(db);
			expect(response.status).toBe(500);
			expect(await response.json()).toMatchObject({ error: { code: 'photo_processing_failed' } });
			expect(logger).toHaveBeenCalledWith('Photo processing save failed:', 'Error');
			expect(await db.prepare('SELECT COUNT(*) AS count FROM generations').first()).toEqual({
				count: 0
			});
			expect(await db.prepare('SELECT * FROM ledger_entries ORDER BY id').all()).toEqual(
				ledgerBefore
			);
		} finally {
			logger.mockRestore();
		}
	});
});
