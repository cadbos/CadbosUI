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
import { getGenerationEstimates } from '$lib/server/generation-estimates';
import { makeDb, type TestDatabase } from '$lib/server/testing/d1-shim';
import { seedGeneration } from '$lib/server/testing/generation-fixtures';

interface Durations {
	archai?: [render: number, download: number, reupload: number];
	comfyui?: [
		uploadQueue: number,
		queueWait: number,
		execution: number,
		download: number,
		reupload: number
	];
}

let sequence = 0;

async function seedTimedGeneration(
	db: TestDatabase,
	kind: string,
	createdAt: number,
	durations: Durations
): Promise<void> {
	const id = `generation-${++sequence}`;
	await seedGeneration(db, {
		id,
		userId: 'user-1',
		url: `https://cdn.example.test/${id}.webp`,
		sourceUrl: 'https://cdn.example.test/source.jpg',
		kind,
		createdAt
	});
	const [render, download, reupload] = durations.archai ?? [0, 0, 0];
	const [uploadQueue, queueWait, execution, comfyDownload, comfyReupload] = durations.comfyui ?? [
		0, 0, 0, 0, 0
	];
	db.prepare(
		`UPDATE generations SET archai_render_sec = ?, archai_download_sec = ?, archai_reupload_sec = ?,
			comfyui_upload_queue_sec = ?, comfyui_queue_wait_sec = ?, comfyui_execution_sec = ?,
			comfyui_download_sec = ?, comfyui_reupload_sec = ? WHERE id = ?`
	)
		.bind(
			render,
			download,
			reupload,
			uploadQueue,
			queueWait,
			execution,
			comfyDownload,
			comfyReupload,
			id
		)
		.run();
}

function makeAccountDb(): TestDatabase {
	const db = makeDb();
	db.prepare('INSERT INTO users (id, pubkey, created_at) VALUES (?, ?, ?)')
		.bind('user-1', 'pubkey-1', 1)
		.run();
	return db;
}

describe('getGenerationEstimates', () => {
	it('takes the median end-to-end duration per kind and provider', async () => {
		const db = makeAccountDb();
		await seedTimedGeneration(db, 'render', 1, { archai: [20, 2, 1] });
		await seedTimedGeneration(db, 'render', 2, { archai: [30, 3, 2] });
		await seedTimedGeneration(db, 'render', 3, { archai: [90, 5, 5] });
		await seedTimedGeneration(db, 'repaint', 1, { comfyui: [3, 10, 200, 2, 1] });
		await seedTimedGeneration(db, 'repaint', 2, { comfyui: [3, 0, 180, 2, 1] });
		await seedTimedGeneration(db, 'repaint', 3, { comfyui: [3, 0, 190, 2, 1] });
		await seedTimedGeneration(db, 'repaint', 4, { comfyui: [3, 20, 210, 2, 1] });

		const estimates = await getGenerationEstimates(db);

		expect(estimates).toHaveLength(2);
		expect(estimates).toContainEqual({ kind: 'render', provider: 'archai', seconds: 35 });
		expect(estimates).toContainEqual({ kind: 'repaint', provider: 'comfyui', seconds: 206 });
	});

	it('keeps providers of one kind apart', async () => {
		const db = makeAccountDb();
		for (const createdAt of [1, 2, 3]) {
			await seedTimedGeneration(db, 'texture-replacement', createdAt, { archai: [40, 0, 0] });
			await seedTimedGeneration(db, 'texture-replacement', createdAt, {
				comfyui: [0, 0, 120, 0, 0]
			});
		}

		const estimates = await getGenerationEstimates(db);

		expect(estimates).toContainEqual({
			kind: 'texture-replacement',
			provider: 'archai',
			seconds: 40
		});
		expect(estimates).toContainEqual({
			kind: 'texture-replacement',
			provider: 'comfyui',
			seconds: 120
		});
	});

	it('uses only the most recent runs and skips rows without timings', async () => {
		const db = makeAccountDb();
		for (let createdAt = 1; createdAt <= 20; createdAt += 1) {
			await seedTimedGeneration(db, 'upscale', 100 + createdAt, { archai: [10, 0, 0] });
		}
		for (let createdAt = 1; createdAt <= 20; createdAt += 1) {
			await seedTimedGeneration(db, 'upscale', createdAt, { archai: [500, 0, 0] });
		}
		await seedTimedGeneration(db, 'upscale', 1_000, {});

		expect(await getGenerationEstimates(db)).toEqual([
			{ kind: 'upscale', provider: 'archai', seconds: 10 }
		]);
	});

	it('leaves out kinds with too little history', async () => {
		const db = makeAccountDb();
		await seedTimedGeneration(db, 'style-transfer', 1, { archai: [25, 0, 0] });
		await seedTimedGeneration(db, 'style-transfer', 2, { archai: [25, 0, 0] });

		expect(await getGenerationEstimates(db)).toEqual([]);
	});
});
