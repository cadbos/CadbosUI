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

import { sql } from 'drizzle-orm';
import type { GenerationEstimate, GenerationProvider } from '$lib/api/contract';
import type { Database } from '$lib/server/db';
import { generationKindForRow } from '$lib/server/generations';

// Recent runs reflect the current models and hardware; a handful is enough
// for a stable median without letting one slow outlier dominate.
const ESTIMATE_SAMPLE_SIZE = 20;
const ESTIMATE_MIN_SAMPLES = 3;

interface DurationRow {
	id: string;
	kind: string;
	provider: GenerationProvider;
	total_sec: number;
}

function median(values: number[]): number {
	const sorted = values.toSorted((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

// Each generation row carries the stage durations of the provider that made
// it (migrations/0017); the other provider's columns stay 0, and rows that
// predate duration tracking are all 0 and therefore skipped.
export async function getGenerationEstimates(db: Database): Promise<GenerationEstimate[]> {
	const rows = await db.all<DurationRow>(sql`
		SELECT id, kind, provider, total_sec FROM (
			SELECT id, kind, provider, total_sec,
				ROW_NUMBER() OVER (PARTITION BY kind, provider ORDER BY created_at DESC) AS recency
			FROM (
				SELECT id, kind, created_at,
					CASE
						WHEN archai_render_sec + archai_download_sec + archai_reupload_sec > 0 THEN 'archai'
						ELSE 'comfyui'
					END AS provider,
					comfyui_upload_queue_sec + comfyui_queue_wait_sec + comfyui_execution_sec +
						comfyui_download_sec + comfyui_reupload_sec +
						archai_render_sec + archai_download_sec + archai_reupload_sec AS total_sec
				FROM generations
			)
			WHERE total_sec > 0
		)
		WHERE recency <= ${ESTIMATE_SAMPLE_SIZE}`);

	const samples = new Map<
		string,
		{ estimate: Omit<GenerationEstimate, 'seconds'>; values: number[] }
	>();
	for (const row of rows) {
		const kind = generationKindForRow(row.id, row.kind);
		if (kind === null) continue;
		const key = `${row.provider}:${kind}`;
		const entry = samples.get(key) ?? { estimate: { kind, provider: row.provider }, values: [] };
		entry.values.push(row.total_sec);
		samples.set(key, entry);
	}

	return [...samples.values()]
		.filter((entry) => entry.values.length >= ESTIMATE_MIN_SAMPLES)
		.map((entry) => ({ ...entry.estimate, seconds: Math.round(median(entry.values)) }));
}
