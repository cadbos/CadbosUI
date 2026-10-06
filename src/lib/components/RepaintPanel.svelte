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
	import { page } from '$app/state';
	import type { PathnameWithSearchOrHash } from '$app/types';
	import ColorPicker from 'svelte-awesome-color-picker';
	import { z } from 'zod';
	import {
		mediaAccessSchema,
		type RepaintCompletedResponse,
		type RepaintJobResponse
	} from '$lib/api/contract';
	import ModeHint from '$lib/components/ModeHint.svelte';
	import { t, type TranslationKey } from '$lib/i18n/index.svelte';
	import { REPAINT_COLOR_PATTERN, REPAINT_COLOR_PRESETS } from '$lib/repaint-colors';
	import { auth } from '$lib/state/auth.svelte';
	import { generatedImages } from '$lib/state/generated-images.svelte';
	import { generationOverlay } from '$lib/state/generation-overlay.svelte';
	import { mediaAccess } from '$lib/state/media-access.svelte';
	import { extractApiErrorCode, request, RequestImageUploadError } from '$lib/state/request.svelte';
	import { buildWorkspaceUrl, isEditToolRoute } from '$lib/state/url-state';
	import { logBoundaryError } from '$lib/utils';

	// Where a freshly selected area starts: centered, for the user to adjust.
	const INITIAL_REGION = { x: 0.3, y: 0.3, width: 0.4, height: 0.4 } as const;
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
				output: mediaAccessSchema,
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
	let terminalJob = $state<RepaintCompletedResponse | null>(null);
	let terminalError = $state<PollFailure | null>(null);
	let pollFailure = $state<PollFailure | null>(null);
	let navigatedAwayWhileSubmitting = false;
	let pollRun = 0;
	const isAuthenticated = $derived(auth.status === 'authenticated');
	const jobId = $derived(request.activeRepaintJobId ?? null);
	const validation = $derived(request.validateRepaint());
	const isPolling = $derived(
		jobId !== null &&
			terminalJob?.id !== jobId &&
			terminalError?.jobId !== jobId &&
			pollFailure?.jobId !== jobId
	);
	// A successfully completed job keeps the form editable for the next
	// request right away, same as LightSettingsPanel.svelte.
	const formLocked = $derived(submitting || (jobId !== null && terminalJob?.id !== jobId));
	const canSubmit = $derived(validation.valid && !formLocked && isAuthenticated);
	const validationKey = $derived.by((): TranslationKey | null => {
		const field = validation.missing[0];
		if (field === 'image') return 'repaint.validationImage';
		if (field === 'repaintTarget') return 'repaint.validationTarget';
		return null;
	});
	const selectedPreset = $derived(
		REPAINT_COLOR_PRESETS.find((preset) => preset.hex === request.repaintColor)
	);
	const pickerTexts = $derived({
		label: {
			h: t('repaint.picker.hue'),
			s: t('repaint.picker.saturation'),
			v: t('repaint.picker.brightness'),
			hex: t('repaint.picker.hex')
		}
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

	function overlayEffect(): void | (() => void) {
		if (!(submitting || isPolling)) return;
		const overlayId = generationOverlay.start(
			'generationOverlay.repaint',
			'generationOverlay.repaintDetail'
		);
		return () => generationOverlay.stop(overlayId);
	}

	$effect(overlayEffect);
	beforeNavigate(({ to }) => {
		if (
			submitting &&
			(to === null || !isEditToolRoute(to.route.id, to.url.searchParams, 'repaint'))
		) {
			navigatedAwayWhileSubmitting = true;
		}
	});

	// The picker reports whatever the user typed into its hex field as is
	// (case, missing `#`, an alpha pair); its parsed color is the reliable
	// source, normalized here to the one shape the store accepts.
	function pickColor(color: { alpha(value: number): { toHex(): string } } | null): void {
		if (formLocked || color === null) return;
		const hex = color.alpha(1).toHex();
		if (REPAINT_COLOR_PATTERN.test(hex) && hex !== request.repaintColor) {
			request.setRepaintColor(hex);
		}
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
		if (code === 'unauthorized') return 'repaint.signInToApply';
		if (code === 'insufficient_credit') return 'repaint.insufficientCredit';
		if (code === 'generation_restricted') return 'repaint.generationRestricted';
		if (code === 'rate_limited') return 'repaint.rateLimited';
		if (code === 'repaint_not_found') return 'repaint.notFound';
		if (code === 'repaint_timeout') return 'repaint.timedOut';
		if (code === 'repaint_target_not_found') return 'repaint.targetNotFound';
		return 'repaint.failed';
	}

	function applyCompletedJob(result: RepaintCompletedResponse): void {
		if (request.currentRender?.id === result.id) {
			void auth.refreshCredit();
			if (auth.canLoadGeneratedImages) void generatedImages.load();
			return;
		}
		const context = request.activeRepaintJob;
		if (context?.id === result.id && context.sourceRender) {
			request.applyEditResult(
				{
					id: result.id,
					recorded: true,
					outputKey: mediaAccess.normalize(result.output).key,
					cost: result.cost,
					balance: result.balance,
					parentId: context.sourceRender.id,
					editOp: { type: 'repaint', instruction: context.instruction },
					formSnapshot: context.formSnapshot,
					ts: Date.now()
				},
				context.sourceRender
			);
		} else {
			request.applyEditResult({
				id: result.id,
				recorded: true,
				outputKey: mediaAccess.normalize(result.output).key,
				cost: result.cost,
				balance: result.balance,
				editOp: { type: 'repaint', instruction: context?.instruction ?? '' },
				ts: Date.now()
			});
		}
		void auth.refreshCredit();
		if (auth.canLoadGeneratedImages) void generatedImages.load();
	}

	async function parseJobResponse(
		response: Response,
		expectedId?: string
	): Promise<RepaintJobResponse> {
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
				response = await fetch(`/api/repaint/${encodeURIComponent(id)}`, {
					signal: requestSignal
				});
			} catch (error) {
				if (signal.aborted || run !== pollRun) return;
				failures += 1;
				if (failures > MAX_TRANSIENT_FAILURES) {
					pollFailure = { jobId: id, key: 'repaint.pollFailed' };
					return;
				}
				if (!(error instanceof Error)) {
					logBoundaryError('repaint.poll', error);
				}
				await waitFor(transientDelay(failures), signal);
				continue;
			}
			if (signal.aborted || run !== pollRun) return;

			if (!response.ok) {
				const code = await extractApiErrorCode(response, 'repaint_poll_failed');
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
			let result: RepaintJobResponse;
			try {
				result = await parseJobResponse(response, id);
			} catch {
				if (signal.aborted || run !== pollRun) return;
				if (requestSignal.aborted) {
					failures += 1;
					if (failures > MAX_TRANSIENT_FAILURES) {
						pollFailure = { jobId: id, key: 'repaint.pollFailed' };
						return;
					}
					await waitFor(transientDelay(failures), signal);
					continue;
				}
				pollFailure = { jobId: id, key: 'repaint.pollFailed' };
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
			const body = await request.toRepaintRequest();
			if (!body) return;
			const response = await fetch('/api/repaint', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body)
			});
			if (!response.ok) {
				const code = await extractApiErrorCode(response, 'repaint_failed');
				terminalError = { jobId: '', key: errorKey(code) };
				return;
			}
			const result = await parseJobResponse(response);
			if (result.status !== 'processing') throw new Error('invalid_response');
			request.setActiveRepaintJob(result.id, sourceRender, body.target);
			if (
				navigatedAwayWhileSubmitting ||
				!isEditToolRoute(page.route.id, page.url.searchParams, 'repaint')
			) {
				return;
			}
			try {
				await goto(
					resolve(
						buildWorkspaceUrl('edit', request, { tool: 'repaint' }) as PathnameWithSearchOrHash,
						{}
					),
					{
						replaceState: true,
						keepFocus: true,
						noScroll: true
					}
				);
			} catch (error) {
				logBoundaryError('repaint.jobNavigation', error);
			}
		} catch (error) {
			terminalError = {
				jobId: '',
				key: error instanceof RequestImageUploadError ? 'upload.errorUpload' : 'repaint.failed'
			};
		} finally {
			submitting = false;
		}
	}

	function retryPolling(): void {
		pollFailure = null;
	}

	// Clears job tracking only — the target, the color and the current result
	// stay as they are, so the user can tweak and submit again.
	async function clearJob(): Promise<void> {
		request.setActiveRepaintJobId(undefined);
		terminalJob = null;
		terminalError = null;
		pollFailure = null;
		await goto(
			resolve(
				buildWorkspaceUrl('edit', request, { tool: 'repaint' }) as PathnameWithSearchOrHash,
				{}
			),
			{
				replaceState: true,
				keepFocus: true,
				noScroll: true
			}
		).catch((error: unknown) => logBoundaryError('repaint.clearJobNavigation', error));
	}
