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
	import {
		ArrowLeft,
		ArrowRight,
		Download,
		Hd,
		ImagePlus,
		SquareSplitHorizontal
	} from '@lucide/svelte';
	import { resolve } from '$app/paths';
	import type { Snippet } from 'svelte';
	import CompareSlider from '$lib/components/CompareSlider.svelte';
	import LazyImage from '$lib/components/LazyImage.svelte';
	import RegionSelector from '$lib/components/RegionSelector.svelte';
	import { t, ti } from '$lib/i18n/index.svelte';
	import { request } from '$lib/state/request.svelte';
	import { auth } from '$lib/state/auth.svelte';
	import { currency } from '$lib/state/currency.svelte';
	import { photoProcessing } from '$lib/state/photo-processing.svelte';
	import { mediaAccess } from '$lib/state/media-access.svelte';

	interface Props {
		regionTool?: 'repaint' | 'object-replacement';
		imagePreview?: Snippet;
		photoProcessingMode?: boolean;
	}

	let { regionTool = undefined, imagePreview, photoProcessingMode = false }: Props = $props();

	let comparing = $state(false);
	let imageSize = $state<{ width: number; height: number } | null>(null);
	let resetConfirmOpen = $state(false);

	function rememberImageSize(image: HTMLImageElement): void {
		if (image.naturalWidth > 0 && image.naturalHeight > 0) {
			imageSize = { width: image.naturalWidth, height: image.naturalHeight };
		}
	}

	function openModal(dialog: HTMLDialogElement): () => void {
		dialog.showModal();
		return () => {
			if (dialog.open) dialog.close();
		};
	}

	function requestReset(): void {
		resetConfirmOpen = true;
	}

	function cancelReset(): void {
		resetConfirmOpen = false;
	}

	function confirmReset(): void {
		resetConfirmOpen = false;
		request.reset();
	}

	const render = $derived(request.currentRender);
	const imageUrl = $derived(render ? mediaAccess.get(render.outputKey)?.url : undefined);
	const afterImageUrl = $derived(
		photoProcessingMode ? (photoProcessing.previewUrl ?? imageUrl) : imageUrl
	);
	const downloadUrl = $derived(
		render && !(photoProcessingMode && photoProcessing.hasChanges)
			? resolve('/api/media/[bucket]/[...filename]', {
					bucket: render.outputKey.slice(0, render.outputKey.indexOf('/')),
					filename: render.outputKey.slice(render.outputKey.indexOf('/') + 1)
				})
			: undefined
	);

	// The originally uploaded photo is itself the root history step (FR-К6), so
	// "before" is always the actual previous step — there's nothing to compare
	// against only at that root step, where comparing is correctly disabled.
	const beforeImageUrl = $derived(
		request.previousRender ? mediaAccess.get(request.previousRender.outputKey)?.url : undefined
	);
	const canCompare = $derived(beforeImageUrl !== undefined);
	const isAuthenticated = $derived(auth.status === 'authenticated');
	const downloadFormat = $derived.by(() => {
		const extension = render?.outputKey.split('.').at(-1)?.toLowerCase();
		return extension && ['png', 'webp', 'jpg', 'jpeg', 'avif'].includes(extension)
			? extension
			: render?.formSnapshot?.outputFormat;
	});
	const downloadName = $derived(downloadFormat ? `render.${downloadFormat}` : 'render');
</script>

