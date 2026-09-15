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
	import { Eraser, Lightbulb, PaintRoller, Pencil, Plus, Replace } from '@lucide/svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { z } from 'zod';
	import type { EditCompletedResponse, EditJobResponse } from '$lib/api/contract';
	import { t, ti, type TranslationKey } from '$lib/i18n/index.svelte';
	import {
		extractApiErrorCode,
		request,
		RequestImageUploadError,
		type EditOperationType
	} from '$lib/state/request.svelte';
	import { auth } from '$lib/state/auth.svelte';
	import { currency } from '$lib/state/currency.svelte';
	import { generatedImages } from '$lib/state/generated-images.svelte';
	import { generationOverlay } from '$lib/state/generation-overlay.svelte';
	import { mediaAccess } from '$lib/state/media-access.svelte';
	import { buildWorkspaceUrl, slugToTool, type ToolId } from '$lib/state/url-state';
	import { createTabController, logBoundaryError } from '$lib/utils';
	import EditAddObjectTool from '$lib/components/EditAddObjectTool.svelte';
	import EditRemoveObjectTool from '$lib/components/EditRemoveObjectTool.svelte';
	import LightSettingsPanel from '$lib/components/LightSettingsPanel.svelte';
	import ObjectReplacementPanel from '$lib/components/ObjectReplacementPanel.svelte';
	import TextureReplacementPanel from '$lib/components/TextureReplacementPanel.svelte';

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

	type LucideIcon = typeof Pencil;

	const TOOLS: {
		id: ToolId;
		label: TranslationKey;
		Icon: LucideIcon;
		alphaLabel?: TranslationKey;
	}[] = [
		{ id: 'freeform', label: 'edit.tool.freeform', Icon: Pencil },
		{ id: 'add-object', label: 'edit.tool.addObject', Icon: Plus },
		{ id: 'remove-object', label: 'edit.tool.removeObject', Icon: Eraser },
		{ id: 'light-settings', label: 'edit.tool.lightSettings', Icon: Lightbulb },
		{
			id: 'object-replacement',
			label: 'mode.objectReplacement',
			Icon: Replace,
			alphaLabel: 'objectReplacement.alpha'
		},
		{
			id: 'texture-replacement',
			label: 'mode.textureReplacement',
			Icon: PaintRoller,
			alphaLabel: 'textureReplacement.alpha'
		}
	];

	// Only ever rendered in edit mode (see Workspace.svelte), so the URL's
	// `tool` query param is this component's tab state.
	const activeTool = $derived(slugToTool(page.url.searchParams.get('tool') ?? undefined));
	let toolTabButtons = $state<HTMLElement[]>([]);
	let submitting = $state(false);
	let terminalError = $state<PollFailure | null>(null);
	let pollFailure = $state<PollFailure | null>(null);
	let pollRun = 0;
	let objectReplacementOpened = $state(false);
	let textureReplacementOpened = $state(false);
	let lightSettingsOpened = $state(false);

	$effect(() => {
		if (activeTool === 'object-replacement') objectReplacementOpened = true;
		if (activeTool === 'texture-replacement') textureReplacementOpened = true;
		if (activeTool === 'light-settings') lightSettingsOpened = true;
	});

	const toolTabs = createTabController({
		itemCount: () => TOOLS.length,
		getActiveIndex: () => TOOLS.findIndex((tool) => tool.id === activeTool),
		setActiveIndex: (index) => {
			return goto(buildWorkspaceUrl('edit', request, { tool: TOOLS[index].id }), {
				replaceState: true,
				keepFocus: true,
				noScroll: true
			}).catch((err: unknown) => logBoundaryError('editPanel.toolNavigation', err));
		},
		focusTab: (index) => toolTabButtons[index]?.focus()
	});

	const currentRender = $derived(request.currentRender);
	const isAuthenticated = $derived(auth.status === 'authenticated');
	// Editing targets the latest render/edit result once one exists; before that,
	// it falls back to the room photo uploaded on the Render tab (same underlying
	// state — FR: editing works independent of having rendered first). A photo
	// picked but not yet uploaded (request.pendingImageFile) already counts here —
	// the actual upload is deferred, not skipped, see request.resolveEditSource().
	const hasEditTarget = $derived(request.hasEditSource());
	const jobId = $derived(request.activeFluxKontextEditJobId ?? null);
	// Unlike the other three job-backed tools, a completed edit here clears
	// the job immediately (see applyCompletedJob) rather than staying set
	// until an explicit "new request" — so isPolling only has to rule out an
	// already-failed job, never an already-completed one.
	const isPolling = $derived(
		jobId !== null && terminalError?.jobId !== jobId && pollFailure?.jobId !== jobId
	);
	const formLocked = $derived(submitting || jobId !== null);

	function applyTemplate(fill: string): void {
		request.setEditPrompt(fill);
	}

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
			'generationOverlay.edit',
			'generationOverlay.editDetail'
		);
		return () => generationOverlay.stop(overlayId);
	}

	$effect(overlayEffect);

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
		if (code === 'unauthorized') return 'edit.signInToApply';
		if (code === 'insufficient_credit') return 'edit.insufficientCredit';
		if (code === 'generation_restricted') return 'edit.generationRestricted';
		if (code === 'rate_limited') return 'edit.rateLimited';
		if (code === 'edit_not_found') return 'edit.notFound';
		if (code === 'edit_timeout') return 'edit.timedOut';
		return 'edit.failed';
	}

	function applyCompletedJob(result: EditCompletedResponse): void {
		if (request.currentRender?.id === result.id) {
			request.setActiveFluxKontextEditJobId(undefined);
			void auth.refreshCredit();
			if (auth.canLoadGeneratedImages) void generatedImages.load();
			return;
		}
		const context = request.activeFluxKontextEditJob;
		if (context?.id === result.id && context.sourceRender) {
			request.applyEditResult(
				{
					id: result.id,
					outputKey: mediaAccess.normalize(result.output).key,
					cost: result.cost,
					balance: result.balance,
					parentId: context.sourceRender.id,
					editOp: { type: context.type, instruction: context.instruction },
					ts: Date.now()
				},
				context.sourceRender
			);
		} else {
			request.applyEditResult({
				id: result.id,
				outputKey: mediaAccess.normalize(result.output).key,
				cost: result.cost,
				balance: result.balance,
				editOp: { type: context?.type ?? 'freeform', instruction: context?.instruction ?? '' },
				ts: Date.now()
			});
		}
		if (context?.type === 'freeform') request.setEditPrompt('');
		// Unlike object-replacement/light-settings (a dedicated tab that locks
		// until an explicit "new request"), freeform/add-object/remove-object
		// share this inline panel and always supported applying another edit
		// right away — clearing the job here keeps that continuous-editing UX
		// instead of leaving the form locked once the async job completes.
		request.setActiveFluxKontextEditJobId(undefined);
		void auth.refreshCredit();
		if (auth.canLoadGeneratedImages) void generatedImages.load();
	}

	async function parseJobResponse(
		response: Response,
		expectedId?: string
	): Promise<EditJobResponse> {
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
				response = await fetch(`/api/edit/${encodeURIComponent(id)}`, {
					signal: requestSignal
				});
			} catch (error) {
				if (signal.aborted || run !== pollRun) return;
				failures += 1;
				if (failures > MAX_TRANSIENT_FAILURES) {
					pollFailure = { jobId: id, key: 'edit.pollFailed' };
					return;
				}
				if (!(error instanceof Error)) {
					logBoundaryError('edit.poll', error);
				}
				await waitFor(transientDelay(failures), signal);
				continue;
			}
			if (signal.aborted || run !== pollRun) return;

			if (!response.ok) {
				const code = await extractApiErrorCode(response, 'edit_poll_failed');
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
			let result: EditJobResponse;
			try {
				result = await parseJobResponse(response, id);
			} catch {
				if (signal.aborted || run !== pollRun) return;
				if (requestSignal.aborted) {
					failures += 1;
					if (failures > MAX_TRANSIENT_FAILURES) {
						pollFailure = { jobId: id, key: 'edit.pollFailed' };
						return;
					}
					await waitFor(transientDelay(failures), signal);
					continue;
				}
				pollFailure = { jobId: id, key: 'edit.pollFailed' };
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
			applyCompletedJob(result);
			return;
		}
	}

	async function submit(prompt: string, type: EditOperationType): Promise<void> {
		const trimmed = prompt.trim();
		if (!hasEditTarget || !trimmed || formLocked || !isAuthenticated) return;
		submitting = true;
		terminalError = null;
		pollFailure = null;
		try {
			const sourceRender = request.currentRender;
			const source = await request.resolveEditSource();
			if (!source) return;
			const { sessionId } = await request.ensureProjectSession();
			const response = await fetch('/api/edit', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ imageKey: source, prompt: trimmed, sessionId })
			});
			if (!response.ok) {
				const code = await extractApiErrorCode(response, 'edit_failed');
				terminalError = { jobId: '', key: errorKey(code) };
				return;
			}
			const result = await parseJobResponse(response);
			if (result.status !== 'processing') throw new Error('invalid_response');
			request.setActiveFluxKontextEditJob(result.id, sourceRender, trimmed, type);
		} catch (err) {
			terminalError = {
				jobId: '',
				key: err instanceof RequestImageUploadError ? 'upload.errorUpload' : 'edit.failed'
			};
		} finally {
			submitting = false;
		}
	}