</script>

<section class="tool">
	<label class="field">
		<span class="field-label">{t('repaint.targetLabel')}</span>
		<input
			type="text"
			value={request.repaintTarget}
			oninput={(event) => request.setRepaintTarget(event.currentTarget.value)}
			maxlength="200"
			disabled={formLocked}
			placeholder={t('repaint.targetPlaceholder')}
		/>
	</label>

	<ModeHint field="repaint" text={request.repaintTarget} />

	<div class="region-section">
		<span class="section-label">{t('repaint.region.label')}</span>
		<p class="region-hint">{t('repaint.region.hint')}</p>
		{#if request.activeRepaintRegion()}
			<button
				type="button"
				class="secondary-btn"
				disabled={formLocked}
				onclick={() => request.setRepaintRegion(null)}
			>
				{t('repaint.region.clear')}
			</button>
		{:else}
			<button
				type="button"
				class="secondary-btn"
				disabled={formLocked || !request.hasWorkingImage()}
				onclick={() => request.setRepaintRegion(INITIAL_REGION)}
			>
				{t('repaint.region.select')}
			</button>
		{/if}
	</div>

	<div class="color-section" inert={formLocked} class:locked={formLocked}>
		<div class="selected">
			<span class="section-label">{t('repaint.colorLabel')}</span>
			<span class="selected-value">
				<span
					class="selected-swatch"
					style:background-color={request.repaintColor}
					aria-hidden="true"
				></span>
				<span class="visually-hidden">{t('repaint.selectedColor')}:</span>
				{#if selectedPreset}{t(selectedPreset.label)} ·{/if}
				<span class="hex">{request.repaintColor.toUpperCase()}</span>
			</span>
		</div>

		<div class="palette" role="group" aria-label={t('repaint.paletteLabel')}>
			{#each REPAINT_COLOR_PRESETS as preset (preset.hex)}
				{@const selected = preset.hex === request.repaintColor}
				<button
					type="button"
					class="swatch"
					class:selected
					style:background-color={preset.hex}
					aria-pressed={selected}
					aria-label={t(preset.label)}
					title={t(preset.label)}
					onclick={() => request.setRepaintColor(preset.hex)}
				></button>
			{/each}
		</div>

		<div class="custom">
			<span class="section-label">{t('repaint.customColorLabel')}</span>
			<div class="picker">
				<ColorPicker
					hex={request.repaintColor}
					isDialog={false}
					isAlpha={false}
					textInputModes={['hex']}
					sliderDirection="horizontal"
					texts={pickerTexts}
					onInput={({ color }) => pickColor(color)}
				/>
			</div>
		</div>
	</div>

	{#if !isAuthenticated}
		<p class="auth-hint">{t('repaint.signInToApply')}</p>
	{:else if validationKey && jobId === null}
		<p class="validation-hint">{t(validationKey)}</p>
	{/if}

	<button type="button" class="btn-apply" disabled={!canSubmit} onclick={() => void submit()}>
		{#if submitting}
			<span class="spinner" aria-hidden="true"></span>
			{t('repaint.submitting')}
		{:else if isPolling}
			{t('repaint.processing')}
		{:else if terminalJob?.id === jobId}
			{t('repaint.completed')}
		{:else}
			{t('repaint.apply')}
		{/if}
	</button>

	<div class="job-live" role="status" aria-live="polite" aria-atomic="true">
		{#if isPolling}
			<p class="job-status">
				<span class="spinner" aria-hidden="true"></span>
				{t('repaint.processing')}
			</p>
		{:else if terminalJob?.id === jobId}
			<p class="job-success">{t('repaint.completed')}</p>
		{/if}
	</div>

	{#if terminalJob?.id === jobId}
		<button type="button" class="secondary-btn" onclick={() => void clearJob()}>
			{t('repaint.newRequest')}
		</button>
	{:else if terminalError?.jobId === jobId || (terminalError?.jobId === '' && jobId === null)}
		<p class="submit-error" role="alert">{t(terminalError.key)}</p>
		{#if jobId !== null}
			<button type="button" class="secondary-btn" onclick={() => void clearJob()}>
				{t('repaint.tryAgain')}
			</button>
		{/if}
	{:else if pollFailure?.jobId === jobId}
		<p class="submit-error" role="alert">{t(pollFailure.key)}</p>
		<button type="button" class="secondary-btn" onclick={retryPolling}>
			{t('repaint.retryStatus')}
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

	.field-label,
	.section-label {
		font-size: 0.8125rem;
		font-weight: 600;
		color: var(--color-muted);
	}

	input[type='text'] {
		font: inherit;
		font-size: 0.9375rem;
		padding: 0.625rem 0.875rem;
		border: 1.5px solid var(--color-border);
		border-radius: 10px;
		background: var(--color-background);
		color: var(--color-text);
		transition: border-color 0.15s;
	}

	input[type='text']:focus {
		outline: none;
		border-color: var(--color-accent);
	}

	input[type='text']::placeholder {
		color: var(--color-muted);
		opacity: 0.6;
	}

	input[type='text']:disabled {
		opacity: 0.6;
	}

	.region-section {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.375rem;
	}

	.region-hint {
		margin: 0;
		font-size: 0.8125rem;
		color: var(--color-muted);
	}

	.color-section {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.color-section.locked {
		opacity: 0.5;
	}

	.selected {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
	}

	.selected-value {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		font-size: 0.8125rem;
		color: var(--color-text);
	}

	.selected-swatch {
		width: 1.125rem;
		height: 1.125rem;
		border-radius: 6px;
		border: 1px solid var(--color-border);
	}

	.hex {
		font-variant-numeric: tabular-nums;
		color: var(--color-muted-strong);
	}

	.palette {
		display: grid;
		grid-template-columns: repeat(6, minmax(0, 1fr));
		gap: 0.5rem;
	}

	.swatch {
		aspect-ratio: 1;
		min-width: 0;
		padding: 0;
		border: 1.5px solid var(--color-border);
		border-radius: 10px;
		cursor: pointer;
		transition:
			box-shadow 0.15s,
			border-color 0.15s;
	}

	.swatch:hover {
		border-color: var(--color-accent);
	}

	.swatch.selected {
		border-color: var(--color-accent);
		box-shadow:
			0 0 0 2px var(--color-surface),
			0 0 0 4px var(--color-accent);
	}

	.swatch:focus-visible {
		outline: 2px solid var(--color-accent);
		outline-offset: 2px;
	}

	.custom {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}

	/* The picker sizes itself in fixed lengths; container units let it fill
	   whatever width the tool panel has. 18px = its own padding and border. */
	.picker {
		container-type: inline-size;
		--cp-bg-color: var(--color-background);
		--cp-border-color: var(--color-border);
		--cp-text-color: var(--color-text);
		--cp-input-color: var(--color-surface);
		--cp-button-hover-color: var(--color-surface-hover);
		--focus-color: var(--color-accent);
		--picker-width: calc(100cqw - 18px);
		--picker-height: 140px;
	}

	.picker :global(.wrapper) {
		display: flex;
		flex-direction: column;
		box-sizing: border-box;
		width: 100%;
		margin: 0;
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
		.palette {
			grid-template-columns: repeat(4, minmax(0, 1fr));
		}
	}
</style>
