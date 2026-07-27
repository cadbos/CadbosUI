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
	import { beforeNavigate, goto } from '$app/navigation';
	import { page } from '$app/state';
	import { z } from 'zod';
	import type {
		ColorReplacementCompletedResponse,
		ColorReplacementJobResponse
	} from '$lib/api/contract';
	import { t, type TranslationKey } from '$lib/i18n/index.svelte';
	import { auth } from '$lib/state/auth.svelte';
	import { generatedImages } from '$lib/state/generated-images.svelte';
	import { generationOverlay } from '$lib/state/generation-overlay.svelte';
	import { extractApiErrorCode, request } from '$lib/state/request.svelte';
	import { buildShareUrl, isEditToolRoute } from '$lib/state/url-state';
	import { logBoundaryError } from '$lib/utils';

	const MAX_TRANSIENT_FAILURES = 5;
	const DEFAULT_POLL_DELAY_MS = 2_000;
	const MAX_POLL_DELAY_MS = 30_000;
	const POLL_REQUEST_TIMEOUT_MS = 150_000;

	const jobResponseSchema = z.discriminatedUnion('status', [
		z.object({ id: z.string().uuid(), status: z.literal('processing') }).strict(),
		z
			.object({
				id: z.string().uuid(),
				status: z.literal('completed'),
				outputUrl: z.string().url(),
				cost: z.number().nonnegative(),
				balance: z.number()
			})
			.strict(),
		z
			.object({
				id: z.string().uuid(),
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
	let terminalJob = $state<ColorReplacementCompletedResponse | null>(null);
	let terminalError = $state<PollFailure | null>(null);
	let pollFailure = $state<PollFailure | null>(null);
	let navigatedAwayWhileSubmitting = false;
	let pollRun = 0;
	const isAuthenticated = $derived(auth.status === 'authenticated');
	const jobId = $derived(request.activeColorReplacementJobId ?? null);
	const validation = $derived(request.validateColorReplacement());
	const isPolling = $derived(
		jobId !== null &&
			terminalJob?.id !== jobId &&
			terminalError?.jobId !== jobId &&
			pollFailure?.jobId !== jobId
	);
	const formLocked = $derived(submitting || jobId !== null);
	const canSubmit = $derived(validation.valid && !formLocked && isAuthenticated);
	const validationKey = $derived.by((): TranslationKey | null => {
		const field = validation.missing[0];
		if (field === 'image') return 'colorReplacement.validationSource';
		if (field === 'targetObject') return 'colorReplacement.validationTarget';
		if (field === 'color') return 'colorReplacement.validationColor';
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

	$effect(() => {
		if (!(submitting || isPolling)) return;
		const overlayId = generationOverlay.start('generationOverlay.colorReplacement');
		return () => generationOverlay.stop(overlayId);
	});

	beforeNavigate(({ to }) => {
		if (
			submitting &&
			(to === null || !isEditToolRoute(to.route.id, to.url.searchParams, 'color-replacement'))
		) {
			navigatedAwayWhileSubmitting = true;
		}
	});

	function inputValue(event: Event): string {
		return event.currentTarget instanceof HTMLInputElement ? event.currentTarget.value : '';
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
		if (code === 'unauthorized') return 'colorReplacement.signInToApply';
		if (code === 'insufficient_credit') return 'colorReplacement.insufficientCredit';
		if (code === 'generation_restricted') return 'colorReplacement.generationRestricted';
		if (code === 'rate_limited') return 'colorReplacement.rateLimited';
		if (code === 'color_replacement_not_found') return 'colorReplacement.notFound';
		if (code === 'color_replacement_timeout') return 'colorReplacement.timedOut';
		return 'colorReplacement.failed';
	}

	function applyCompletedJob(result: ColorReplacementCompletedResponse): void {
		if (request.currentRender?.id === result.id) {
			void auth.refreshCredit();
			if (auth.canLoadGeneratedImages) void generatedImages.load();
			return;
		}
		const context = request.activeColorReplacementJob;
		if (context?.id === result.id && context.sourceRender) {
			request.applyEditResult(
				{
					id: result.id,
					outputUrls: [result.outputUrl],
					cost: result.cost,
					balance: result.balance,
					parentId: context.sourceRender.id,
					editOp: {
						type: 'change-surface-color',
						instruction: `${context.targetObject} → ${context.color}`
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
	): Promise<ColorReplacementJobResponse> {
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
				response = await fetch(`/api/color-replacement/${encodeURIComponent(id)}`, {
					signal: requestSignal
				});
			} catch (error) {
				if (signal.aborted || run !== pollRun) return;
				failures += 1;
				if (failures > MAX_TRANSIENT_FAILURES) {
					pollFailure = { jobId: id, key: 'colorReplacement.pollFailed' };
					return;
				}
				if (!(error instanceof Error)) logBoundaryError('colorReplacement.poll', error);
				await waitFor(transientDelay(failures), signal);
				continue;
			}
			if (signal.aborted || run !== pollRun) return;

			if (!response.ok) {
				const code = await extractApiErrorCode(response, 'color_replacement_poll_failed');
				if (signal.aborted || run !== pollRun) return;
				if (response.status >= 500 && failures < MAX_TRANSIENT_FAILURES) {
					failures += 1;
					await waitFor(transientDelay(failures), signal);
					continue;
				}
				if (response.status >= 500) pollFailure = { jobId: id, key: errorKey(code) };
				else terminalError = { jobId: id, key: errorKey(code) };
				return;
			}

			failures = 0;
			let result: ColorReplacementJobResponse;
			try {
				result = await parseJobResponse(response, id);
			} catch {
				if (signal.aborted || run !== pollRun) return;
				if (requestSignal.aborted) {
					failures += 1;
					if (failures > MAX_TRANSIENT_FAILURES) {
						pollFailure = { jobId: id, key: 'colorReplacement.pollFailed' };
						return;
					}
					await waitFor(transientDelay(failures), signal);
					continue;
				}
				pollFailure = { jobId: id, key: 'colorReplacement.pollFailed' };
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
		if (!canSubmit) return;
		const body = request.toColorReplacementRequest();
		if (!body) return;
		const sourceRender = request.currentRender;
		navigatedAwayWhileSubmitting = false;
		submitting = true;
		terminalJob = null;
		terminalError = null;
		pollFailure = null;
		try {
			const response = await fetch('/api/color-replacement', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body)
			});
			if (!response.ok) {
				const code = await extractApiErrorCode(response, 'color_replacement_failed');
				terminalError = { jobId: '', key: errorKey(code) };
				return;
			}
			const result = await parseJobResponse(response);
			if (result.status !== 'processing') throw new Error('invalid_response');
			request.setActiveColorReplacementJob(result.id, sourceRender, body.targetObject, body.color);
			if (
				navigatedAwayWhileSubmitting ||
				!isEditToolRoute(page.route.id, page.url.searchParams, 'color-replacement')
			) {
				return;
			}
			try {
				await goto(buildShareUrl('edit', request, { tool: 'color-replacement' }), {
					replaceState: true,
					keepFocus: true,
					noScroll: true
				});
			} catch (error) {
				logBoundaryError('colorReplacement.jobNavigation', error);
			}
		} catch {
			terminalError = { jobId: '', key: 'colorReplacement.failed' };
		} finally {
			submitting = false;
		}
	}

	function retryPolling(): void {
		pollFailure = null;
	}

	async function clearJob(): Promise<void> {
		request.setActiveColorReplacementJobId(undefined);
		request.setColorReplacementTarget('');
		request.setColorReplacementColor('');
		terminalJob = null;
		terminalError = null;
		pollFailure = null;
		window.scrollTo({ top: 0, behavior: 'smooth' });
		await goto(buildShareUrl('edit', request, { tool: 'color-replacement' }), {
			replaceState: true,
			keepFocus: true,
			noScroll: true
		}).catch((error: unknown) => logBoundaryError('colorReplacement.clearJobNavigation', error));
	}
</script>

<aside class="alpha-notice" aria-label={t('colorReplacement.alpha')}>
	<span class="alpha-badge">{t('colorReplacement.alpha')}</span>
	<p>{t('colorReplacement.alphaNotice')}</p>
</aside>

<section class="replacement-section">
	<div class="section-header">
		<h3>{t('colorReplacement.targetLabel')}</h3>
		<span class="required-badge">{t('colorReplacement.required')}</span>
	</div>
	<label class="text-field">
		<span>{t('colorReplacement.targetHint')}</span>
		<input
			type="text"
			value={request.colorReplacementTarget}
			maxlength="200"
			required
			disabled={formLocked}
			placeholder={t('colorReplacement.targetPlaceholder')}
			oninput={(event) => request.setColorReplacementTarget(inputValue(event))}
		/>
	</label>
</section>

<section class="replacement-section">
	<div class="section-header">
		<h3>{t('colorReplacement.colorLabel')}</h3>
		<span class="required-badge">{t('colorReplacement.required')}</span>
	</div>
	<label class="text-field">
		<span>{t('colorReplacement.colorHint')}</span>
		<input
			type="text"
			value={request.colorReplacementColor}
			maxlength="200"
			required
			disabled={formLocked}
			placeholder={t('colorReplacement.colorPlaceholder')}
			oninput={(event) => request.setColorReplacementColor(inputValue(event))}
		/>
	</label>
</section>

<section class="replacement-section generate-section">
	<h3>{t('colorReplacement.controls')}</h3>

	{#if !isAuthenticated}
		<p class="auth-hint">{t('colorReplacement.signInToApply')}</p>
	{:else if validationKey && jobId === null}
		<p class="validation-hint">{t(validationKey)}</p>
	{/if}

	<button type="button" class="generate-btn" disabled={!canSubmit} onclick={() => void submit()}>
		{#if submitting}
			<span class="spinner" aria-hidden="true"></span>
			{t('colorReplacement.submitting')}
		{:else if isPolling}
			{t('colorReplacement.processing')}
		{:else if terminalJob?.id === jobId}
			{t('colorReplacement.completed')}
		{:else}
			{t('colorReplacement.apply')}
		{/if}
	</button>

	<div class="job-live" role="status" aria-live="polite" aria-atomic="true">
		{#if isPolling}
			<p class="job-status">
				<span class="spinner" aria-hidden="true"></span>
				{t('colorReplacement.processing')}
			</p>
		{:else if terminalJob?.id === jobId}
			<p class="job-success">{t('colorReplacement.completed')}</p>
		{/if}
	</div>

	{#if terminalJob?.id === jobId}
		<button type="button" class="secondary-btn" onclick={() => void clearJob()}>
			{t('colorReplacement.newReplacement')}
		</button>
	{:else if terminalError?.jobId === jobId || (terminalError?.jobId === '' && jobId === null)}
		<p class="submit-error" role="alert">{t(terminalError.key)}</p>
		{#if jobId !== null}
			<button type="button" class="secondary-btn" onclick={() => void clearJob()}>
				{t('colorReplacement.tryAgain')}
			</button>
		{/if}
	{:else if pollFailure?.jobId === jobId}
		<p class="submit-error" role="alert">{t(pollFailure.key)}</p>
		<button type="button" class="secondary-btn" onclick={retryPolling}>
			{t('colorReplacement.retryStatus')}
		</button>
	{/if}
</section>

<style>
	.alpha-notice {
		width: 100%;
		display: flex;
		align-items: flex-start;
		gap: 0.75rem;
		box-sizing: border-box;
		padding: 0.875rem 1rem;
		border: 1px solid color-mix(in srgb, var(--color-accent) 35%, var(--color-border));
		border-radius: var(--radius);
		background: color-mix(in srgb, var(--color-accent) 7%, var(--color-surface));
	}

	.alpha-notice p,
	.replacement-section h3,
	.job-status,
	.job-success,
	.validation-hint {
		margin: 0;
	}

	.alpha-notice p {
		font-size: 0.875rem;
		line-height: 1.5;
		color: var(--color-text);
	}

	.alpha-badge {
		flex: 0 0 auto;
		padding: 0.2rem 0.5rem;
		border-radius: 100px;
		background: var(--color-accent);
		color: var(--color-accent-contrast);
		font-size: 0.6875rem;
		font-weight: 700;
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}

	.replacement-section {
		display: flex;
		flex-direction: column;
		gap: 0.875rem;
		padding-top: 1rem;
		border-top: 1px solid var(--color-border);
	}

	.replacement-section h3 {
		font-size: 1rem;
		font-weight: 600;
	}

	.section-header {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.required-badge {
		margin-left: auto;
		padding: 0.15rem 0.5rem;
		border: 1px solid var(--color-border);
		border-radius: 100px;
		color: var(--color-muted-strong);
		font-size: 0.6875rem;
		font-weight: 600;
	}

	.text-field {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		font-size: 0.875rem;
		color: var(--color-muted-strong);
	}

	.text-field input {
		width: 100%;
		box-sizing: border-box;
		padding: 0.75rem 1rem;
		border: 1.5px solid var(--color-muted-strong);
		border-radius: var(--radius);
		background: var(--color-surface);
		color: var(--color-text);
		font: inherit;
	}

	.text-field input:focus {
		border-color: var(--color-border-focus);
	}

	.text-field input:disabled {
		opacity: 0.75;
		cursor: not-allowed;
	}

	.validation-hint,
	.job-status {
		font-size: 0.875rem;
		color: var(--color-muted-strong);
	}

	.job-live:empty {
		display: none;
	}

	.job-status {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.625rem;
	}

	.job-success {
		font-size: 0.9375rem;
		font-weight: 600;
		color: var(--color-accent);
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
		color: var(--color-accent);
	}
</style>
