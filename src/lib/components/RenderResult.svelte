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
	import type { Attachment } from 'svelte/attachments';
	import {
		Download,
		ImagePlus,
		Pencil,
		Redo,
		Sparkles,
		SquareSplitHorizontal,
		Undo
	} from '@lucide/svelte';
	import { t, ti } from '$lib/i18n/index.svelte';
	import { request, renderResultFromResponse } from '$lib/state/request.svelte';
	import { auth } from '$lib/state/auth.svelte';
	import { generatedImages } from '$lib/state/generated-images.svelte';
	import { generationOverlay } from '$lib/state/generation-overlay.svelte';
	import { formatCredit } from '$lib/utils';

	interface Props {
		onContinueEditing: () => void;
		onStartNewPhoto: () => void;
	}
	let { onContinueEditing, onStartNewPhoto }: Props = $props();

	let comparing = $state(false);
	let upscaling = $state(false);
	let upscaleError = $state<string | null>(null);

	const render = $derived(request.currentRender);
	const imageUrl = $derived(render?.outputUrls[0]);
	const previousImageUrl = $derived(request.previousRender?.outputUrls[0]);
	const canCompare = $derived(previousImageUrl !== undefined);
	const comparisonActive = $derived(comparing && canCompare);
	const isAuthenticated = $derived(auth.status === 'authenticated');
	const downloadName = $derived(`render.${request.outputFormat}`);
	const downloadHref = $derived(
		imageUrl
			? `/api/download?url=${encodeURIComponent(imageUrl)}&filename=${encodeURIComponent(downloadName)}`
			: undefined
	);

	const STALL_TIMEOUT_MS = 20_000;
	const MAX_STALL_RETRIES = 2;

	function withRetryParam(url: string, attempt: number): string {
		const separator = url.includes('?') ? '&' : '?';
		return `${url}${separator}retry=${attempt}`;
	}

	function imageStallWatchdog(url: string): Attachment<HTMLImageElement> {
		return (image) => {
			let attempt = 0;
			let timer: ReturnType<typeof setTimeout>;
			function arm(): void {
				timer = setTimeout(() => {
					attempt += 1;
					image.src = withRetryParam(url, attempt);
					if (attempt < MAX_STALL_RETRIES) arm();
				}, STALL_TIMEOUT_MS);
			}

			function clearTimer(): void {
				clearTimeout(timer);
			}

			if (image.complete) return;
			arm();
			image.addEventListener('load', clearTimer, { once: true });

			return () => {
				clearTimer();
				image.removeEventListener('load', clearTimer);
			};
		};
	}

	function selectRevision(index: number): void {
		comparing = false;
		request.selectRevision(index);
	}

	async function upscale(): Promise<void> {
		if (!render || upscaling || !isAuthenticated) return;
		const sourceRender = render;
		upscaling = true;
		upscaleError = null;
		const overlayId = generationOverlay.start('generationOverlay.upscale');
		try {
			const response = await fetch('/api/upscale', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					image: sourceRender.outputUrls[0],
					outputFormat: request.outputFormat
				})
			});
			if (!response.ok) throw new Error('upscale failed');
			const result = await response.json();
			const newRender = renderResultFromResponse(result, {
				parentId: sourceRender.id,
				editOp: { type: 'upscale', instruction: t('toolbar.upscaleDone') }
			});
			request.applyEditResult(newRender, sourceRender);
			void auth.refreshCredit();
			if (auth.canLoadGeneratedImages) void generatedImages.load();
		} catch {
			upscaleError = t('toolbar.upscaleFailed');
		} finally {
			upscaling = false;
			generationOverlay.stop(overlayId);
		}
	}
</script>

