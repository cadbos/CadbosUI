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
	import type { LightSettingsCompletedResponse, LightSettingsJobResponse } from '$lib/api/contract';
	import { t, type TranslationKey } from '$lib/i18n/index.svelte';
	import { LIGHT_SETTINGS_FIXTURES, lightSettingsPresetsFor } from '$lib/light-settings-presets';
	import { auth } from '$lib/state/auth.svelte';
	import { generatedImages } from '$lib/state/generated-images.svelte';
	import { generationOverlay } from '$lib/state/generation-overlay.svelte';
	import { extractApiErrorCode, request, RequestImageUploadError } from '$lib/state/request.svelte';
	import { buildWorkspaceUrl, isEditToolRoute } from '$lib/state/url-state';
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

	const moodPresets = lightSettingsPresetsFor('mood');

	function fixtureState(onId: string, offId: string): 'on' | 'off' | null {
		if (request.lightSettingsPresetIds.includes(onId)) return 'on';
		if (request.lightSettingsPresetIds.includes(offId)) return 'off';
		return null;
	}

	let submitting = $state(false);
	let terminalJob = $state<LightSettingsCompletedResponse | null>(null);
	let terminalError = $state<PollFailure | null>(null);
	let pollFailure = $state<PollFailure | null>(null);
	let navigatedAwayWhileSubmitting = false;
	let pollRun = 0;
	const isAuthenticated = $derived(auth.status === 'authenticated');
	const jobId = $derived(request.activeLightSettingsJobId ?? null);
	const validation = $derived(request.validateLightSettings());
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
		if (field === 'image') return 'lightSettings.validationImage';
		if (field === 'instruction') return 'lightSettings.validationInstruction';
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
			'generationOverlay.lightSettings',
			'generationOverlay.lightSettingsDetail'
		);
		return () => generationOverlay.stop(overlayId);
	});

	beforeNavigate(({ to }) => {
		if (
			submitting &&
			(to === null || !isEditToolRoute(to.route.id, to.url.searchParams, 'light-settings'))
		) {
			navigatedAwayWhileSubmitting = true;
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
		if (code === 'unauthorized') return 'lightSettings.signInToApply';
		if (code === 'insufficient_credit') return 'lightSettings.insufficientCredit';
		if (code === 'generation_restricted') return 'lightSettings.generationRestricted';
		if (code === 'rate_limited') return 'lightSettings.rateLimited';
		if (code === 'light_settings_not_found') return 'lightSettings.notFound';
		if (code === 'light_settings_timeout') return 'lightSettings.timedOut';
		return 'lightSettings.failed';
	}

	function applyCompletedJob(result: LightSettingsCompletedResponse): void {
		if (request.currentRender?.id === result.id) {
			void auth.refreshCredit();
			if (auth.canLoadGeneratedImages) void generatedImages.load();
			return;
		}
		const context = request.activeLightSettingsJob;
		if (context?.id === result.id && context.sourceRender) {
			request.applyEditResult(
				{
					id: result.id,
					outputUrls: [result.outputUrl],
					cost: result.cost,
					balance: result.balance,
					parentId: context.sourceRender.id,
					editOp: {
						type: 'light-settings',
						instruction: context.instruction
					},
					ts: Date.now()
				},
				context.sourceRender
			);
		} else {
			request.applyEditResult({
				id: result.id,
				outputUrls: [result.outputUrl],
				cost: result.cost,
				balance: result.balance,
				editOp: { type: 'light-settings', instruction: context?.instruction ?? '' },
				ts: Date.now()
			});
		}
		void auth.refreshCredit();
		if (auth.canLoadGeneratedImages) void generatedImages.load();
	}

	async function parseJobResponse(
		response: Response,
		expectedId?: string
	): Promise<LightSettingsJobResponse> {
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
				response = await fetch(`/api/light-settings/${encodeURIComponent(id)}`, {
					signal: requestSignal
				});
			} catch (error) {
				if (signal.aborted || run !== pollRun) return;
				failures += 1;
				if (failures > MAX_TRANSIENT_FAILURES) {
					pollFailure = { jobId: id, key: 'lightSettings.pollFailed' };
					return;
				}
				if (!(error instanceof Error)) {
					logBoundaryError('lightSettings.poll', error);
				}
				await waitFor(transientDelay(failures), signal);
				continue;
			}
			if (signal.aborted || run !== pollRun) return;

			if (!response.ok) {
				const code = await extractApiErrorCode(response, 'light_settings_poll_failed');
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
			let result: LightSettingsJobResponse;
			try {
				result = await parseJobResponse(response, id);
			} catch {
				if (signal.aborted || run !== pollRun) return;
				if (requestSignal.aborted) {
					failures += 1;
					if (failures > MAX_TRANSIENT_FAILURES) {
						pollFailure = { jobId: id, key: 'lightSettings.pollFailed' };
						return;
					}
					await waitFor(transientDelay(failures), signal);
					continue;
				}
				pollFailure = { jobId: id, key: 'lightSettings.pollFailed' };
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
			const sourceRender = request.currentRender;
			const body = await request.toLightSettingsRequest();
			if (!body) return;
			const instruction = body.instruction;
			const response = await fetch('/api/light-settings', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body)
			});
			if (!response.ok) {
				const code = await extractApiErrorCode(response, 'light_settings_failed');
				terminalError = { jobId: '', key: errorKey(code) };
				return;
			}
			const result = await parseJobResponse(response);
			if (result.status !== 'processing') throw new Error('invalid_response');
			request.setActiveLightSettingsJob(result.id, sourceRender, instruction);
			if (
				navigatedAwayWhileSubmitting ||
				!isEditToolRoute(page.route.id, page.url.searchParams, 'light-settings')
			) {
				return;
			}
			try {
				await goto(buildWorkspaceUrl('edit', request, { tool: 'light-settings' }), {
					replaceState: true,
					keepFocus: true,
					noScroll: true
				});
			} catch (error) {
				logBoundaryError('lightSettings.jobNavigation', error);
			}
		} catch (error) {
			terminalError = {
				jobId: '',
				key:
					error instanceof RequestImageUploadError ? 'upload.errorUpload' : 'lightSettings.failed'
			};
		} finally {
			submitting = false;
		}
	}

	function retryPolling(): void {
		pollFailure = null;
	}

	async function clearJob(): Promise<void> {
		request.setActiveLightSettingsJobId(undefined);
		request.setLightSettingsPresetIds([]);
		request.setLightSettingsInstruction('');
		terminalJob = null;
		terminalError = null;
		pollFailure = null;
		await goto(buildWorkspaceUrl('edit', request, { tool: 'light-settings' }), {
			replaceState: true,
			keepFocus: true,
			noScroll: true
		}).catch((error: unknown) => logBoundaryError('lightSettings.clearJobNavigation', error));
	}
