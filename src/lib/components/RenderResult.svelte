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
	import { Download, Pencil, Redo, Sparkles, SquareSplitHorizontal, Undo } from '@lucide/svelte';
	import { t, ti } from '$lib/i18n/index.svelte';
	import { request, renderResultFromResponse } from '$lib/state/request.svelte';
	import { auth } from '$lib/state/auth.svelte';
	import { generatedImages } from '$lib/state/generated-images.svelte';
	import { formatCredit } from '$lib/utils';

	interface Props {
		onEditRequest: () => void;
	}
	let { onEditRequest }: Props = $props();

	let comparing = $state(false);
	let upscaling = $state(false);
	let upscaleError = $state<string | null>(null);

	const render = $derived(request.currentRender);
	const imageUrl = $derived(render?.outputUrls[0]);
	const previousImageUrl = $derived(request.previousRender?.outputUrls[0]);
	const canCompare = $derived(previousImageUrl !== undefined);
	const isAuthenticated = $derived(auth.status === 'authenticated');
	// The render result doesn't carry its own format, so the current form setting
	// is the best available signal for the download filename's extension.
	const downloadName = $derived(`render.${request.outputFormat}`);
	// archAI hosts the output on its own CDN, so a plain <a download> to imageUrl
	// only works same-origin — cross-origin, browsers just navigate away instead,
	// losing all in-page form state. Routing through our own proxy with
	// Content-Disposition: attachment forces a real download with no navigation.
	const downloadHref = $derived(
		imageUrl
			? `/api/download?url=${encodeURIComponent(imageUrl)}&filename=${encodeURIComponent(downloadName)}`
			: undefined
	);

	async function upscale(): Promise<void> {
		if (!render || upscaling || !isAuthenticated) return;
		upscaling = true;
		upscaleError = null;
		try {
			const response = await fetch('/api/upscale', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ image: render.outputUrls[0], outputFormat: request.outputFormat })
			});
			if (!response.ok) throw new Error('upscale failed');
			const result = await response.json();
			const newRender = renderResultFromResponse(result, {
				parentId: render.id,
				editOp: { type: 'upscale', instruction: t('toolbar.upscaleDone') }
			});
			request.applyEditResult(newRender);
			if (auth.canLoadGeneratedImages) void generatedImages.load();
		} catch {
			upscaleError = t('toolbar.upscaleFailed');
		} finally {
			upscaling = false;
		}
	}
</script>

{#if render && imageUrl}
	<section class="result">
		<div class="image-card">
			{#if comparing && previousImageUrl}
				<div class="compare">
					<div class="compare-half">
						<span class="compare-label">{t('toolbar.before')}</span>
						<img src={previousImageUrl} alt={t('toolbar.before')} class="output" />
					</div>
					<div class="compare-half">
						<span class="compare-label">{t('toolbar.after')}</span>
						<img src={imageUrl} alt={t('toolbar.after')} class="output" />
					</div>
				</div>
			{:else}
				<img src={imageUrl} alt={t('render.generate')} class="output" />
			{/if}
		</div>

		<div class="toolbar">
			<button
				type="button"
				class="icon-btn"
				disabled={!request.canUndoEdit}
				aria-label={t('toolbar.undo')}
				title={t('toolbar.undo')}
				onclick={() => request.undoLastEdit()}
			>
				<Undo size={16} strokeWidth={1.8} aria-hidden="true" />
			</button>
			<button
				type="button"
				class="icon-btn"
				disabled={!request.canRedoEdit}
				aria-label={t('toolbar.redo')}
				title={t('toolbar.redo')}
				onclick={() => request.redoEdit()}
			>
				<Redo size={16} strokeWidth={1.8} aria-hidden="true" />
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
				aria-label={t('toolbar.upscale')}
				title={isAuthenticated ? t('toolbar.upscale') : t('toolbar.signInToUpscale')}
				onclick={() => void upscale()}
			>
				<Sparkles size={16} strokeWidth={1.8} aria-hidden="true" />
			</button>
			<button
				type="button"
				class="icon-btn"
				class:active={comparing}
				disabled={!canCompare}
				aria-pressed={comparing}
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

		<div class="footer">
			<div class="meta">
				<span>{ti('render.cost', { cost: formatCredit(render.cost) })}</span>
				<span class="sep">·</span>
				<span>{ti('render.balance', { balance: formatCredit(render.balance) })}</span>
			</div>
			<div class="actions">
				<button type="button" class="btn btn-accent" onclick={onEditRequest}>
					<Pencil size={14} strokeWidth={1.75} aria-hidden="true" />
					{t('render.edit')}
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
		width: 100%;
		background: var(--color-background);
	}

	.output {
		width: 100%;
		max-height: 480px;
		object-fit: contain;
		display: block;
	}

	.compare {
		display: flex;
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
		max-height: 480px;
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

	.icon-btn:hover:not(:disabled) {
		background: var(--color-surface-hover);
		border-color: var(--color-accent);
		color: var(--color-accent);
	}

	.icon-btn.active {
		color: var(--color-accent-contrast);
		background: var(--color-accent);
		border-color: var(--color-accent);
	}

	.icon-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.toolbar-error {
		margin: 0;
		font-size: 0.8125rem;
		color: var(--color-danger);
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
		color: var(--color-muted);
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
</style>
