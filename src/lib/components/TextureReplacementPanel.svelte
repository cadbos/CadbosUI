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
	import { tick } from 'svelte';
	import { z } from 'zod';
	import type {
		TextureReplacementCompletedResponse,
		TextureReplacementJobResponse
	} from '$lib/api/contract';
	import ImageUpload from '$lib/components/ImageUpload.svelte';
	import { t, type TranslationKey } from '$lib/i18n/index.svelte';
	import { auth } from '$lib/state/auth.svelte';
	import { generatedImages } from '$lib/state/generated-images.svelte';
	import { generationOverlay } from '$lib/state/generation-overlay.svelte';
	import {
		extractApiErrorCode,
		request,
		RequestImageUploadError,
		type ActiveTextureReplacementJob
	} from '$lib/state/request.svelte';
	import { buildShareUrl, isEditToolRoute } from '$lib/state/url-state';
	import { logBoundaryError } from '$lib/utils';

	const MAX_TRANSIENT_FAILURES = 5;
	const DEFAULT_POLL_DELAY_MS = 2_000;
	const MAX_POLL_DELAY_MS = 30_000;
	// Generous enough to outlast the server's own ComfyUI wait (2min) plus
	// upload/finalize time, but finite so a stalled connection is retried
	// instead of leaving pollJob awaiting a response that never arrives.
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
	let terminalJob = $state<TextureReplacementCompletedResponse | null>(null);
	let terminalError = $state<PollFailure | null>(null);
	let pollFailure = $state<PollFailure | null>(null);
	let maskedToggle = $state<HTMLInputElement | null>(null);
	let navigatedAwayWhileSubmitting = false;
	let pollRun = 0;
	const isAuthenticated = $derived(auth.status === 'authenticated');
	const jobId = $derived(request.activeTextureReplacementJobId ?? null);
	const validation = $derived(request.validateTextureReplacement());
	const isPolling = $derived(
		jobId !== null &&
			terminalJob?.id !== jobId &&
			terminalError?.jobId !== jobId &&
			pollFailure?.jobId !== jobId
	);
	const completedJobMatches = $derived(
		terminalJob !== null &&
			(jobId === null ? request.currentRender?.id === terminalJob.id : terminalJob.id === jobId)
	);
	const formLocked = $derived(
		submitting || request.textureMaskUploading || jobId !== null || completedJobMatches
	);
	const canSubmit = $derived(validation.valid && !formLocked && isAuthenticated);
	const validationKey = $derived.by((): TranslationKey | null => {
		const field = validation.missing[0];
		if (field === 'image') return 'textureReplacement.validationSource';
		if (field === 'referenceImage') return 'textureReplacement.validationReference';
		if (field === 'replacementSurface') return 'textureReplacement.validationSurface';
		if (field === 'mask') return 'textureReplacement.validationMask';
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
		const overlayId = generationOverlay.start('generationOverlay.textureReplacement');
		return () => generationOverlay.stop(overlayId);
	}

	$effect(overlayEffect);

	beforeNavigate(({ to }) => {
		if (
			submitting &&
			(to === null || !isEditToolRoute(to.route.id, to.url.searchParams, 'texture-replacement'))
		) {
			navigatedAwayWhileSubmitting = true;
		}
	});

	function surfaceValue(event: Event): string {
		return event.currentTarget instanceof HTMLInputElement ? event.currentTarget.value : '';
	}

	function maskedValue(event: Event): boolean {
		return event.currentTarget instanceof HTMLInputElement && event.currentTarget.checked;
	}

	function attachMaskedToggle(node: HTMLInputElement): () => void {
		maskedToggle = node;
		return () => {
			maskedToggle = null;
		};
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
		if (code === 'unauthorized') return 'textureReplacement.signInToApply';
		if (code === 'insufficient_credit') return 'textureReplacement.insufficientCredit';
		if (code === 'generation_restricted') return 'textureReplacement.generationRestricted';
		if (code === 'rate_limited') return 'textureReplacement.rateLimited';
		if (code === 'texture_replacement_not_found') return 'textureReplacement.notFound';
		if (code === 'texture_replacement_timeout') return 'textureReplacement.timedOut';
		return 'textureReplacement.failed';
	}

	function applyCompletedJob(
		result: TextureReplacementCompletedResponse,
		submittedContext?: Omit<ActiveTextureReplacementJob, 'id'>
	): void {
		request.setTextureReplacementResultReady(true);
		if (request.currentRender?.id === result.id) {
			void auth.refreshCredit();
			if (auth.canLoadGeneratedImages) void generatedImages.load();
			return;
		}
		const activeContext = request.activeTextureReplacementJob;
		const context =
			submittedContext ?? (activeContext?.id === result.id ? activeContext : undefined);
		if (context?.sourceRender) {
			request.applyEditResult(
				{
					id: result.id,
					outputUrls: [result.outputUrl],
					cost: result.cost,
					balance: result.balance,
					parentId: context.sourceRender.id,
					editOp: {
						type: 'change-surface-color',
						instruction: context.instruction
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
	): Promise<TextureReplacementJobResponse> {
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
				response = await fetch(`/api/texture-replacement/${encodeURIComponent(id)}`, {
					signal: requestSignal
				});
			} catch (error) {
				if (signal.aborted || run !== pollRun) return;
				failures += 1;
				if (failures > MAX_TRANSIENT_FAILURES) {
					pollFailure = { jobId: id, key: 'textureReplacement.pollFailed' };
					return;
				}
				if (!(error instanceof Error)) {
					logBoundaryError('textureReplacement.poll', error);
				}
				await waitFor(transientDelay(failures), signal);
				continue;
			}
			if (signal.aborted || run !== pollRun) return;

			if (!response.ok) {
				const code = await extractApiErrorCode(response, 'texture_replacement_poll_failed');
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
			let result: TextureReplacementJobResponse;
			try {
				result = await parseJobResponse(response, id);
			} catch {
				if (signal.aborted || run !== pollRun) return;
				if (requestSignal.aborted) {
					failures += 1;
					if (failures > MAX_TRANSIENT_FAILURES) {
						pollFailure = { jobId: id, key: 'textureReplacement.pollFailed' };
						return;
					}
					await waitFor(transientDelay(failures), signal);
					continue;
				}
				pollFailure = { jobId: id, key: 'textureReplacement.pollFailed' };
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
		request.setTextureReplacementResultReady(false);
		try {
			const body = await request.toTextureReplacementRequest();
			if (!body) return;
			const sourceRender =
				request.textureReplacementSourceMode === 'current-result'
					? request.currentRender
					: undefined;
			const instruction = 'replacementSurface' in body ? body.replacementSurface : '';
			const response = await fetch('/api/texture-replacement', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body)
			});
			if (!response.ok) {
				const code = await extractApiErrorCode(response, 'texture_replacement_failed');
				terminalError = { jobId: '', key: errorKey(code) };
				return;
			}
			const result = await parseJobResponse(response);
			if (result.status === 'failed') {
				terminalError = { jobId: '', key: errorKey(result.error.code) };
				return;
			}
			if (result.status === 'completed') {
				terminalJob = result;
				applyCompletedJob(result, { sourceRender, instruction });
			} else {
				request.setActiveTextureReplacementJob(result.id, sourceRender, instruction);
			}
			if (
				navigatedAwayWhileSubmitting ||
				!isEditToolRoute(page.route.id, page.url.searchParams, 'texture-replacement')
			) {
				return;
			}
			try {
				await goto(buildShareUrl('edit', request, { tool: 'texture-replacement' }), {
					replaceState: true,
					keepFocus: true,
					noScroll: true
				});
			} catch (error) {
				logBoundaryError('textureReplacement.jobNavigation', error);
			}
		} catch (error) {
			terminalError = {
				jobId: '',
				key:
					error instanceof RequestImageUploadError
						? 'upload.errorUpload'
						: 'textureReplacement.failed'
			};
		} finally {
			submitting = false;
		}
	}

	function retryPolling(): void {
		pollFailure = null;
	}

	async function clearJob(): Promise<void> {
		request.setActiveTextureReplacementJobId(undefined);
		request.setTextureReferenceImage(undefined);
		request.setTextureMaskImage(undefined);
		request.setTextureReplacementMasked(false);
		request.setTextureReplacementResultReady(false);
		request.setTextureReplacementSurface('');
		request.setTextureReplacementSourceMode('current-result');
		request.setImage(undefined);
		request.setCurrentRender(undefined);
		terminalJob = null;
		terminalError = null;
		pollFailure = null;
		const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		window.scrollTo({ top: 0, behavior: prefersReducedMotion ? 'auto' : 'smooth' });
		await goto(buildShareUrl('edit', request, { tool: 'texture-replacement' }), {
			replaceState: true,
			noScroll: true
		}).catch((error: unknown) => logBoundaryError('textureReplacement.clearJobNavigation', error));
		await tick();
		maskedToggle?.focus({ preventScroll: true });
	}
</script>

<section class="step-card">
	<aside class="alpha-notice" aria-label={t('textureReplacement.alpha')}>
		<span class="alpha-badge">{t('textureReplacement.alpha')}</span>
		<p>{t('textureReplacement.alphaNotice')}</p>
	</aside>

	<div class="field">
		<span>
			{t('textureReplacement.referenceImage')}
			<span class="required-badge">{t('textureReplacement.required')}</span>
		</span>
		<ImageUpload
			target="textureReference"
			requiredLabel="textureReplacement.required"
			disabled={formLocked}
			compact
		/>
	</div>

	<label class="masked-toggle">
		<input
			{@attach attachMaskedToggle}
			id="texture-replacement-masked-toggle"
			type="checkbox"
			checked={request.textureReplacementMasked}
			disabled={formLocked}
			onchange={(event) => request.setTextureReplacementMasked(maskedValue(event))}
		/>
		<span>{t('textureReplacement.maskedLabel')}</span>
	</label>

	{#if request.textureReplacementMasked}
		<p class="canvas-hint">{t('textureReplacement.maskEditor.canvasHint')}</p>
	{:else}
		<label class="field">
			<span>
				{t('textureReplacement.surfaceHint')}
				<span class="required-badge">{t('textureReplacement.required')}</span>
			</span>
			<input
				type="text"
				value={request.textureReplacementSurface}
				maxlength="200"
				required
				disabled={formLocked}
				placeholder={t('textureReplacement.surfacePlaceholder')}
				oninput={(event) => request.setTextureReplacementSurface(surfaceValue(event))}
			/>
		</label>
	{/if}

	{#if !isAuthenticated}
		<p class="auth-hint">{t('textureReplacement.signInToApply')}</p>
	{/if}
	<div class="validation-live" role="status" aria-live="polite" aria-atomic="true">
		{#if isAuthenticated && validationKey && jobId === null}
			<p class="validation-hint">{t(validationKey)}</p>
		{/if}
	</div>

	<button type="button" class="generate-btn" disabled={!canSubmit} onclick={() => void submit()}>
		{#if submitting}
			<span class="spinner" aria-hidden="true"></span>
			{t('textureReplacement.submitting')}
		{:else if isPolling}
			{t('textureReplacement.processing')}
		{:else if completedJobMatches}
			{t('textureReplacement.completed')}
		{:else}
			{t('textureReplacement.apply')}
		{/if}
	</button>

	<div class="job-live" role="status" aria-live="polite" aria-atomic="true">
		{#if isPolling}
			<p class="job-status">
				<span class="spinner" aria-hidden="true"></span>
				{t('textureReplacement.processing')}
			</p>
		{:else if completedJobMatches}
			<p class="job-success">{t('textureReplacement.completed')}</p>
		{/if}
	</div>

	{#if completedJobMatches}
		<button type="button" class="secondary-btn" onclick={() => void clearJob()}>
			{t('textureReplacement.newReplacement')}
		</button>
	{:else if terminalError?.jobId === jobId || (terminalError?.jobId === '' && jobId === null)}
		<p class="submit-error" role="alert">{t(terminalError.key)}</p>
		{#if jobId !== null}
			<button type="button" class="secondary-btn" onclick={() => void clearJob()}>
				{t('textureReplacement.tryAgain')}
			</button>
		{/if}
	{:else if pollFailure?.jobId === jobId}
		<p class="submit-error" role="alert">{t(pollFailure.key)}</p>
		<button type="button" class="secondary-btn" onclick={retryPolling}>
			{t('textureReplacement.retryStatus')}
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
	.validation-hint {
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

	.masked-toggle {
		display: flex;
		align-items: center;
		align-self: flex-start;
		gap: 0.625rem;
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--color-text);
		cursor: pointer;
	}

	.masked-toggle input {
		width: 1rem;
		height: 1rem;
		margin: 0;
		accent-color: var(--color-accent);
	}

	.masked-toggle:has(input:disabled) {
		opacity: 0.65;
		cursor: not-allowed;
	}

	.canvas-hint {
		margin: 0;
		font-size: 0.875rem;
		color: var(--color-muted-strong);
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		font-size: 0.875rem;
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

	.field input {
		width: 100%;
		box-sizing: border-box;
		padding: 0.75rem 1rem;
		border: 1.5px solid var(--color-muted-strong);
		border-radius: var(--radius);
		background: var(--color-surface);
		color: var(--color-text);
		font: inherit;
	}

	.field input:focus {
		border-color: var(--color-border-focus);
	}

	.field input:disabled {
		opacity: 0.75;
		cursor: not-allowed;
	}

	.validation-hint,
	.job-status {
		font-size: 0.875rem;
		color: var(--color-muted-strong);
	}

	.validation-live:empty,
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
