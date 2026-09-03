<!--
Copyright (c) 2026 Cadbos company. All rights reserved.

SPDX-License-Identifier: LicenseRef-Cadbos-BSL-1.1

Cadbos Interior Design AI is licensed under the Business Source License 1.1.
Access is limited to automated analysis tools for analysis of this repository.
This code is not open for contribution or usage except under a separate written
agreement with Cadbos company.

Commercial use in Interior Design & AEC Generative AI Services is prohibited
before the Change Date. See LICENSE for complete terms.
-->

<script lang="ts">
	import { z } from 'zod';
	import type { ObjectAdderCompletedResponse, ObjectAdderJobResponse } from '$lib/api/contract';
	import { t, type TranslationKey } from '$lib/i18n/index.svelte';
	import { auth } from '$lib/state/auth.svelte';
	import { generatedImages } from '$lib/state/generated-images.svelte';
	import { generationOverlay } from '$lib/state/generation-overlay.svelte';
	import { objectAdder } from '$lib/state/object-adder.svelte';
	import {
		extractApiErrorCode,
		request,
		RequestImageUploadError,
		type RenderResult
	} from '$lib/state/request.svelte';
	import { logBoundaryError } from '$lib/utils';

	const MAX_TRANSIENT_FAILURES = 5;
	const DEFAULT_POLL_DELAY_MS = 2_000;
	const MAX_POLL_DELAY_MS = 30_000;
	// Generous enough to outlast the server's own ComfyUI wait (2min) plus
	// upload/finalize time, but finite so a stalled connection is retried
	// instead of leaving pollJob awaiting a response that never arrives.
	const POLL_REQUEST_TIMEOUT_MS = 150_000;

	const jobResponseSchema = z.discriminatedUnion('status', [
		z.object({ id: z.uuid(), status: z.literal('processing') }).strict(),
		z
			.object({
				id: z.uuid(),
				status: z.literal('completed'),
				outputUrl: z.url(),
				cost: z.number().nonnegative(),
				balance: z.number()
			})
			.strict(),
		z
			.object({
				id: z.uuid(),
				status: z.literal('failed'),
				error: z.object({ code: z.string(), message: z.string() }).strict()
			})
			.strict()
	]);

	interface PollFailure {
		jobId: string;
		key: TranslationKey;
	}

	let submitting = $state(false);
	let terminalJob = $state<ObjectAdderCompletedResponse | null>(null);
	let terminalError = $state<PollFailure | null>(null);
	let pollFailure = $state<PollFailure | null>(null);
	let pollRun = 0;
	// The exact scene resolved for the last submission — kept so "regenerate"
	// can reuse the original scene instead of whatever resolveEditSource()
	// resolves to *now* (see toObjectAdderRequest's own comment). Not reset by
	// clearJob() — a fresh "add another" attempt re-resolves its own scene at
	// submit time regardless.
	let lastScene = $state<{ url: string; hash?: string } | null>(null);
	const isAuthenticated = $derived(auth.status === 'authenticated');
	const jobId = $derived(request.activeObjectAdderJobId ?? null);
	const validation = $derived(request.validateObjectAdder());
	const isPolling = $derived(
		jobId !== null &&
			terminalJob?.id !== jobId &&
			terminalError?.jobId !== jobId &&
			pollFailure?.jobId !== jobId
	);
	const formLocked = $derived(submitting || jobId !== null);
	const canSubmit = $derived(
		validation.valid &&
			objectAdder.objectImage !== undefined &&
			objectAdder.rect !== null &&
			!formLocked &&
			isAuthenticated
	);
	const validationKey = $derived.by((): TranslationKey | null => {
		if (validation.missing.includes('image')) return 'objectAdder.validationSource';
		if (!objectAdder.objectImage || objectAdder.rect === null)
			return 'objectAdder.validationObject';
		return null;
	});

	$effect(() => {
		const id = jobId;
		const authenticated = isAuthenticated;
		const failedPoll = pollFailure;
		const run = ++pollRun;
		if (!id || !authenticated || failedPoll?.jobId === id) return;
		const controller = new AbortController();
		void pollJob(id, controller.signal, run);
		return () => controller.abort();
	});

	// The full-screen overlay tracks this flow's own in-flight state (not just
	// the button's `submitting`) since the wait spans the async job queue +
	// poll cycle, not a single fetch.
	$effect(() => {
		if (!(submitting || isPolling)) return;
		const overlayId = generationOverlay.start(
			'generationOverlay.objectAdder',
			'generationOverlay.objectAdderDetail'
		);
		return () => generationOverlay.stop(overlayId);
	});

	// ObjectAdderCanvas.svelte isn't sticky-mounted like this panel — leaving
	// reference mode (Presets) and coming back destroys and recreates it, and
	// objectAdder.setReferenceMode(true) resets objectAdder.resultReady so
	// Workspace.svelte shows that fresh canvas again instead of the finished
	// result. But without this, the *job* itself (jobId, terminalJob) is
	// untouched — the canvas reopens (with its existing placement, since that
	// lives in the objectAdder store, not this component) while this panel
	// keeps showing the previous attempt's disabled "completed"/"failed"
	// button and success message, out of sync with what the user is actually
	// looking at. resetJobState() only clears the stale job/terminal display,
	// not the placement or prompt — same reasoning as "regenerate": the
	// canvas reopening isn't the user asking to start over.
	$effect(() => {
		if (
			objectAdder.referenceMode &&
			!objectAdder.resultReady &&
			jobId !== null &&
			(terminalJob?.id === jobId || terminalError?.jobId === jobId)
		) {
			resetJobState();
		}
	});

	function textareaValue(event: Event): string {
		return event.currentTarget instanceof HTMLTextAreaElement ? event.currentTarget.value : '';
	}

	function parseRetryAfter(response: Response): number {
		const value = response.headers.get('retry-after');
		if (value === null) return DEFAULT_POLL_DELAY_MS;
		const seconds = Number(value);
		const delay = Number.isFinite(seconds) ? seconds * 1_000 : Date.parse(value) - Date.now();
		if (!Number.isFinite(delay)) return DEFAULT_POLL_DELAY_MS;
		return Math.min(Math.max(delay, 1_000), MAX_POLL_DELAY_MS);
	}

	function transientDelay(failures: number): number {
		return Math.min(DEFAULT_POLL_DELAY_MS * 2 ** (failures - 1), MAX_POLL_DELAY_MS);
	}

	function waitFor(ms: number, signal: AbortSignal): Promise<void> {
		return new Promise((resolve) => {
			const timeout = setTimeout(done, ms);
			function done(): void {
				clearTimeout(timeout);
				signal.removeEventListener('abort', done);
				resolve();
			}
			signal.addEventListener('abort', done, { once: true });
		});
	}

	function errorKey(code: string): TranslationKey {
		if (code === 'insufficient_credit') return 'objectAdder.insufficientCredit';
		if (code === 'generation_restricted') return 'objectAdder.generationRestricted';
		if (code === 'rate_limited') return 'objectAdder.rateLimited';
		if (code === 'object_adder_not_found') return 'objectAdder.notFound';
		if (code === 'object_adder_timeout') return 'objectAdder.timedOut';
		return 'objectAdder.failed';
	}

	function applyCompletedJob(result: ObjectAdderCompletedResponse): void {
		objectAdder.setResultReady(true);
		if (request.currentRender?.id === result.id) {
			void auth.refreshCredit();
			if (auth.canLoadGeneratedImages) void generatedImages.load();
			return;
		}
		const context = request.activeObjectAdderJob;
		if (context?.id === result.id && context.sourceRender) {
			request.applyEditResult(
				{
					id: result.id,
					outputUrls: [result.outputUrl],
					cost: result.cost,
					balance: result.balance,
					parentId: context.sourceRender.id,
					editOp: {
						type: 'add-object-reference',
						instruction: context.prompt
					},
					ts: Date.now()
				},
				context.sourceRender
			);
		} else {
			request.setCurrentRender({
				id: result.id,
				outputUrls: [result.outputUrl],
				cost: result.cost,
				balance: result.balance,
				ts: Date.now()
			});
		}
		void auth.refreshCredit();
		if (auth.canLoadGeneratedImages) void generatedImages.load();
	}

	async function parseJobResponse(
		response: Response,
		expectedId?: string
	): Promise<ObjectAdderJobResponse> {
		const body: unknown = await response.json().catch(() => null);
		const parsed = jobResponseSchema.safeParse(body);
		if (!parsed.success || (expectedId !== undefined && parsed.data.id !== expectedId)) {
			throw new Error('invalid_response');
		}
		return parsed.data;
	}

	async function pollJob(id: string, signal: AbortSignal, run: number): Promise<void> {
		let failures = 0;
		while (!signal.aborted && run === pollRun) {
			let response: Response;
			const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(POLL_REQUEST_TIMEOUT_MS)]);
			try {
				response = await fetch(`/api/object-adder/${encodeURIComponent(id)}`, {
					signal: requestSignal
				});
			} catch (error) {
				if (signal.aborted || run !== pollRun) return;
				failures += 1;
				if (failures > MAX_TRANSIENT_FAILURES) {
					pollFailure = { jobId: id, key: 'objectAdder.pollFailed' };
					return;
				}
				if (!(error instanceof Error)) {
					logBoundaryError('objectAdder.poll', error);
				}
				await waitFor(transientDelay(failures), signal);
				continue;
			}
			if (signal.aborted || run !== pollRun) return;

			if (!response.ok) {
				const code = await extractApiErrorCode(response, 'object_adder_poll_failed');
				if (signal.aborted || run !== pollRun) return;
				if (response.status >= 500 && failures < MAX_TRANSIENT_FAILURES) {
					failures += 1;
					await waitFor(transientDelay(failures), signal);
					continue;
				}
				if (response.status >= 500) {
					pollFailure = { jobId: id, key: errorKey(code) };
				} else {
					terminalError = { jobId: id, key: errorKey(code) };
				}
				return;
			}

			failures = 0;
			let result: ObjectAdderJobResponse;
			try {
				result = await parseJobResponse(response, id);
			} catch {
				if (signal.aborted || run !== pollRun) return;
				if (requestSignal.aborted) {
					failures += 1;
					if (failures > MAX_TRANSIENT_FAILURES) {
						pollFailure = { jobId: id, key: 'objectAdder.pollFailed' };
						return;
					}
					await waitFor(transientDelay(failures), signal);
					continue;
				}
				pollFailure = { jobId: id, key: 'objectAdder.pollFailed' };
				return;
			}
			if (signal.aborted || run !== pollRun) return;
			if (result.status === 'processing') {
				await waitFor(parseRetryAfter(response), signal);
				continue;
			}
			if (result.status === 'failed') {
				terminalError = { jobId: id, key: errorKey(result.error.code) };
				return;
			}
			terminalJob = result;
			applyCompletedJob(result);
			return;
		}
	}

	// Shared by submit() and regenerate() — everything past "resolve the
	// scene and object" is identical between a fresh attempt and a retry.
	// Deliberately does not touch `submitting` — the caller owns that lock
	// for its *entire* operation (including, for submit(), the scene
	// resolution before this is even called), since setting it only here
	// would leave a window between a click and this function's first await
	// where canSubmit still reads true, letting a fast double-click queue
	// two submissions.
	async function queueJob(
		scene: { url: string; hash?: string },
		sourceRender: RenderResult | undefined
	): Promise<void> {
		if (!objectAdder.objectImage || !objectAdder.rect) return;
		terminalJob = null;
		terminalError = null;
		pollFailure = null;
		try {
			const body = await request.toObjectAdderRequest(
				objectAdder.objectImage,
				objectAdder.rect,
				scene
			);
			if (!body) return;
			const response = await fetch('/api/object-adder', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body)
			});
			if (!response.ok) {
				const code = await extractApiErrorCode(response, 'object_adder_failed');
				terminalError = { jobId: '', key: errorKey(code) };
				return;
			}
			const result = await parseJobResponse(response);
			if (result.status !== 'processing') throw new Error('invalid_response');
			request.setActiveObjectAdderJob(result.id, sourceRender, body.prompt ?? '');
		} catch (error) {
			terminalError = {
				jobId: '',
				key: error instanceof RequestImageUploadError ? 'upload.errorUpload' : 'objectAdder.failed'
			};
		}
	}

	async function submit(): Promise<void> {
		if (!canSubmit || !objectAdder.objectImage || !objectAdder.rect) return;
		// Set synchronously, before the first await — canSubmit's formLocked
		// check must already see this on a fast second click, not just once
		// queueJob (called below, after resolving the scene) gets around to it.
		submitting = true;
		try {
			const scene = await request.resolveEditSource();
			if (!scene) return;
			lastScene = scene;
			await queueJob(scene, request.currentRender);
		} catch (error) {
			terminalError = {
				jobId: '',
				key: error instanceof RequestImageUploadError ? 'upload.errorUpload' : 'objectAdder.failed'
			};
		} finally {
			submitting = false;
		}
	}

	// Reuses the exact object/placement/prompt/scene from the last attempt —
	// for when the result itself was fine as an attempt but just didn't come
	// out as intended, without forcing the user to re-pick the object photo
	// and re-place it via "Добавить ещё" first. sourceRender comes from the
	// original job's own recorded context (still available — clearJob()
	// hasn't run), not request.currentRender, so the new attempt stays a
	// sibling of the last one in the edit history rather than a child of it.
	async function regenerate(): Promise<void> {
		if (submitting || !lastScene) return;
		// Set synchronously, before any await, same reasoning as submit() —
		// otherwise a fast double-click could both pass this check.
		submitting = true;
		const sourceRender = request.activeObjectAdderJob?.sourceRender;
		// Clears just the finished job id (not the whole clearJob() — the
		// object/rect/prompt/scene all carry over unchanged) so canSubmit's
		// jobId===null gate doesn't block the queued request below.
		request.setActiveObjectAdderJobId(undefined);
		try {
			await queueJob(lastScene, sourceRender);
		} finally {
			submitting = false;
		}
	}

	function retryPolling(): void {
		pollFailure = null;
	}

	// Just the job/terminal-display bits — leaves the placed object, rect and
	// prompt alone. Used where the intent is "this job is done with, let the
	// form be usable again" without also discarding a placement the user
	// might still want (see the reference-mode re-entry effect above).
	function resetJobState(): void {
		request.setActiveObjectAdderJobId(undefined);
		terminalJob = null;
		terminalError = null;
		pollFailure = null;
	}

	function clearJob(): void {
		resetJobState();
		request.setObjectAdderPrompt('');
		objectAdder.clear();
	}
