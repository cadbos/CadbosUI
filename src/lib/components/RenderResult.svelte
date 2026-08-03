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
	import { Download, ImagePlus, Redo, Sparkles, SquareSplitHorizontal, Undo } from '@lucide/svelte';
	import CompareSlider from '$lib/components/CompareSlider.svelte';
	import { t, ti } from '$lib/i18n/index.svelte';
	import { request, renderResultFromResponse } from '$lib/state/request.svelte';
	import { auth } from '$lib/state/auth.svelte';
	import { generatedImages } from '$lib/state/generated-images.svelte';
	import { generationOverlay } from '$lib/state/generation-overlay.svelte';
	import { formatCredit } from '$lib/utils';

	let comparing = $state(false);
	let upscaling = $state(false);
	let upscaleError = $state<string | null>(null);
	let resetConfirmOpen = $state(false);

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
	const imageUrl = $derived(render?.outputUrls[0]);
	// Falls back to the originally uploaded room photo when there's no prior
	// edit yet, so comparing is available right after the very first
	// generation, not only once an edit chain exists.
	const beforeImageUrl = $derived(request.previousRender?.outputUrls[0] ?? request.image?.url);
	const canCompare = $derived(beforeImageUrl !== undefined);
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

	// The archAI CDN occasionally stalls mid-transfer: the connection never
	// errors and never completes, so the <img> just hangs with no onload and
	// no onerror. This watchdog force-reloads via a cache-busted URL if load
	// hasn't fired within STALL_TIMEOUT_MS, capped at MAX_STALL_RETRIES.
	const STALL_TIMEOUT_MS = 20_000;
	const MAX_STALL_RETRIES = 2;

	function withRetryParam(url: string, attempt: number): string {
		const separator = url.includes('?') ? '&' : '?';
		return `${url}${separator}retry=${attempt}`;
	}

	// `active` gates whether the watchdog should be armed at all — the before
	// image only actually renders (and can stall) while the compare slider is
	// open, so arming its timer regardless would reload/retry an <img> that
	// isn't even in the DOM.
	function createStallWatchdog(
		getUrl: () => string | undefined,
		active: () => boolean = () => true
	) {
		let src = $state<string | undefined>(undefined);
		let clearTimer = () => {};

		$effect(() => {
			const url = getUrl();
			src = url;
			clearTimer = () => {};
			if (!url || !active()) return;

			let attempt = 0;
			let timer: ReturnType<typeof setTimeout>;
			const arm = () => {
				timer = setTimeout(() => {
					attempt += 1;
					src = withRetryParam(url, attempt);
					if (attempt < MAX_STALL_RETRIES) arm();
				}, STALL_TIMEOUT_MS);
			};
			arm();
			clearTimer = () => clearTimeout(timer);

			return () => clearTimeout(timer);
		});

		return {
			get src() {
				return src;
			},
			onload: () => clearTimer()
		};
	}

	const imageWatchdog = createStallWatchdog(() => imageUrl);
	const beforeImageWatchdog = createStallWatchdog(
		() => beforeImageUrl,
		() => comparing
	);

	async function upscale(): Promise<void> {
		if (!render || upscaling || !isAuthenticated) return;
		// Snapshot the render being upscaled — request.currentRender can move on
		// (undo/redo, a new edit) while this call is in flight, and the response
		// must still attach to the chain it was actually requested against.
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
			request.applyEditResult(newRender);
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
	<section class="result">
		<div class="image-card">
			{#if comparing && beforeImageUrl}
				<CompareSlider
					beforeSrc={beforeImageWatchdog.src}
					afterSrc={imageWatchdog.src}
					beforeAlt={t('toolbar.before')}
					afterAlt={t('toolbar.after')}
					handleLabel={t('toolbar.compare')}
					onBeforeLoad={beforeImageWatchdog.onload}
					onAfterLoad={imageWatchdog.onload}
				/>
			{:else}
				<img
					src={imageWatchdog.src}
					alt={t('render.generate')}
					class="output"
					onload={imageWatchdog.onload}
				/>
			{/if}

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

				<span class="toolbar-sep" aria-hidden="true"></span>

				<button
					type="button"
					class="icon-btn"
					aria-label={t('toolbar.reset')}
					title={t('toolbar.reset')}
					onclick={requestReset}
				>
					<ImagePlus size={16} strokeWidth={1.8} aria-hidden="true" />
				</button>

				{#if upscaleError}
					<p class="toolbar-error" role="alert">{upscaleError}</p>
				{/if}
			</div>
		</div>

		<div class="footer">
			<div class="meta">
				<span>{ti('render.cost', { cost: formatCredit(render.cost) })}</span>
				<span class="sep">·</span>
				<span>{ti('render.balance', { balance: formatCredit(render.balance) })}</span>
			</div>
		</div>
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
		position: relative;
		width: 100%;
		aspect-ratio: 16 / 9;
		max-height: min(70vh, 720px);
		background: var(--color-background);
	}

	.output {
		width: 100%;
		height: 100%;
		object-fit: contain;
		display: block;
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
		color: var(--color-accent);
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
