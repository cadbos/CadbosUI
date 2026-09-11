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
	import { resolve } from '$app/paths';
	import type { PathnameWithSearchOrHash } from '$app/types';
	import { page } from '$app/state';
	import { z } from 'zod';
	import type { ProModeCompletedResponse, ProModeJobResponse } from '$lib/api/contract';
	import ImageUpload from '$lib/components/ImageUpload.svelte';
	import { t, type TranslationKey } from '$lib/i18n/index.svelte';
	import { auth } from '$lib/state/auth.svelte';
	import { generatedImages } from '$lib/state/generated-images.svelte';
	import { generationOverlay } from '$lib/state/generation-overlay.svelte';
	import { extractApiErrorCode, request, RequestImageUploadError } from '$lib/state/request.svelte';
	import { buildWorkspaceUrl, isEditToolRoute } from '$lib/state/url-state';
	import { logBoundaryError } from '$lib/utils';
	import { mediaAccess } from '$lib/state/media-access.svelte';

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
				output: z.object({
					key: z.string().min(1),
					url: z.url()
				}),
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
	let terminalJob = $state<ProModeCompletedResponse | null>(null);
	let terminalError = $state<PollFailure | null>(null);
	let pollFailure = $state<PollFailure | null>(null);
	let navigatedAwayWhileSubmitting = false;
	let pollRun = 0;
	const isAuthenticated = $derived(auth.status === 'authenticated');
	const jobId = $derived(request.activeProModeJobId ?? null);
	const validation = $derived(request.validateProMode());
	const isPolling = $derived(
		jobId !== null &&
			terminalJob?.id !== jobId &&
			terminalError?.jobId !== jobId &&
			pollFailure?.jobId !== jobId
	);
	const formLocked = $derived(submitting || jobId !== null);
	const speedVsQualityPercent = $derived(Math.round(request.proModeSpeedVsQuality * 100));
	const canSubmit = $derived(validation.valid && !formLocked && isAuthenticated);
	const validationKey = $derived.by((): TranslationKey | null => {
		const field = validation.missing[0];
		if (field === 'image') return 'proMode.validationSource';
		if (field === 'prompt') return 'proMode.validationPrompt';
		return null;
	});

	function pollingEffect(): void | (() => void) {
		const id = jobId;
		const authenticated = isAuthenticated;
		const failedPoll = pollFailure;
		const run = ++pollRun;
		if (!id || !authenticated || failedPoll?.jobId === id) return;
		const controller = new AbortController();
		void pollJob(id, controller.signal, run);
		return () => controller.abort();
	}

	$effect(pollingEffect);

	// The full-screen overlay tracks this flow's own in-flight state (not just
	// the button's `submitting`) since the wait spans the async job queue +
	// poll cycle, not a single fetch.
	function overlayEffect(): void | (() => void) {
		if (!(submitting || isPolling)) return;
		const overlayId = generationOverlay.start(
			'generationOverlay.proMode',
			'generationOverlay.proModeDetail'
		);
		return () => generationOverlay.stop(overlayId);
	}

	$effect(overlayEffect);

	beforeNavigate(({ to }) => {
		if (
			submitting &&
			(to === null || !isEditToolRoute(to.route.id, to.url.searchParams, 'pro-mode'))
		) {
			navigatedAwayWhileSubmitting = true;
		}
	});

	function promptValue(event: Event): string {
		return event.currentTarget instanceof HTMLTextAreaElement ? event.currentTarget.value : '';
	}

	function speedVsQualityValue(event: Event): number {
		return event.currentTarget instanceof HTMLInputElement
			? Number(event.currentTarget.value)
			: request.proModeSpeedVsQuality;
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
		if (code === 'unauthorized') return 'proMode.signInToApply';
		if (code === 'insufficient_credit') return 'proMode.insufficientCredit';
		if (code === 'generation_restricted') return 'proMode.generationRestricted';
		if (code === 'rate_limited') return 'proMode.rateLimited';
		if (code === 'pro_mode_not_found') return 'proMode.notFound';
		if (code === 'pro_mode_timeout') return 'proMode.timedOut';
		return 'proMode.failed';
	}

	function applyCompletedJob(result: ProModeCompletedResponse): void {
		if (request.currentRender?.id === result.id) {
			void auth.refreshCredit();
			if (auth.canLoadGeneratedImages) void generatedImages.load();
			return;
		}
		const context = request.activeProModeJob;
		if (context?.id === result.id && context.sourceRender) {
			request.applyEditResult(
				{
					id: result.id,
					outputKey: mediaAccess.normalize(result.output).key,
					cost: result.cost,
					balance: result.balance,
					parentId: context.sourceRender.id,
					editOp: {
						type: 'pro-mode',
						instruction: context.instruction
					},
					ts: Date.now()
				},
				context.sourceRender
			);
		} else {
			request.setCurrentRender({
				id: result.id,
				outputKey: mediaAccess.normalize(result.output).key,
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
	): Promise<ProModeJobResponse> {
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
				response = await fetch(`/api/pro-mode/${encodeURIComponent(id)}`, {
					signal: requestSignal
				});
			} catch (error) {
				if (signal.aborted || run !== pollRun) return;
				failures += 1;
				if (failures > MAX_TRANSIENT_FAILURES) {
					pollFailure = { jobId: id, key: 'proMode.pollFailed' };
					return;
				}
				if (!(error instanceof Error)) {
					logBoundaryError('proMode.poll', error);
				}
				await waitFor(transientDelay(failures), signal);
				continue;
			}
			if (signal.aborted || run !== pollRun) return;

			if (!response.ok) {
				const code = await extractApiErrorCode(response, 'pro_mode_poll_failed');
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
			let result: ProModeJobResponse;
			try {
				result = await parseJobResponse(response, id);
			} catch {
				if (signal.aborted || run !== pollRun) return;
				if (requestSignal.aborted) {
					failures += 1;
					if (failures > MAX_TRANSIENT_FAILURES) {
						pollFailure = { jobId: id, key: 'proMode.pollFailed' };
						return;
					}
					await waitFor(transientDelay(failures), signal);
					continue;
				}
				pollFailure = { jobId: id, key: 'proMode.pollFailed' };
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
		navigatedAwayWhileSubmitting = false;
		submitting = true;
		terminalJob = null;
		terminalError = null;
		pollFailure = null;
		try {
			const sourceRender =
				request.proModeSourceMode === 'current-result' ? request.currentRender : undefined;
			const body = await request.toProModeRequest();
			if (!body) return;
			const instruction = body.prompt;
			const response = await fetch('/api/pro-mode', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body)
			});
			if (!response.ok) {
				const code = await extractApiErrorCode(response, 'pro_mode_failed');
				terminalError = { jobId: '', key: errorKey(code) };
				return;
			}
			const result = await parseJobResponse(response);
			if (result.status !== 'processing') throw new Error('invalid_response');
			request.setActiveProModeJob(result.id, sourceRender, instruction);
			if (
				navigatedAwayWhileSubmitting ||
				!isEditToolRoute(page.route.id, page.url.searchParams, 'pro-mode')
			) {
				return;
			}
			try {
				await goto(
					resolve(
						buildWorkspaceUrl('edit', request, {
							tool: 'pro-mode'
						}) as PathnameWithSearchOrHash,
						{}
					),
					{
						replaceState: true,
						keepFocus: true,
						noScroll: true
					}
				);
			} catch (error) {
				logBoundaryError('proMode.jobNavigation', error);
			}
		} catch (error) {
			terminalError = {
				jobId: '',
				key: error instanceof RequestImageUploadError ? 'upload.errorUpload' : 'proMode.failed'
			};
		} finally {
			submitting = false;
		}
	}

	function retryPolling(): void {
		pollFailure = null;
	}

	async function clearJob(): Promise<void> {
		request.setActiveProModeJobId(undefined);
		request.setProModeReferenceImage(undefined);
		request.setProModePrompt('');
		request.setProModeSpeedVsQuality(0.5);
		request.setProModeSourceMode('current-result');
		request.setImage(undefined);
		request.setCurrentRender(undefined);
		terminalJob = null;
		terminalError = null;
		pollFailure = null;
		window.scrollTo({ top: 0, behavior: 'smooth' });
		await goto(
			resolve(
				buildWorkspaceUrl('edit', request, {
					tool: 'pro-mode'
				}) as PathnameWithSearchOrHash,
				{}
			),
			{
				replaceState: true,
				keepFocus: true,
				noScroll: true
			}
		).catch((error: unknown) => logBoundaryError('proMode.clearJobNavigation', error));
	}
</script>

<section class="step-card">
	<aside class="alpha-notice" aria-label={t('proMode.alpha')}>
		<span class="alpha-badge">{t('proMode.alpha')}</span>
		<p>{t('proMode.alphaNotice')}</p>
	</aside>

	<div class="field">
		<span>{t('proMode.referenceImage')}</span>
		<ImageUpload target="proModeReference" disabled={formLocked} compact />
		<p class="field-hint">{t('proMode.referenceHint')}</p>
	</div>

	<label class="field">
		<span>
			{t('proMode.promptLabel')}
			<span class="required-badge">{t('proMode.required')}</span>
		</span>
		<textarea
			value={request.proModePrompt}
			maxlength="500"
			rows="3"
			required
			disabled={formLocked}
			placeholder={t('proMode.promptPlaceholder')}
			oninput={(event) => request.setProModePrompt(promptValue(event))}></textarea>
		<p class="field-hint">{t('proMode.promptHint')}</p>
	</label>

	<label class="strength-label">
		<span class="strength-top">
			<span>{t('proMode.speedVsQuality')}</span>
			<span class="strength-value">{speedVsQualityPercent}%</span>
		</span>
		<input
			type="range"
			min="0"
			max="1"
			step="0.05"
			value={request.proModeSpeedVsQuality}
			disabled={formLocked}
			aria-valuetext={`${speedVsQualityPercent}%`}
			oninput={(event) => request.setProModeSpeedVsQuality(speedVsQualityValue(event))}
		/>
		<span class="strength-scale" aria-hidden="true">
			<span>{t('proMode.speedVsQualityFast')}</span>
			<span>{t('proMode.speedVsQualityBest')}</span>
		</span>
	</label>

	{#if !isAuthenticated}
		<p class="auth-hint">{t('proMode.signInToApply')}</p>
	{:else if validationKey && jobId === null}
		<p class="validation-hint">{t(validationKey)}</p>
	{/if}

	<button type="button" class="generate-btn" disabled={!canSubmit} onclick={() => void submit()}>
		{#if submitting}
			<span class="spinner" aria-hidden="true"></span>
			{t('proMode.submitting')}
		{:else if isPolling}
			{t('proMode.processing')}
		{:else if terminalJob?.id === jobId}
			{t('proMode.completed')}
		{:else}
			{t('proMode.apply')}
		{/if}
	</button>

	<div class="job-live" role="status" aria-live="polite" aria-atomic="true">
		{#if isPolling}
			<p class="job-status">
				<span class="spinner" aria-hidden="true"></span>
				{t('proMode.processing')}
			</p>
		{:else if terminalJob?.id === jobId}
			<p class="job-success">{t('proMode.completed')}</p>
		{/if}
	</div>

	{#if terminalJob?.id === jobId}
		<button type="button" class="secondary-btn" onclick={() => void clearJob()}>
			{t('proMode.newEdit')}
		</button>
	{:else if terminalError?.jobId === jobId || (terminalError?.jobId === '' && jobId === null)}
		<p class="submit-error" role="alert">{t(terminalError.key)}</p>
		{#if jobId !== null}
			<button type="button" class="secondary-btn" onclick={() => void clearJob()}>
				{t('proMode.tryAgain')}
			</button>
		{/if}
	{:else if pollFailure?.jobId === jobId}
		<p class="submit-error" role="alert">{t(pollFailure.key)}</p>
		<button type="button" class="secondary-btn" onclick={retryPolling}>
			{t('proMode.retryStatus')}
		</button>
	{/if}
</section>

<style>
	/* Stacked (badge above text) rather than side-by-side: this panel lives in
	   a fixed-width floating tools panel, next to EditPanel's vertical tool
	   rail — there isn't enough width left for a badge-beside-paragraph row
	   without squeezing the text down to single-word-per-line wrapping. */
	.alpha-notice {
		width: 100%;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		box-sizing: border-box;
		padding: 0.875rem 1rem;
		border: 1px solid color-mix(in srgb, var(--color-accent) 35%, var(--color-border));
		border-radius: var(--radius);
		background: color-mix(in srgb, var(--color-accent) 7%, var(--color-surface));
	}

	.alpha-notice p,
	.job-status,
	.job-success,
	.validation-hint,
	.field-hint {
		margin: 0;
	}

	.alpha-notice p {
		font-size: 0.875rem;
		line-height: 1.5;
		color: var(--color-text);
	}

	.alpha-badge {
		align-self: flex-start;
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

	.field {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		font-size: 0.875rem;
		color: var(--color-muted-strong);
	}

	.field-hint {
		font-size: 0.8125rem;
		color: var(--color-muted-strong);
	}

	.required-badge {
		display: inline-block;
		margin-left: 0.375rem;
		padding: 0.15rem 0.5rem;
		border: 1px solid var(--color-border);
		border-radius: 100px;
		color: var(--color-muted-strong);
		font-size: 0.6875rem;
		font-weight: 600;
	}

	.field textarea {
		width: 100%;
		box-sizing: border-box;
		padding: 0.75rem 1rem;
		border: 1.5px solid var(--color-muted-strong);
		border-radius: var(--radius);
		background: var(--color-surface);
		color: var(--color-text);
		font: inherit;
		resize: vertical;
	}

	.field textarea:focus {
		border-color: var(--color-border-focus);
	}

	.field textarea:disabled {
		opacity: 0.75;
		cursor: not-allowed;
	}

	.strength-label {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		font-size: 0.875rem;
	}

	.strength-top,
	.strength-scale {
		display: flex;
		align-items: center;
		gap: 0.625rem;
		justify-content: space-between;
	}

	.strength-top {
		color: var(--color-muted-strong);
	}

	.strength-value {
		color: var(--color-text);
		font-weight: 600;
	}

	.strength-scale {
		font-size: 0.75rem;
		color: var(--color-muted-strong);
	}

	input[type='range'] {
		width: 100%;
		accent-color: var(--color-accent);
	}

	input[type='range']:disabled {
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
</style>