</script>

<section class="edit-panel">
	<h2 class="panel-heading">{t('edit.title')}</h2>

	<div class="edit-body">
		<div
			class="tool-tabs"
			role="tablist"
			aria-label={t('edit.tool.switcher.label')}
			aria-orientation="vertical"
		>
			{#each TOOLS as tool, index (tool.id)}
				{@const Icon = tool.Icon}
				<button
					{@attach (node) => {
						toolTabButtons[index] = node as HTMLElement;
					}}
					type="button"
					role="tab"
					id={`edit-tool-tab-${tool.id}`}
					aria-selected={activeTool === tool.id}
					aria-controls={`edit-tool-panel-${tool.id}`}
					tabindex={activeTool === tool.id ? 0 : -1}
					class:active={activeTool === tool.id}
					title={tool.alphaLabel ? `${t(tool.label)} — ${t(tool.alphaLabel)}` : t(tool.label)}
					onclick={() => toolTabs.activate(index)}
					onkeydown={toolTabs.onKeydown}
				>
					<Icon size={18} strokeWidth={1.8} aria-hidden="true" />
					<span class="visually-hidden">
						{t(tool.label)}{#if tool.alphaLabel}
							&nbsp;— {t(tool.alphaLabel)}{/if}
					</span>
					{#if tool.alphaLabel}
						<span class="tool-alpha-dot" aria-hidden="true"></span>
					{/if}
				</button>
			{/each}
		</div>

		<div class="tool-content">
			{#if activeTool !== 'object-replacement' && activeTool !== 'texture-replacement' && activeTool !== 'light-settings'}
				<div
					class="tool-panel"
					role="tabpanel"
					id={`edit-tool-panel-${activeTool}`}
					aria-labelledby={`edit-tool-tab-${activeTool}`}
					tabindex="0"
				>
					{#if activeTool === 'freeform'}
						<div class="chips">
							<button
								type="button"
								class="chip"
								onclick={() => applyTemplate(t('edit.templateReplaceFill'))}
							>
								{t('edit.templateReplace')}
							</button>
							<button
								type="button"
								class="chip"
								onclick={() => applyTemplate(t('edit.templateColorFill'))}
							>
								{t('edit.templateColor')}
							</button>
						</div>

						<label class="field">
							<span class="field-label">{t('edit.instruction')}</span>
							<textarea
								value={request.editPrompt}
								oninput={(event) => request.setEditPrompt(event.currentTarget.value)}
								rows="3"
								disabled={formLocked}
								placeholder={t('edit.templateReplaceFill')}></textarea>
						</label>

						<div class="actions">
							<button
								type="button"
								class="btn-apply"
								disabled={!request.editPrompt.trim() ||
									formLocked ||
									!isAuthenticated ||
									!hasEditTarget}
								onclick={() => void submit(request.editPrompt, 'freeform')}
							>
								{#if submitting}
									<span class="spinner" aria-hidden="true"></span>
									{t('edit.submitting')}
								{:else if isPolling}
									{t('edit.processing')}
								{:else}
									{t('edit.apply')}
								{/if}
							</button>
						</div>
					{:else if activeTool === 'add-object'}
						<EditAddObjectTool
							disabled={formLocked || !hasEditTarget}
							applying={submitting || isPolling}
							onApply={(prompt) => void submit(prompt, 'add-object')}
						/>
					{:else if activeTool === 'remove-object'}
						<EditRemoveObjectTool
							disabled={formLocked || !hasEditTarget}
							applying={submitting || isPolling}
							onApply={(prompt) => void submit(prompt, 'remove-object')}
						/>
					{/if}

					<div class="job-live" role="status" aria-live="polite" aria-atomic="true">
						{#if isPolling}
							<p class="job-status">
								<span class="spinner" aria-hidden="true"></span>
								{t('edit.processing')}
							</p>
						{/if}
					</div>

					{#if terminalError?.jobId === jobId || (terminalError?.jobId === '' && jobId === null)}
						<p class="submit-error" role="alert">{t(terminalError.key)}</p>
						{#if jobId !== null}
							<button
								type="button"
								class="secondary-btn"
								onclick={() => {
									request.setActiveFluxKontextEditJobId(undefined);
									terminalError = null;
								}}
							>
								{t('edit.tryAgain')}
							</button>
						{/if}
					{:else if pollFailure?.jobId === jobId}
						<p class="submit-error" role="alert">{t(pollFailure.key)}</p>
						<button type="button" class="secondary-btn" onclick={() => (pollFailure = null)}>
							{t('edit.retryStatus')}
						</button>
					{/if}
				</div>
			{/if}

			{#if lightSettingsOpened}
				<div
					class="tool-panel"
					role="tabpanel"
					id="edit-tool-panel-light-settings"
					aria-labelledby="edit-tool-tab-light-settings"
					tabindex="0"
					hidden={activeTool !== 'light-settings'}
				>
					<svelte:boundary
						onerror={(err: unknown) => logBoundaryError('editPanel.lightSettings', err)}
					>
						<LightSettingsPanel />
						{#snippet failed(_error: unknown, reset: () => void)}
							<p class="error">{t('boundary.failed')}</p>
							<button type="button" class="btn-apply" onclick={reset}>
								{t('boundary.retry')}
							</button>
						{/snippet}
					</svelte:boundary>
				</div>
			{/if}

			{#if objectReplacementOpened}
				<div
					class="tool-panel"
					role="tabpanel"
					id="edit-tool-panel-object-replacement"
					aria-labelledby="edit-tool-tab-object-replacement"
					tabindex="0"
					hidden={activeTool !== 'object-replacement'}
				>
					<svelte:boundary
						onerror={(err: unknown) => logBoundaryError('editPanel.objectReplacement', err)}
					>
						<ObjectReplacementPanel />
						{#snippet failed(_error: unknown, reset: () => void)}
							<p class="error">{t('boundary.failed')}</p>
							<button type="button" class="btn-apply" onclick={reset}>
								{t('boundary.retry')}
							</button>
						{/snippet}
					</svelte:boundary>
				</div>
			{/if}

			{#if textureReplacementOpened}
				<div
					class="tool-panel"
					role="tabpanel"
					id="edit-tool-panel-texture-replacement"
					aria-labelledby="edit-tool-tab-texture-replacement"
					tabindex="0"
					hidden={activeTool !== 'texture-replacement'}
				>
					<svelte:boundary
						onerror={(err: unknown) => logBoundaryError('editPanel.textureReplacement', err)}
					>
						<TextureReplacementPanel />
						{#snippet failed(_error: unknown, reset: () => void)}
							<p class="error">{t('boundary.failed')}</p>
							<button type="button" class="btn-apply" onclick={reset}>
								{t('boundary.retry')}
							</button>
						{/snippet}
					</svelte:boundary>
				</div>
			{/if}
		</div>
	</div>

	{#if !isAuthenticated && activeTool !== 'object-replacement' && activeTool !== 'texture-replacement' && activeTool !== 'light-settings'}
		<p class="auth-hint">{t('edit.signInToApply')}</p>
	{/if}

	{#if currentRender?.editOp}
		<div class="meta">
			<span>{ti('edit.cost', { cost: currency.format(currentRender.cost) })}</span>
			<span class="sep">·</span>
			<span>{ti('edit.balance', { balance: currency.format(currentRender.balance) })}</span>
		</div>
	{/if}
</section>

<style>
	.edit-panel {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		padding: 1.25rem 1.5rem 1.5rem;
		background: var(--color-surface);
		border: 1.5px solid var(--color-border);
		border-left: 4px solid var(--color-accent);
		border-radius: 16px;
		box-shadow: var(--shadow-md);
	}

	.edit-body {
		display: flex;
		align-items: flex-start;
		gap: 1rem;
	}

	.tool-content {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	/* A vertical icon rail instead of horizontal tabs — switches the same
	   tools via the same tablist/URL-driven controller, just reoriented.
	   Ordered after .tool-content so it still renders on the right visually
	   despite coming first in the DOM (a keyboard user tabbing through must
	   reach the tabs before the panel they control). */
	.tool-tabs {
		order: 1;
		flex: 0 0 auto;
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
		padding: 0.25rem;
		background: var(--color-background);
		border-radius: 12px;
	}

	.tool-panel {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.tool-panel[hidden] {
		display: none;
	}

	.tool-tabs button {
		position: relative;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 2.75rem;
		height: 2.75rem;
		padding: 0;
		font: inherit;
		color: var(--color-muted);
		background: transparent;
		border: none;
		border-radius: 9px;
		cursor: pointer;
		transition:
			background 0.15s,
			color 0.15s;
	}

	.tool-tabs button:hover:not(.active) {
		background: var(--color-surface-hover);
		color: var(--color-text);
	}

	.tool-tabs button.active {
		background: var(--color-surface);
		color: var(--color-text);
		box-shadow: var(--shadow);
	}

	.tool-alpha-dot {
		position: absolute;
		top: 0.3rem;
		right: 0.3rem;
		width: 0.375rem;
		height: 0.375rem;
		border-radius: 50%;
		background: var(--color-accent);
	}

	.chips {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.chip {
		padding: 0.3rem 0.75rem;
		font: inherit;
		font-size: 0.8125rem;
		color: var(--color-accent-text);
		background: color-mix(in srgb, var(--color-accent) 8%, var(--color-surface));
		border: 1.5px solid color-mix(in srgb, var(--color-accent) 25%, transparent);
		border-radius: 100px;
		cursor: pointer;
		transition:
			background 0.15s,
			border-color 0.15s;
		white-space: nowrap;
	}

	.chip:hover {
		background: color-mix(in srgb, var(--color-accent) 14%, var(--color-surface));
		border-color: var(--color-accent);
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
		min-height: 5rem;
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

	.auth-hint {
		margin: 0;
		font-size: 0.875rem;
		color: var(--color-muted);
	}

	.actions {
		display: flex;
		gap: 0.625rem;
		flex-wrap: wrap;
	}

	.btn-apply {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
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

	.meta {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.8125rem;
		color: var(--color-muted);
	}

	.meta .sep {
		opacity: 0.4;
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

	.error {
		margin: 0;
		font-size: 0.8125rem;
		color: var(--color-danger);
	}

	.job-live:empty {
		display: none;
	}

	.job-status {
		margin: 0;
		font-size: 0.875rem;
		display: flex;
		align-items: center;
		gap: 0.625rem;
		color: var(--color-muted-strong);
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
</style>