{#if imagePreview || (render && imageUrl)}
	<section class="result">
		<div class="image-card">
			{#if comparing && beforeImageUrl && afterImageUrl}
				<CompareSlider
					beforeSrc={beforeImageUrl}
					afterSrc={afterImageUrl}
					beforeAlt={t('toolbar.before')}
					afterAlt={t('toolbar.after')}
					handleLabel={t('toolbar.compare')}
				/>
			{:else if imagePreview}
				{@render imagePreview()}
			{:else if imageUrl}
				<LazyImage
					src={imageUrl}
					alt={t('render.generate')}
					imgClass="output"
					loading="eager"
					fetchPriority="high"
					onReady={rememberImageSize}
				/>
				{#if regionTool && imageSize}
					<RegionSelector
						region={regionTool === 'repaint'
							? request.activeRepaintRegion()
							: request.activeObjectReplacementRegion()}
						naturalWidth={imageSize.width}
						naturalHeight={imageSize.height}
						boxLabel={t(
							regionTool === 'repaint'
								? 'repaint.region.boxLabel'
								: 'objectReplacement.region.boxLabel'
						)}
						onchange={(region) =>
							regionTool === 'repaint'
								? request.setRepaintRegion(region)
								: request.setObjectReplacementRegion(region)}
					/>
				{/if}
			{/if}

			<div class="toolbar">
				<button
					type="button"
					class="icon-btn"
					disabled={!request.canUndoEdit || photoProcessing.busy}
					aria-label={t('toolbar.previousGeneration')}
					title={t('toolbar.previousGeneration')}
					onclick={() => request.undoLastEdit()}
				>
					<ArrowLeft size={16} strokeWidth={1.8} aria-hidden="true" />
				</button>
				<button
					type="button"
					class="icon-btn"
					disabled={!request.canRedoEdit || photoProcessing.busy}
					aria-label={t('toolbar.nextGeneration')}
					title={t('toolbar.nextGeneration')}
					onclick={() => request.redoEdit()}
				>
					<ArrowRight size={16} strokeWidth={1.8} aria-hidden="true" />
				</button>

				<span class="toolbar-sep" aria-hidden="true"></span>

				{#if downloadUrl}
					<a
						href={downloadUrl}
						download={downloadName}
						class="icon-btn"
						aria-label={t('render.download')}
						title={t('render.download')}
					>
						<Download size={16} strokeWidth={1.8} aria-hidden="true" />
					</a>
				{:else if photoProcessingMode}
					<button
						type="button"
						class="icon-btn"
						aria-label={t('render.download')}
						title={t('render.download')}
						aria-busy={photoProcessing.downloading}
						disabled={!photoProcessing.sourceUrl ||
							photoProcessing.busy ||
							photoProcessing.downloading}
						onclick={() => void photoProcessing.download()}
					>
						<Download size={16} strokeWidth={1.8} aria-hidden="true" />
					</button>
				{/if}
				<button
					type="button"
					class="icon-btn"
					disabled={photoProcessing.busy ||
						!isAuthenticated ||
						(photoProcessingMode && !photoProcessing.canUpscale)}
					aria-label={t('toolbar.upscale')}
					aria-busy={photoProcessing.upscaling}
					title={isAuthenticated ? t('toolbar.upscale') : t('toolbar.signInToUpscale')}
					onclick={() => void photoProcessing.upscale(photoProcessingMode)}
				>
					<Hd size={16} strokeWidth={1.8} aria-hidden="true" />
				</button>
				<button
					type="button"
					class={['icon-btn', { active: comparing }]}
					disabled={!canCompare}
					aria-pressed={comparing}
					aria-label={t('toolbar.compare')}
					title={t('toolbar.compare')}
					onclick={() => (comparing = !comparing)}
				>
					<SquareSplitHorizontal size={16} strokeWidth={1.8} aria-hidden="true" />
				</button>

				<span class="toolbar-sep" aria-hidden="true"></span>

				<button
					type="button"
					class="icon-btn"
					aria-label={t('toolbar.reset')}
					disabled={photoProcessing.busy}
					title={t('toolbar.reset')}
					onclick={requestReset}
				>
					<ImagePlus size={16} strokeWidth={1.8} aria-hidden="true" />
				</button>

				{#if photoProcessing.error && !photoProcessingMode}
					<p class="toolbar-error" role="alert">{photoProcessing.error}</p>
				{/if}
			</div>
		</div>

		{#if render}
			<div class="footer">
				<div class="meta">
					<span>{ti('render.cost', { cost: currency.format(render.cost) })}</span>
					<span class="sep">·</span>
					<span>{ti('render.balance', { balance: currency.format(render.balance) })}</span>
				</div>
			</div>
		{/if}
	</section>

	{#if resetConfirmOpen}
		<dialog
			class="reset-confirm-dialog"
			{@attach openModal}
			aria-labelledby="reset-confirm-title"
			aria-describedby="reset-confirm-description"
			oncancel={(event) => {
				event.preventDefault();
				cancelReset();
			}}
		>
			<h3 id="reset-confirm-title">{t('toolbar.resetConfirmTitle')}</h3>
			<p id="reset-confirm-description">{t('toolbar.resetConfirmDescription')}</p>
			<div class="reset-confirm-actions">
				<button type="button" class="secondary-button" onclick={cancelReset}>
					{t('toolbar.resetConfirmCancel')}
				</button>
				<button type="button" class="primary-danger-button" onclick={confirmReset}>
					{t('toolbar.resetConfirmConfirm')}
				</button>
			</div>
		</dialog>
	{/if}
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

	/* Fixed aspect-ratio (not just the <img>'s intrinsic size) so the card has
	   a real, predictable box — and the floating toolbar a stable anchor —
	   even before the image has loaded or if it never does (the CDN stalls
	   this app already has to guard against elsewhere, see the watchdog
	   below). */
	.image-card {
		--image-fit: contain;
		position: relative;
		width: 100%;
		aspect-ratio: 16 / 9;
		max-height: min(70vh, 720px);
		background: var(--color-background);
	}

	/* Floats over the bottom of the canvas instead of sitting in a bordered
	   strip below it, so the image reads as the workspace's main surface. */
	.toolbar {
		position: absolute;
		left: 50%;
		bottom: 0.875rem;
		transform: translateX(-50%);
		max-width: calc(100% - 1.5rem);
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.375rem;
		padding: 0.5rem 0.75rem;
		background: color-mix(in srgb, var(--color-surface) 88%, transparent);
		backdrop-filter: blur(10px);
		border: 1px solid var(--color-border);
		border-radius: 999px;
		box-shadow: var(--shadow-lg);
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
		color: var(--color-accent-text);
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

	/* An opaque chip (not just colored text) — the toolbar itself is a
	   translucent, blurred pill floating over the rendered photo, so danger-
	   colored text alone has no reliable contrast against whatever image is
	   behind it. No flex-basis: 100% here either: that forced the error onto
	   its own full-width line, breaking the toolbar out of its compact pill
	   shape instead of just adding one more inline item. */
	.toolbar-error {
		margin: 0;
		padding: 0.25rem 0.625rem;
		font-size: 0.8125rem;
		white-space: nowrap;
		color: var(--color-danger);
		background: var(--color-danger-bg);
		border-radius: 999px;
	}

	.footer {
		display: flex;
		align-items: center;
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

	.reset-confirm-dialog {
		width: min(100% - 2rem, 25rem);
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		max-width: none;
		margin: auto;
		padding: 1.25rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		background: var(--color-surface);
		box-shadow: var(--shadow-lg);
	}

	.reset-confirm-dialog::backdrop {
		background: rgb(29 29 31 / 0.32);
		backdrop-filter: blur(4px);
	}

	.reset-confirm-dialog h3 {
		margin: 0;
		color: var(--color-text);
		font-size: 1rem;
		font-weight: 650;
	}

	.reset-confirm-dialog p {
		margin: 0;
		color: var(--color-muted);
		font-size: 0.875rem;
		line-height: 1.4;
	}

	.reset-confirm-actions {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.5rem;
	}

	.secondary-button,
	.primary-danger-button {
		min-height: 2.5rem;
		padding: 0.625rem 0.75rem;
		border-radius: var(--radius-sm);
		font: inherit;
		font-size: 0.875rem;
		font-weight: 650;
		cursor: pointer;
		transition:
			background 0.15s,
			border-color 0.15s,
			color 0.15s;
	}

	.secondary-button {
		border: 1px solid var(--color-border);
		background: var(--color-surface);
		color: var(--color-text);
	}

	.secondary-button:hover {
		background: var(--color-surface-hover);
		border-color: var(--color-accent);
		color: var(--color-accent-text);
	}

	.primary-danger-button {
		border: 1px solid var(--color-danger);
		background: var(--color-danger);
		color: white;
	}

	.primary-danger-button:hover {
		background: color-mix(in srgb, var(--color-danger) 86%, black);
	}
</style>