{#if render && imageUrl}
	<section class="result" aria-label={t('render.result')}>
		<div class="image-card">
			{#if comparisonActive && previousImageUrl}
				<div class="compare">
					<div class="compare-half">
						<span class="compare-label">{t('toolbar.before')}</span>
						<img
							src={previousImageUrl}
							alt={t('toolbar.before')}
							class="output"
							{@attach imageStallWatchdog(previousImageUrl)}
						/>
					</div>
					<div class="compare-half">
						<span class="compare-label">{t('toolbar.after')}</span>
						<img
							src={imageUrl}
							alt={t('toolbar.after')}
							class="output"
							{@attach imageStallWatchdog(imageUrl)}
						/>
					</div>
				</div>
			{:else}
				<img
					src={imageUrl}
					alt={t('render.result')}
					class="output"
					{@attach imageStallWatchdog(imageUrl)}
				/>
			{/if}
		</div>

		<div class="toolbar">
			<button
				type="button"
				class="toolbar-action"
				disabled={!request.canUndoEdit}
				title={t('toolbar.undo')}
				onclick={() => request.undoLastEdit()}
			>
				<Undo size={16} strokeWidth={1.8} aria-hidden="true" />
				<span>{t('toolbar.undo')}</span>
			</button>
			<button
				type="button"
				class="toolbar-action"
				disabled={!request.canRedoEdit}
				title={t('toolbar.redo')}
				onclick={() => request.redoEdit()}
			>
				<Redo size={16} strokeWidth={1.8} aria-hidden="true" />
				<span>{t('toolbar.redo')}</span>
			</button>

			<span class="toolbar-sep" aria-hidden="true"></span>

			<a
				href={downloadHref}
				download={downloadName}
				class="icon-btn"
				aria-label={t('render.download')}
				title={t('render.download')}
			>
				<Download size={16} strokeWidth={1.8} aria-hidden="true" />
			</a>
			<button
				type="button"
				class="icon-btn"
				disabled={upscaling || !isAuthenticated}
				aria-label={isAuthenticated ? t('toolbar.upscale') : t('toolbar.signInToUpscale')}
				title={isAuthenticated ? t('toolbar.upscale') : t('toolbar.signInToUpscale')}
				onclick={() => void upscale()}
			>
				<Sparkles size={16} strokeWidth={1.8} aria-hidden="true" />
			</button>
			<button
				type="button"
				class="icon-btn"
				class:active={comparisonActive}
				disabled={!canCompare}
				aria-pressed={comparisonActive}
				aria-label={t('toolbar.compare')}
				title={t('toolbar.compare')}
				onclick={() => (comparing = !comparing)}
			>
				<SquareSplitHorizontal size={16} strokeWidth={1.8} aria-hidden="true" />
			</button>

			{#if upscaleError}
				<p class="toolbar-error" role="alert">{upscaleError}</p>
			{/if}
		</div>

		{#if request.renderHistory.length > 0}
			<section class="history" aria-labelledby="render-history-heading">
				<div class="history-header">
					<h2 id="render-history-heading">{t('history.label')}</h2>
					<p>{t('history.hint')}</p>
				</div>
				<div class="revision-list">
					{#each request.renderHistory as revision, index (revision.id)}
						<button
							type="button"
							class="revision"
							class:selected={index === request.currentRevisionIndex}
							aria-current={index === request.currentRevisionIndex ? 'true' : undefined}
							aria-label={`${ti('history.select', { order: index + 1 })}${
								index === request.currentRevisionIndex ? ` — ${t('history.current')}` : ''
							}`}
							onclick={() => selectRevision(index)}
						>
							<span class="revision-image">
								<img src={revision.outputUrls[0]} alt="" loading="lazy" />
							</span>
							<span class="revision-label">
								{index === 0 ? t('history.base') : ti('history.edit', { order: index })}
							</span>
							{#if index === request.currentRevisionIndex}
								<span class="revision-current">{t('history.current')}</span>
							{/if}
						</button>
					{/each}
				</div>
			</section>
		{/if}

		<div class="footer">
			<div class="meta">
				<span>{ti('render.cost', { cost: formatCredit(render.cost) })}</span>
				<span class="sep">·</span>
				<span>{ti('render.balance', { balance: formatCredit(render.balance) })}</span>
			</div>
			<div class="actions">
				<button type="button" class="btn btn-secondary" onclick={onStartNewPhoto}>
					<ImagePlus size={14} strokeWidth={1.75} aria-hidden="true" />
					{t('project.startNewPhoto')}
				</button>
				<button type="button" class="btn btn-accent" onclick={onContinueEditing}>
					<Pencil size={14} strokeWidth={1.75} aria-hidden="true" />
					{t('project.continueEditing')}
				</button>
			</div>
		</div>
	</section>
{/if}

<style>
	.result {
		display: flex;
		flex-direction: column;
		gap: 0;
		background: var(--color-surface);
		border: 1.5px solid var(--color-border);
		border-radius: var(--radius-lg);
		overflow: hidden;
		box-shadow: var(--shadow-lg);
	}

	.image-card {
		display: grid;
		place-items: center;
		width: 100%;
		min-height: clamp(20rem, 52vw, 34rem);
		background: var(--color-background);
	}

	.output {
		width: 100%;
		height: clamp(20rem, 52vw, 34rem);
		object-fit: contain;
		display: block;
	}

	.compare {
		display: flex;
		width: 100%;
	}

	.compare-half {
		position: relative;
		width: 50%;
		border-right: 1px solid var(--color-border);
	}

	.compare-half:last-child {
		border-right: none;
	}

	.compare-half .output {
		height: clamp(20rem, 52vw, 34rem);
	}

	.compare-label {
		position: absolute;
		top: 0.5rem;
		left: 0.5rem;
		padding: 0.15rem 0.5rem;
		font-size: 0.6875rem;
		font-weight: 600;
		color: white;
		background: rgb(0 0 0 / 0.55);
		border-radius: 100px;
		z-index: 1;
	}

	.toolbar {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.625rem 1.25rem;
		border-top: 1px solid var(--color-border);
		flex-wrap: wrap;
	}

	.toolbar-sep {
		width: 1px;
		height: 1.25rem;
		background: var(--color-border);
		margin: 0 0.125rem;
	}

	.icon-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 2rem;
		height: 2rem;
		padding: 0;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-surface);
		color: var(--color-text);
		cursor: pointer;
		text-decoration: none;
		transition:
			background 0.15s,
			border-color 0.15s,
			color 0.15s;
	}

	.toolbar-action {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.375rem;
		min-height: 2rem;
		padding: 0.375rem 0.625rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-surface);
		color: var(--color-text);
		font: inherit;
		font-size: 0.8125rem;
		cursor: pointer;
		transition:
			background 0.15s,
			border-color 0.15s,
			color 0.15s;
	}

	.icon-btn:hover:not(:disabled),
	.toolbar-action:hover:not(:disabled) {
		background: var(--color-surface-hover);
		border-color: var(--color-accent);
		color: var(--color-accent);
	}

	.icon-btn.active {
		color: var(--color-accent-contrast);
		background: var(--color-accent);
		border-color: var(--color-accent);
	}

	.icon-btn:disabled,
	.toolbar-action:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.icon-btn:focus-visible,
	.toolbar-action:focus-visible,
	.revision:focus-visible,
	.btn:focus-visible {
		outline: 3px solid var(--color-accent);
		outline-offset: 2px;
	}

	.toolbar-error {
		margin: 0;
		font-size: 0.8125rem;
		color: var(--color-danger);
	}

	.history {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		padding: 1rem 1.25rem;
		border-top: 1px solid var(--color-border);
		background: color-mix(in srgb, var(--color-background) 70%, var(--color-surface));
	}

	.history-header {
		display: flex;
		align-items: baseline;
		gap: 0.75rem;
		flex-wrap: wrap;
	}

	.history-header h2,
	.history-header p {
		margin: 0;
	}

	.history-header h2 {
		font-size: 0.9375rem;
		color: var(--color-text);
	}

	.history-header p {
		font-size: 0.75rem;
		color: var(--color-muted-strong);
	}

	.revision-list {
		display: flex;
		gap: 0.625rem;
		padding: 0.125rem 0.125rem 0.5rem;
		overflow-x: auto;
		scrollbar-gutter: stable;
		scroll-snap-type: x proximity;
	}

	.revision {
		position: relative;
		display: flex;
		flex: 0 0 8rem;
		flex-direction: column;
		gap: 0.375rem;
		padding: 0.375rem;
		border: 1.5px solid var(--color-border);
		border-radius: var(--radius);
		background: var(--color-surface);
		color: var(--color-text);
		font: inherit;
		text-align: left;
		cursor: pointer;
		scroll-snap-align: start;
		transition:
			background 0.15s,
			border-color 0.15s,
			transform 0.15s;
	}

	.revision:hover,
	.revision.selected {
		border-color: var(--color-accent);
	}

	.revision:hover {
		transform: translateY(-1px);
	}

	.revision.selected {
		background: color-mix(in srgb, var(--color-accent) 8%, var(--color-surface));
	}

	.revision-image {
		display: grid;
		place-items: center;
		width: 100%;
		height: 4.75rem;
		overflow: hidden;
		border-radius: calc(var(--radius) - 3px);
		background: var(--color-background);
	}

	.revision-image img {
		width: 100%;
		height: 100%;
		object-fit: contain;
		display: block;
	}

	.revision-label {
		overflow: hidden;
		font-size: 0.75rem;
		font-weight: 600;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.revision-current {
		font-size: 0.6875rem;
		color: var(--color-accent);
	}

	.footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.875rem 1.25rem;
		border-top: 1px solid var(--color-border);
		gap: 1rem;
		flex-wrap: wrap;
	}

	.meta {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.8125rem;
		color: var(--color-muted-strong);
	}

	.sep {
		opacity: 0.4;
	}

	.actions {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.btn {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.5rem 1rem;
		font: inherit;
		font-size: 0.875rem;
		font-weight: 500;
		border-radius: var(--radius);
		cursor: pointer;
		text-decoration: none;
		transition:
			background 0.15s,
			border-color 0.15s;
		white-space: nowrap;
	}

	.btn-accent {
		color: var(--color-accent-contrast);
		background: var(--color-accent);
		border: 1.5px solid var(--color-accent);
	}

	.btn-accent:hover {
		background: var(--color-accent-hover);
		border-color: var(--color-accent-hover);
	}

	.btn-secondary {
		color: var(--color-text);
		background: var(--color-surface);
		border: 1.5px solid var(--color-border);
	}

	.btn-secondary:hover {
		color: var(--color-accent);
		border-color: var(--color-accent);
	}

	@media (max-width: 640px) {
		.image-card,
		.output {
			min-height: 16rem;
			height: min(72vw, 24rem);
		}

		.compare {
			flex-direction: column;
		}

		.compare-half {
			width: 100%;
			border-right: none;
			border-bottom: 1px solid var(--color-border);
		}

		.compare-half:last-child {
			border-bottom: none;
		}

		.compare-half .output {
			height: min(72vw, 24rem);
		}

		.toolbar,
		.history,
		.footer {
			padding-right: 0.875rem;
			padding-left: 0.875rem;
		}

		.footer,
		.actions {
			align-items: stretch;
			width: 100%;
		}

		.actions {
			flex-direction: column-reverse;
		}

		.btn {
			justify-content: center;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.icon-btn,
		.toolbar-action,
		.revision,
		.btn {
			transition: none;
		}

		.revision:hover {
			transform: none;
		}
	}
</style>