</script>

<section class="tool">
	<label class="field">
		<span class="field-label">{t('objectAdder.promptLabel')}</span>
		<textarea
			value={request.objectAdderPrompt}
			oninput={(event) => request.setObjectAdderPrompt(textareaValue(event))}
			rows="2"
			maxlength="2000"
			disabled={formLocked}
			placeholder={t('objectAdder.promptPlaceholder')}></textarea>
	</label>

	{#if !isAuthenticated}
		<p class="auth-hint">{t('objectAdder.signInToApply')}</p>
	{:else if validationKey && jobId === null}
		<p class="validation-hint">{t(validationKey)}</p>
	{/if}

	<button type="button" class="generate-btn" disabled={!canSubmit} onclick={() => void submit()}>
		{#if submitting}
			<span class="spinner" aria-hidden="true"></span>
			{t('objectAdder.submitting')}
		{:else if isPolling}
			{t('objectAdder.processing')}
		{:else if terminalJob?.id === jobId}
			{t('objectAdder.completed')}
		{:else}
			{t('objectAdder.apply')}
		{/if}
	</button>

	<div class="job-live" role="status" aria-live="polite" aria-atomic="true">
		{#if isPolling}
			<p class="job-status">
				<span class="spinner" aria-hidden="true"></span>
				{t('objectAdder.processing')}
			</p>
		{:else if terminalJob?.id === jobId}
			<p class="job-success">{t('objectAdder.completed')}</p>
		{/if}
	</div>

	{#if terminalJob?.id === jobId}
		<p class="regenerate-hint">{t('objectAdder.regenerateHint')}</p>
		<div class="actions">
			<button
				type="button"
				class="generate-btn"
				disabled={submitting}
				onclick={() => void regenerate()}
			>
				{#if submitting}
					<span class="spinner" aria-hidden="true"></span>
				{/if}
				{t('objectAdder.regenerate')}
			</button>
			<button type="button" class="secondary-btn" onclick={clearJob}>
				{t('objectAdder.newRequest')}
			</button>
		</div>
	{:else if terminalError?.jobId === jobId || (terminalError?.jobId === '' && jobId === null)}
		<p class="submit-error" role="alert">{t(terminalError.key)}</p>
		{#if jobId !== null}
			<button type="button" class="secondary-btn" onclick={clearJob}>
				{t('objectAdder.tryAgain')}
			</button>
		{/if}
	{:else if pollFailure?.jobId === jobId}
		<p class="submit-error" role="alert">{t(pollFailure.key)}</p>
		<button type="button" class="secondary-btn" onclick={retryPolling}>
			{t('objectAdder.retryStatus')}
		</button>
	{/if}
</section>

<style>
	.tool {
		display: flex;
		flex-direction: column;
		gap: 0.875rem;
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}

	.field-label {
		font-size: 0.8125rem;
		font-weight: 500;
		color: var(--color-muted);
	}

	textarea {
		font: inherit;
		font-size: 0.9375rem;
		resize: vertical;
		padding: 0.625rem 0.875rem;
		border: 1.5px solid var(--color-border);
		border-radius: 10px;
		background: var(--color-background);
		color: var(--color-text);
		transition: border-color 0.15s;
		min-height: 3.5rem;
	}

	textarea:focus {
		outline: none;
		border-color: var(--color-accent);
	}

	textarea::placeholder {
		color: var(--color-muted);
		opacity: 0.6;
	}

	textarea:disabled {
		opacity: 0.6;
	}

	.auth-hint,
	.validation-hint,
	.regenerate-hint {
		margin: 0;
		font-size: 0.875rem;
		color: var(--color-muted);
	}

	.actions {
		display: flex;
		gap: 0.625rem;
		flex-wrap: wrap;
	}

	.generate-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		align-self: flex-start;
		padding: 0.6rem 1.25rem;
		font: inherit;
		font-size: 0.9375rem;
		font-weight: 600;
		color: var(--color-accent-contrast);
		background: var(--color-accent);
		border: none;
		border-radius: 10px;
		cursor: pointer;
		transition: background 0.15s;
	}

	.generate-btn:hover:not(:disabled) {
		background: var(--color-accent-hover);
	}

	.generate-btn:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}

	.job-live:empty {
		display: none;
	}

	.job-status,
	.job-success {
		margin: 0;
		font-size: 0.875rem;
	}

	.job-status {
		display: flex;
		align-items: center;
		gap: 0.625rem;
		color: var(--color-muted-strong);
	}

	.job-success {
		font-weight: 600;
		color: var(--color-accent-text);
	}

	.secondary-btn {
		align-self: flex-start;
		padding: 0.625rem 1rem;
		border: 1px solid var(--color-muted-strong);
		border-radius: var(--radius);
		background: var(--color-surface);
		color: var(--color-text);
		font: inherit;
		font-weight: 600;
		cursor: pointer;
	}

	.secondary-btn:hover {
		border-color: var(--color-accent);
		color: var(--color-accent-text);
	}

	.submit-error {
		margin: 0;
		font-size: 0.8125rem;
		color: var(--color-danger);
	}

	.spinner {
		width: 0.875rem;
		height: 0.875rem;
		border: 2px solid rgb(255 255 255 / 0.35);
		border-top-color: white;
		border-radius: 50%;
		animation: spin 0.7s linear infinite;
		flex-shrink: 0;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