</script>

<section class="tool">
	<div class="preset-section">
		<p class="section-label">{t('lightSettings.moodSectionLabel')}</p>
		<div class="mood-grid">
			{#each moodPresets as preset (preset.id)}
				{@const Icon = preset.Icon}
				{@const selected = request.lightSettingsPresetIds.includes(preset.id)}
				<button
					type="button"
					class="preset-card"
					class:selected
					aria-pressed={selected}
					disabled={formLocked}
					onclick={() => request.toggleLightSettingsPreset(preset.id)}
				>
					<Icon size={20} strokeWidth={1.6} aria-hidden="true" />
					<span>{t(preset.label)}</span>
				</button>
			{/each}
		</div>
	</div>

	<div class="preset-section">
		<p class="section-label">{t('lightSettings.fixtureSectionLabel')}</p>
		<div class="fixture-list">
			{#each LIGHT_SETTINGS_FIXTURES as fixture (fixture.id)}
				{@const Icon = fixture.Icon}
				{@const state = fixtureState(fixture.onId, fixture.offId)}
				<div class="fixture-row">
					<Icon size={18} strokeWidth={1.6} aria-hidden="true" class="fixture-icon" />
					<span class="fixture-name">{t(fixture.name)}</span>
					<div class="segmented" role="group" aria-label={t(fixture.name)}>
						<button
							type="button"
							class="segment"
							class:active={state === 'off'}
							aria-pressed={state === 'off'}
							disabled={formLocked}
							onclick={() =>
								request.setLightSettingsFixtureState(fixture.id, state === 'off' ? null : 'off')}
						>
							{t('lightSettings.fixtureOff')}
						</button>
						<button
							type="button"
							class="segment"
							class:active={state === 'on'}
							aria-pressed={state === 'on'}
							disabled={formLocked}
							onclick={() =>
								request.setLightSettingsFixtureState(fixture.id, state === 'on' ? null : 'on')}
						>
							{t('lightSettings.fixtureOn')}
						</button>
					</div>
				</div>
			{/each}
		</div>
	</div>

	<label class="field">
		<span class="field-label">{t('lightSettings.customLabel')}</span>
		<textarea
			value={request.lightSettingsInstruction}
			oninput={(event) => request.setLightSettingsInstruction(textareaValue(event))}
			rows="2"
			maxlength="500"
			disabled={formLocked}
			placeholder={t('lightSettings.customPlaceholder')}></textarea>
	</label>

	{#if request.lightSettingsPrompt.trim() !== ''}
		<p class="preview">
			<span class="preview-label">{t('lightSettings.previewLabel')}</span>
			{request.lightSettingsPrompt}
		</p>
	{/if}

	{#if !isAuthenticated}
		<p class="auth-hint">{t('lightSettings.signInToApply')}</p>
	{:else if validationKey && jobId === null}
		<p class="validation-hint">{t(validationKey)}</p>
	{/if}

	<button type="button" class="btn-apply" disabled={!canSubmit} onclick={() => void submit()}>
		{#if submitting}
			<span class="spinner" aria-hidden="true"></span>
			{t('lightSettings.submitting')}
		{:else if isPolling}
			{t('lightSettings.processing')}
		{:else if terminalJob?.id === jobId}
			{t('lightSettings.completed')}
		{:else}
			{t('lightSettings.apply')}
		{/if}
	</button>

	<div class="job-live" role="status" aria-live="polite" aria-atomic="true">
		{#if isPolling}
			<p class="job-status">
				<span class="spinner" aria-hidden="true"></span>
				{t('lightSettings.processing')}
			</p>
		{:else if terminalJob?.id === jobId}
			<p class="job-success">{t('lightSettings.completed')}</p>
		{/if}
	</div>

	{#if terminalJob?.id === jobId}
		<button type="button" class="secondary-btn" onclick={() => void clearJob()}>
			{t('lightSettings.newRequest')}
		</button>
	{:else if terminalError?.jobId === jobId || (terminalError?.jobId === '' && jobId === null)}
		<p class="submit-error" role="alert">{t(terminalError.key)}</p>
		{#if jobId !== null}
			<button type="button" class="secondary-btn" onclick={() => void clearJob()}>
				{t('lightSettings.tryAgain')}
			</button>
		{/if}
	{:else if pollFailure?.jobId === jobId}
		<p class="submit-error" role="alert">{t(pollFailure.key)}</p>
		<button type="button" class="secondary-btn" onclick={retryPolling}>
			{t('lightSettings.retryStatus')}
		</button>
	{/if}
</section>

<style>
	.tool {
		display: flex;
		flex-direction: column;
		gap: 0.875rem;
	}

	.preset-section {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.section-label {
		margin: 0;
		font-size: 0.8125rem;
		font-weight: 600;
		color: var(--color-muted);
	}

	.mood-grid {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 0.625rem;
	}

	.preset-card {
		display: flex;
		flex-direction: column;
		align-items: center;
		min-width: 0;
		gap: 0.375rem;
		padding: 0.75rem 0.5rem;
		font: inherit;
		font-size: 0.75rem;
		font-weight: 500;
		text-align: center;
		color: var(--color-text);
		background: var(--color-background);
		border: 1.5px solid var(--color-border);
		border-radius: 12px;
		cursor: pointer;
		transition:
			border-color 0.15s,
			background 0.15s,
			color 0.15s;
	}

	.preset-card span {
		width: 100%;
		overflow-wrap: break-word;
	}

	.preset-card:hover:not(:disabled) {
		border-color: var(--color-accent);
	}

	.preset-card.selected {
		color: var(--color-accent-text);
		background: color-mix(in srgb, var(--color-accent) 8%, var(--color-surface));
		border-color: var(--color-accent);
	}

	.preset-card:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.fixture-list {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}

	.fixture-row {
		display: flex;
		align-items: center;
		gap: 0.625rem;
		padding: 0.5rem 0.625rem;
		background: var(--color-background);
		border: 1.5px solid var(--color-border);
		border-radius: 10px;
	}

	.fixture-row :global(.fixture-icon) {
		flex: 0 0 auto;
		color: var(--color-muted);
	}

	.fixture-name {
		flex: 1;
		min-width: 0;
		font-size: 0.875rem;
		line-height: 1.25;
		color: var(--color-text);
		overflow-wrap: break-word;
	}

	.segmented {
		display: flex;
		flex: 0 0 auto;
		padding: 0.125rem;
		background: var(--color-surface);
		border-radius: 8px;
	}

	.segment {
		padding: 0.3rem 0.75rem;
		font: inherit;
		font-size: 0.8125rem;
		font-weight: 500;
		color: var(--color-muted);
		background: transparent;
		border: none;
		border-radius: 6px;
		cursor: pointer;
		transition:
			background 0.15s,
			color 0.15s;
	}

	.segment:hover:not(:disabled, .active) {
		color: var(--color-text);
	}

	.segment.active {
		color: var(--color-accent-text);
		background: color-mix(in srgb, var(--color-accent) 12%, var(--color-surface));
	}

	.segment:disabled {
		opacity: 0.5;
		cursor: not-allowed;
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

	.preview {
		margin: 0;
		padding: 0.625rem 0.875rem;
		font-size: 0.8125rem;
		line-height: 1.5;
		color: var(--color-muted-strong);
		background: var(--color-background);
		border: 1px solid var(--color-border);
		border-radius: 10px;
	}

	.preview-label {
		display: block;
		margin-bottom: 0.25rem;
		font-weight: 600;
		color: var(--color-muted);
	}

	.auth-hint,
	.validation-hint {
		margin: 0;
		font-size: 0.875rem;
		color: var(--color-muted);
	}

	.btn-apply {
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

	.btn-apply:hover:not(:disabled) {
		background: var(--color-accent-hover);
	}

	.btn-apply:disabled {
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

	@media (max-width: 480px) {
		.mood-grid {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}
</style>
