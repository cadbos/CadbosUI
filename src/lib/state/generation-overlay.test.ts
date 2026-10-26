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
import type { GenerationEstimatesResponse } from '$lib/api/contract';
import { generationEstimates } from './generation-estimates.svelte';
import { generationOverlay, trackJobProgress } from './generation-overlay.svelte';

const HOUR = 60 * 60_000;
// Each test starts its clock in its own hour so the estimates cache (kept for
// 10 minutes) never carries one test's answer into the next.
let clock = Date.now();

function nextClock(): number {
	clock += HOUR;
	return clock;
}

function serveEstimates(body: GenerationEstimatesResponse): ReturnType<typeof vi.fn> {
	const fetcher = vi.fn(async () => Response.json(body));
	vi.stubGlobal('fetch', fetcher);
	return fetcher;
}

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('generation overlay', () => {
	it('stays active until every generation flow stops', () => {
		const renderFlow = generationOverlay.start('generationOverlay.render', {
			kind: 'render',
			provider: 'archai'
		});
		const objectReplacementFlow = generationOverlay.start('generationOverlay.objectReplacement', {
			detailKey: 'generationOverlay.objectReplacementDetail',
			kind: 'object-replacement',
			provider: 'comfyui'
		});

		expect(generationOverlay.active).toBe(true);
		expect(generationOverlay.messageKey).toBe('generationOverlay.objectReplacement');
		expect(generationOverlay.detailKey).toBe('generationOverlay.objectReplacementDetail');

		generationOverlay.stop(objectReplacementFlow);

		expect(generationOverlay.active).toBe(true);
		expect(generationOverlay.messageKey).toBe('generationOverlay.render');
		expect(generationOverlay.detailKey).toBeNull();

		generationOverlay.stop(renderFlow);

		expect(generationOverlay.active).toBe(false);
		expect(generationOverlay.messageKey).toBeNull();
		expect(generationOverlay.detailKey).toBeNull();
	});

	it('restores the still-active flow label when a more recently started flow finishes first', () => {
		const objectReplacementFlow = generationOverlay.start('generationOverlay.objectReplacement', {
			detailKey: 'generationOverlay.objectReplacementDetail',
			kind: 'object-replacement',
			provider: 'comfyui'
		});
		const renderFlow = generationOverlay.start('generationOverlay.render', {
			kind: 'render',
			provider: 'archai'
		});

		expect(generationOverlay.messageKey).toBe('generationOverlay.render');

		generationOverlay.stop(renderFlow);

		expect(generationOverlay.active).toBe(true);
		expect(generationOverlay.messageKey).toBe('generationOverlay.objectReplacement');
		expect(generationOverlay.detailKey).toBe('generationOverlay.objectReplacementDetail');

		generationOverlay.stop(objectReplacementFlow);

		expect(generationOverlay.active).toBe(false);
	});
});

describe('generation progress', () => {
	it('estimates percent and remaining time from the typical duration', async () => {
		serveEstimates({ estimates: [{ kind: 'render', provider: 'archai', seconds: 40 }] });
		const start = nextClock();
		const flow = generationOverlay.start(
			'generationOverlay.render',
			{ kind: 'render', provider: 'archai' },
			start
		);
		await generationEstimates.load(start);

		expect(generationOverlay.progress(start)).toEqual({
			percent: 0,
			remainingSec: 40,
			queueAhead: null
		});
		expect(generationOverlay.progress(start + 10_500)).toEqual({
			percent: 26,
			remainingSec: 30,
			queueAhead: null
		});

		generationOverlay.stop(flow);
	});

	it('holds below 100% and reports no remaining time once the run outlasts its estimate', async () => {
		serveEstimates({ estimates: [{ kind: 'upscale', provider: 'archai', seconds: 20 }] });
		const start = nextClock();
		const flow = generationOverlay.start(
			'generationOverlay.upscale',
			{ kind: 'upscale', provider: 'archai' },
			start
		);
		await generationEstimates.load(start);

		expect(generationOverlay.progress(start + 60_000)).toEqual({
			percent: 99,
			remainingSec: null,
			queueAhead: null
		});

		generationOverlay.stop(flow);
	});

	it('has no progress for a flow without an estimate', async () => {
		serveEstimates({ estimates: [{ kind: 'render', provider: 'archai', seconds: 40 }] });
		const start = nextClock();
		const flow = generationOverlay.start(
			'generationOverlay.textureReplacement',
			{ kind: 'texture-replacement', provider: 'comfyui' },
			start
		);
		await generationEstimates.load(start);

		expect(generationOverlay.progress(start + 1_000)).toBeNull();

		generationOverlay.stop(flow);
	});

	it('counts a polled job from when it really started and shows its queue position', async () => {
		serveEstimates({ estimates: [{ kind: 'repaint', provider: 'comfyui', seconds: 200 }] });
		const start = nextClock();
		const job = trackJobProgress(null, 'job-1', { elapsedMs: 100_000, queueAhead: 2 }, start);
		const flow = generationOverlay.start(
			'generationOverlay.repaint',
			{ kind: 'repaint', provider: 'comfyui', job: () => job },
			start
		);
		await generationEstimates.load(start);

		expect(generationOverlay.progress(start)).toEqual({
			percent: 50,
			remainingSec: 100,
			queueAhead: 2
		});

		generationOverlay.stop(flow);
	});

	it('logs a failed estimates request and retries on the next generation', async () => {
		const fetcher = vi.fn(async () => new Response(null, { status: 500 }));
		vi.stubGlobal('fetch', fetcher);
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
		const start = nextClock();

		await generationEstimates.load(start);
		await generationEstimates.load(start + 1_000);

		expect(fetcher).toHaveBeenCalledTimes(2);
		expect(consoleError).toHaveBeenCalled();
	});

	it('reuses fresh estimates instead of refetching them for every generation', async () => {
		const fetcher = serveEstimates({ estimates: [] });
		const start = nextClock();

		await generationEstimates.load(start);
		await generationEstimates.load(start + 60_000);
		await generationEstimates.load(start + 11 * 60_000);

		expect(fetcher).toHaveBeenCalledTimes(2);
	});
});

describe('trackJobProgress', () => {
	it('keeps the earliest start reported for the same job', () => {
		const first = trackJobProgress(null, 'job-1', { elapsedMs: 5_000, queueAhead: 3 }, 10_000);
		const second = trackJobProgress(first, 'job-1', { elapsedMs: 6_000, queueAhead: 1 }, 12_000);

		expect(first).toEqual({ jobId: 'job-1', origin: 5_000, queueAhead: 3 });
		expect(second).toEqual({ jobId: 'job-1', origin: 5_000, queueAhead: 1 });
	});

	it('starts over for a different job', () => {
		const previous = { jobId: 'job-1', origin: 1_000, queueAhead: null };

		expect(
			trackJobProgress(previous, 'job-2', { elapsedMs: 2_000, queueAhead: null }, 50_000)
		).toEqual({ jobId: 'job-2', origin: 48_000, queueAhead: null });
	});
});
