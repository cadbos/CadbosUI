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
		Maximize,
		Minimize,
		Move,
		RotateCcw,
		SquareSplitHorizontal
	} from '@lucide/svelte';
	import { onDestroy } from 'svelte';
	import { getToolsPanelTopBoundary } from '$lib/state/tools-panel.svelte';
	import { resolve } from '$app/paths';
	import { innerHeight, innerWidth } from 'svelte/reactivity/window';
	import { sceneView } from '$lib/state/scene-view.svelte';
	import { t } from '$lib/i18n/index.svelte';
	import { request } from '$lib/state/request.svelte';
	import { auth } from '$lib/state/auth.svelte';
	import { photoProcessing } from '$lib/state/photo-processing.svelte';
	import { mediaAccess } from '$lib/state/media-access.svelte';

	let { photoProcessingMode = false }: { photoProcessingMode?: boolean } = $props();
	let panel: HTMLDivElement;
	const topBoundary = getToolsPanelTopBoundary();
	const position = $derived(
		sceneView.fullscreen ? sceneView.fullscreenPosition : sceneView.position
	);
	function setPosition(value: { x: number; y: number } | null): void {
		if (sceneView.fullscreen) sceneView.fullscreenPosition = value;
		else sceneView.position = value;
	}
	onDestroy(() => {
		sceneView.comparing = false;
		sceneView.exit();
	});
	let panelWidth = $state(0);
	const panelHeight = $derived(sceneView.actionsHeight);
	const placed = $derived(
		position && {
			x: Math.max(0, Math.min(position.x, (innerWidth.current ?? 0) - panelWidth)),
			y: Math.max(topBoundary(), Math.min(position.y, (innerHeight.current ?? 0) - panelHeight))
		}
	);
	let drag: { x: number; y: number; originX: number; originY: number } | null = null;
	function startDrag(event: PointerEvent): void {
		if (event.button !== 0) return;
		const rect = panel.getBoundingClientRect();
		drag = { x: event.clientX, y: event.clientY, originX: rect.x, originY: rect.y };
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
	}
	function moveDrag(event: PointerEvent): void {
		if (!drag) return;
		setPosition({
			x: drag.originX + event.clientX - drag.x,
			y: drag.originY + event.clientY - drag.y
		});
	}
	function endDrag(): void {
		drag = null;
	}
	function moveByKeyboard(event: KeyboardEvent): void {
		const directions: Record<string, [number, number]> = {
			ArrowLeft: [-16, 0],
			ArrowRight: [16, 0],
			ArrowUp: [0, -16],
			ArrowDown: [0, 16]
		};
		const delta = directions[event.key];
		if (!delta) return;
		event.preventDefault();
		const rect = panel.getBoundingClientRect();
		setPosition({ x: rect.x + delta[0], y: rect.y + delta[1] });
	}
	function toggleFullscreen(event: MouseEvent): void {
		if (sceneView.fullscreen) sceneView.exit();
		else sceneView.enter(event.currentTarget as HTMLElement);
	}
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
		sceneView.exit();
		request.reset();
	}

	const render = $derived(request.currentRender);
	const downloadUrl = $derived(
		render && !(photoProcessingMode && photoProcessing.hasChanges)
			? resolve('/api/media/[bucket]/[...filename]', {
					bucket: render.outputKey.slice(0, render.outputKey.indexOf('/')),
					filename: render.outputKey.slice(render.outputKey.indexOf('/') + 1)
				})
			: undefined
	);

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

<div
	class={['toolbar', { detached: placed !== null, fullscreen: sceneView.fullscreen }]}
	{@attach (node) => {
		panel = node;
	}}
	bind:clientWidth={panelWidth}
	bind:clientHeight={sceneView.actionsHeight}
	style:left={placed ? `${placed.x}px` : undefined}
	style:top={placed ? `${placed.y}px` : undefined}
>
	<button
		type="button"
		class="icon-btn drag-handle"
		aria-label={t('toolbar.move')}
		title={t('toolbar.move')}
		onpointerdown={startDrag}
		onpointermove={moveDrag}
		onpointerup={endDrag}
		onpointercancel={endDrag}
		onkeydown={moveByKeyboard}><Move size={16} aria-hidden="true" /></button
	>
	<button
		type="button"
		class="icon-btn"
		aria-label={t('toolbar.resetPosition')}
		title={t('toolbar.resetPosition')}
		onclick={() => setPosition(null)}><RotateCcw size={16} aria-hidden="true" /></button
	>
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
			disabled={!photoProcessing.sourceUrl || photoProcessing.busy || photoProcessing.downloading}
			onclick={() => void photoProcessing.download()}
		>
			<Download size={16} strokeWidth={1.8} aria-hidden="true" />
		</button>
	{/if}
	<button
		type="button"
		class="icon-btn"
		disabled={(!photoProcessingMode && !render) ||
			photoProcessing.busy ||
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
		class={['icon-btn', { active: sceneView.comparing }]}
		disabled={!canCompare}
		aria-pressed={sceneView.comparing}
		aria-label={t('toolbar.compare')}
		title={t('toolbar.compare')}
		onclick={() => (sceneView.comparing = !sceneView.comparing)}
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
	<button
		type="button"
		class="icon-btn"
		aria-label={t(sceneView.fullscreen ? 'toolbar.exitFullscreen' : 'toolbar.fullscreen')}
		title={t(sceneView.fullscreen ? 'toolbar.exitFullscreen' : 'toolbar.fullscreen')}
		aria-pressed={sceneView.fullscreen}
		onclick={toggleFullscreen}
		>{#if sceneView.fullscreen}<Minimize size={16} aria-hidden="true" />{:else}<Maximize
				size={16}
				aria-hidden="true"
			/>{/if}</button
	>
</div>
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

<style>
	.toolbar {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.375rem;
		border: 1px solid var(--color-border);
		border-radius: 999px;
		background: var(--color-surface);
		box-shadow: var(--shadow-lg);
		flex-wrap: wrap;
		max-width: 100%;
		position: relative;
		z-index: 40;
	}
	.toolbar.detached {
		position: fixed;
	}
	.toolbar.fullscreen:not(.detached) {
		position: fixed;
		top: 1rem;
		left: 1rem;
		max-width: calc(100vw - 2rem);
	}
	.drag-handle {
		touch-action: none;
		cursor: move;
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

	.toolbar-error {
		margin: 0;
		padding: 0.25rem 0.625rem;
		font-size: 0.8125rem;
		white-space: nowrap;
		color: var(--color-danger);
		background: var(--color-danger-bg);
		border-radius: 999px;
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
