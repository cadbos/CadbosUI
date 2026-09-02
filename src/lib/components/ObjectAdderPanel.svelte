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
	import { extractApiErrorCode, request, RequestImageUploadError } from '$lib/state/request.svelte';
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

	async function submit(): Promise<void> {
		if (!canSubmit || !objectAdder.objectImage || !objectAdder.rect) return;
		submitting = true;
		terminalJob = null;
		terminalError = null;
		pollFailure = null;
		try {
			const sourceRender = request.currentRender;
			const body = await request.toObjectAdderRequest(objectAdder.objectImage, objectAdder.rect);
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
		} finally {
			submitting = false;
		}
	}

	function retryPolling(): void {
		pollFailure = null;
	}

	function clearJob(): void {
		request.setActiveObjectAdderJobId(undefined);
		request.setObjectAdderPrompt('');
		objectAdder.clear();
		terminalJob = null;
		terminalError = null;
		pollFailure = null;
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
		<button type="button" class="secondary-btn" onclick={clearJob}>
			{t('objectAdder.newRequest')}
		</button>
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
	.validation-hint {
		margin: 0;
		font-size: 0.875rem;
		color: var(--color-muted);
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
