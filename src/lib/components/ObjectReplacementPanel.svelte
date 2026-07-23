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
		ObjectReplacementCompletedResponse,
		ObjectReplacementJobResponse
	} from '$lib/api/contract';
	import ImageUpload from '$lib/components/ImageUpload.svelte';
	import { t, type TranslationKey } from '$lib/i18n/index.svelte';
	import { auth } from '$lib/state/auth.svelte';
	import { generatedImages } from '$lib/state/generated-images.svelte';
	import { generationOverlay } from '$lib/state/generation-overlay.svelte';
	import { extractApiErrorCode, request, type ImageSourceMode } from '$lib/state/request.svelte';
	import { buildShareUrl } from '$lib/state/url-state';
	import { logBoundaryError } from '$lib/utils';

	const MAX_TRANSIENT_FAILURES = 5;
	const DEFAULT_POLL_DELAY_MS = 2_000;
	const MAX_POLL_DELAY_MS = 30_000;

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
	let terminalJob = $state<ObjectReplacementCompletedResponse | null>(null);
	let terminalError = $state<PollFailure | null>(null);
	let pollFailure = $state<PollFailure | null>(null);
	let navigatedAwayWhileSubmitting = false;
	let pollRun = 0;
	const isAuthenticated = $derived(auth.status === 'authenticated');
	const currentResultUrl = $derived(request.currentRender?.outputUrls[0]);
	const usesCurrentResult = $derived(
		request.objectReplacementSourceMode === 'current-result' && currentResultUrl !== undefined
	);
	const jobId = $derived(request.activeObjectReplacementJobId ?? null);
	const validation = $derived(request.validateObjectReplacement());
	const isPolling = $derived(
		jobId !== null &&
			terminalJob?.id !== jobId &&
			terminalError?.jobId !== jobId &&
			pollFailure?.jobId !== jobId
	);
	const formLocked = $derived(submitting || jobId !== null);
	const canSubmit = $derived(validation.valid && !formLocked && isAuthenticated);
	const sourcePhotoLabel = $derived(
		request.sceneType === 'exterior' ? t('upload.labelExterior') : t('upload.label')
	);
	const validationKey = $derived.by((): TranslationKey | null => {
		const field = validation.missing[0];
		if (field === 'image') return 'objectReplacement.validationSource';
		if (field === 'referenceImage') return 'objectReplacement.validationReference';
		if (field === 'replacementObject') return 'objectReplacement.validationObject';
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
		generationOverlay.start(
			'generationOverlay.objectReplacement',
			'generationOverlay.objectReplacementDetail'
		);
		return () => generationOverlay.stop();
	});

	beforeNavigate(({ to }) => {
		if (submitting && !to?.route.id?.startsWith('/object-replacement')) {
			navigatedAwayWhileSubmitting = true;
		}
	});

	function setSourceMode(mode: ImageSourceMode): void {
		request.setObjectReplacementSourceMode(mode);
	}

	function objectValue(event: Event): string {
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
		if (code === 'unauthorized') return 'objectReplacement.signInToApply';
		if (code === 'insufficient_credit') return 'objectReplacement.insufficientCredit';
		if (code === 'generation_restricted') return 'objectReplacement.generationRestricted';
		if (code === 'rate_limited') return 'objectReplacement.rateLimited';
		if (code === 'object_replacement_not_found') return 'objectReplacement.notFound';
		if (code === 'object_replacement_timeout') return 'objectReplacement.timedOut';
		return 'objectReplacement.failed';
	}

	function applyCompletedJob(result: ObjectReplacementCompletedResponse): void {
		if (request.currentRender?.id === result.id) {
			void auth.refreshCredit();
			if (auth.canLoadGeneratedImages) void generatedImages.load();
			return;
		}
		const context = request.activeObjectReplacementJob;
		if (context?.id === result.id && context.sourceRender) {
			request.applyEditResult(
				{
					id: result.id,
					outputUrls: [result.outputUrl],
					cost: result.cost,
					balance: result.balance,
					parentId: context.sourceRender.id,
					editOp: {
						type: 'replace-object',
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
	): Promise<ObjectReplacementJobResponse> {
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
			try {
				response = await fetch(`/api/object-replacement/${encodeURIComponent(id)}`, { signal });
			} catch (error) {
				if (signal.aborted || run !== pollRun) return;
				failures += 1;
				if (failures > MAX_TRANSIENT_FAILURES) {
					pollFailure = { jobId: id, key: 'objectReplacement.pollFailed' };
					return;
				}
				if (!(error instanceof Error)) {
					logBoundaryError('objectReplacement.poll', error);
				}
				await waitFor(transientDelay(failures), signal);
				continue;
			}
			if (signal.aborted || run !== pollRun) return;

			if (!response.ok) {
				const code = await extractApiErrorCode(response, 'object_replacement_poll_failed');
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
			let result: ObjectReplacementJobResponse;
			try {
				result = await parseJobResponse(response, id);
			} catch {
				if (signal.aborted || run !== pollRun) return;
				pollFailure = { jobId: id, key: 'objectReplacement.pollFailed' };
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
		const body = request.toObjectReplacementRequest();
		if (!body) return;
		const sourceRender =
			request.objectReplacementSourceMode === 'current-result' ? request.currentRender : undefined;
		const instruction = body.replacementObject;
		navigatedAwayWhileSubmitting = false;
		submitting = true;
		terminalJob = null;
		terminalError = null;
		pollFailure = null;
		try {
			const response = await fetch('/api/object-replacement', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body)
			});
			if (!response.ok) {
				const code = await extractApiErrorCode(response, 'object_replacement_failed');
				terminalError = { jobId: '', key: errorKey(code) };
				return;
			}
			const result = await parseJobResponse(response);
			if (result.status !== 'processing') throw new Error('invalid_response');
			request.setActiveObjectReplacementJob(result.id, sourceRender, instruction);
			if (navigatedAwayWhileSubmitting || !page.route.id?.startsWith('/object-replacement')) {
				return;
			}
			try {
				await goto(buildShareUrl('objectReplacement', request), {
					replaceState: true,
					keepFocus: true,
					noScroll: true
				});
			} catch (error) {
				logBoundaryError('objectReplacement.jobNavigation', error);
			}
		} catch {
			terminalError = { jobId: '', key: 'objectReplacement.failed' };
		} finally {
			submitting = false;
		}
	}

	function retryPolling(): void {
		pollFailure = null;
	}

	async function clearJob(): Promise<void> {
		request.setActiveObjectReplacementJobId(undefined);
		request.setObjectReferenceImage(undefined);
		request.setObjectReplacementObject('');
		request.setObjectReplacementSourceMode('current-result');
		request.setImage(undefined);
		request.setCurrentRender(undefined);
		terminalJob = null;
		terminalError = null;
		pollFailure = null;
		window.scrollTo({ top: 0, behavior: 'smooth' });
		await goto(buildShareUrl('objectReplacement', request), {
			replaceState: true,
			keepFocus: true,
			noScroll: true
		}).catch((error: unknown) => logBoundaryError('objectReplacement.clearJobNavigation', error));
	}
</script>

<aside class="alpha-notice" aria-label={t('objectReplacement.alpha')}>
	<span class="alpha-badge">{t('objectReplacement.alpha')}</span>
	<p>{t('objectReplacement.alphaNotice')}</p>
</aside>

<section class="step-card">
	<div class="step-header">
		<span class="step-num" aria-hidden="true">①</span>
		<h2>{t('objectReplacement.images')}</h2>
	</div>

	<div class="image-grid">
		<div class="image-column">
			<div class="column-header">
				<h3>{t('objectReplacement.sourceImage')}</h3>
				<span class="required-badge">{t('objectReplacement.required')}</span>
				{#if currentResultUrl}
					<div class="source-tabs" role="group" aria-label={t('objectReplacement.sourceImage')}>
						<button
							type="button"
							class:active={request.objectReplacementSourceMode === 'room-photo'}
							aria-pressed={request.objectReplacementSourceMode === 'room-photo'}
							disabled={formLocked}
							onclick={() => setSourceMode('room-photo')}
						>
							{sourcePhotoLabel}
						</button>
						<button
							type="button"
							class:active={request.objectReplacementSourceMode === 'current-result'}
							aria-pressed={request.objectReplacementSourceMode === 'current-result'}
							disabled={formLocked}
							onclick={() => setSourceMode('current-result')}
						>
							{t('objectReplacement.sourceCurrentResult')}
						</button>
					</div>
				{/if}
			</div>

			{#if usesCurrentResult}
				<div class="source-preview">
					<img src={currentResultUrl} alt={t('objectReplacement.sourceCurrentResult')} />
				</div>
			{:else}
				<ImageUpload
					label="objectReplacement.sourceImage"
					requiredLabel="objectReplacement.required"
					disabled={formLocked}
				/>
			{/if}
		</div>

		<div class="image-column">
			<div class="column-header">
				<h3>{t('objectReplacement.referenceImage')}</h3>
				<span class="required-badge">{t('objectReplacement.required')}</span>
			</div>
			<ImageUpload
				target="objectReference"
				requiredLabel="objectReplacement.required"
				disabled={formLocked}
			/>
		</div>
	</div>
</section>

<section class="step-card">
	<div class="step-header">
		<span class="step-num" aria-hidden="true">②</span>
		<h2>{t('objectReplacement.objectLabel')}</h2>
		<span class="required-badge">{t('objectReplacement.required')}</span>
	</div>
	<label class="object-field">
		<span>{t('objectReplacement.objectHint')}</span>
		<input
			type="text"
			value={request.objectReplacementObject}
			maxlength="200"
			required
			disabled={formLocked}
			placeholder={t('objectReplacement.objectPlaceholder')}
			oninput={(event) => request.setObjectReplacementObject(objectValue(event))}
		/>
	</label>
</section>

<section class="step-card generate-section">
	<div class="step-header">
		<span class="step-num" aria-hidden="true">③</span>
		<h2>{t('objectReplacement.controls')}</h2>
	</div>

	{#if !isAuthenticated}
		<p class="auth-hint">{t('objectReplacement.signInToApply')}</p>
	{:else if validationKey && jobId === null}
		<p class="validation-hint">{t(validationKey)}</p>
	{/if}

	<button type="button" class="generate-btn" disabled={!canSubmit} onclick={() => void submit()}>
		{#if submitting}
			<span class="spinner" aria-hidden="true"></span>
			{t('objectReplacement.submitting')}
		{:else if isPolling}
			{t('objectReplacement.processing')}
		{:else if terminalJob?.id === jobId}
			{t('objectReplacement.completed')}
		{:else}
			{t('objectReplacement.apply')}
		{/if}
	</button>

	<div class="job-live" role="status" aria-live="polite" aria-atomic="true">
		{#if isPolling}
			<p class="job-status">
				<span class="spinner" aria-hidden="true"></span>
				{t('objectReplacement.processing')}
			</p>
		{:else if terminalJob?.id === jobId}
			<p class="job-success">{t('objectReplacement.completed')}</p>
		{/if}
	</div>

	{#if terminalJob?.id === jobId}
		<button type="button" class="secondary-btn" onclick={() => void clearJob()}>
			{t('objectReplacement.newReplacement')}
		</button>
	{:else if terminalError?.jobId === jobId || (terminalError?.jobId === '' && jobId === null)}
		<p class="submit-error" role="alert">{t(terminalError.key)}</p>
		{#if jobId !== null}
			<button type="button" class="secondary-btn" onclick={() => void clearJob()}>
				{t('objectReplacement.tryAgain')}
			</button>
		{/if}
	{:else if pollFailure?.jobId === jobId}
		<p class="submit-error" role="alert">{t(pollFailure.key)}</p>
		<button type="button" class="secondary-btn" onclick={retryPolling}>
			{t('objectReplacement.retryStatus')}
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
	.column-header h3,
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

	.image-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 1rem;
	}

	.image-column {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		min-width: 0;
	}

	.column-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
	}

	.column-header h3 {
		font-size: 0.875rem;
		font-weight: 600;
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

	.source-tabs {
		display: inline-flex;
		gap: 0.25rem;
		padding: 0.25rem;
		background: var(--color-background);
		border-radius: 10px;
	}

	.source-tabs button {
		padding: 0.375rem 0.625rem;
		font: inherit;
		font-size: 0.75rem;
		font-weight: 500;
		color: var(--color-muted-strong);
		background: transparent;
		border: 1px solid transparent;
		border-radius: 8px;
		cursor: pointer;
	}

	.source-tabs button.active {
		color: var(--color-text);
		background: var(--color-surface);
		border-color: var(--color-accent);
		box-shadow: var(--shadow-sm);
	}

	.source-tabs button:disabled {
		opacity: 0.65;
		cursor: not-allowed;
	}

	.source-preview {
		border: 1.5px solid var(--color-muted-strong);
		border-radius: var(--radius-lg);
		overflow: hidden;
		background: var(--color-background);
	}

	.source-preview img {
		width: 100%;
		max-height: 280px;
		object-fit: cover;
		display: block;
	}

	.object-field {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		font-size: 0.875rem;
		color: var(--color-muted-strong);
	}

	.object-field input {
		width: 100%;
		box-sizing: border-box;
		padding: 0.75rem 1rem;
		border: 1.5px solid var(--color-muted-strong);
		border-radius: var(--radius);
		background: var(--color-surface);
		color: var(--color-text);
		font: inherit;
	}

	.object-field input:focus {
		border-color: var(--color-border-focus);
	}

	.object-field input:disabled {
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

	@media (max-width: 760px) {
		.image-grid {
			grid-template-columns: 1fr;
		}

		.column-header {
			align-items: stretch;
			flex-direction: column;
		}

		.source-tabs {
			width: 100%;
		}

		.source-tabs button {
			flex: 1;
		}
	}
</style>
