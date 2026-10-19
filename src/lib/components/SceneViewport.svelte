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
	import type { Snippet } from 'svelte';
	import { Hand, ZoomIn, ZoomOut } from '@lucide/svelte';
	import { t } from '$lib/i18n/index.svelte';
	import { sceneView } from '$lib/state/scene-view.svelte';

	interface Props {
		children: Snippet<[{ width: number; height: number }]>;
		source?: string;
		imageRatio?: number;
		interactive?: boolean;
		enabled?: boolean;
		reserveControls?: boolean;
	}
	let {
		children,
		source,
		imageRatio,
		interactive = false,
		enabled = true,
		reserveControls = false
	}: Props = $props();
	let viewport: HTMLDivElement | null = null;
	let panButton: HTMLButtonElement | null = null;
	let width = $state(0);
	let height = $state(0);
	let controlsHeight = $state(40);
	const contentHeight = $derived(Math.max(0, height - (reserveControls ? controlsHeight + 8 : 0)));
	let spacePressed = $state(false);
	let panMode = $state(false);
	let dragging = $state(false);
	let spaceDrag = false;
	let drag: { pointerId: number; x: number; y: number; originX: number; originY: number } | null =
		null;
	const scale = $derived(sceneView.zoom / 100);
	const ratio = $derived(
		imageRatio && imageRatio > 0 ? imageRatio : width / Math.max(1, contentHeight)
	);
	const fitWidth = $derived(Math.min(width, contentHeight * ratio));
	const fitHeight = $derived(fitWidth / ratio);
	const limitX = $derived(Math.max(0, (fitWidth * scale - width) / 2));
	const limitY = $derived(Math.max(0, (fitHeight * scale - contentHeight) / 2));
	const panX = $derived(Math.max(-limitX, Math.min(sceneView.panX, limitX)));
	const panY = $derived(Math.max(-limitY, Math.min(sceneView.panY, limitY)));
	const hintId = $props.id();

	function attachViewport(node: HTMLDivElement): () => void {
		viewport = node;
		sceneView.showSource(source);
		return () => {
			viewport = null;
		};
	}

	function pan(x: number, y: number): void {
		sceneView.panX = Math.max(-limitX, Math.min(x, limitX));
		sceneView.panY = Math.max(-limitY, Math.min(y, limitY));
	}

	function startPan(event: PointerEvent): void {
		if ((event.target as Element).closest('.zoom-controls, input, select, textarea, a')) return;
		if (event.button !== 1 && (event.button !== 0 || (interactive && !spacePressed && !panMode)))
			return;
		event.preventDefault();
		event.stopImmediatePropagation();
		const host = event.currentTarget as HTMLElement;
		drag = {
			pointerId: event.pointerId,
			x: event.clientX,
			y: event.clientY,
			originX: panX,
			originY: panY
		};
		dragging = true;
		spaceDrag = spacePressed;
		host.setPointerCapture(event.pointerId);
		panButton?.focus({ preventScroll: true });
	}

	function movePan(event: PointerEvent): void {
		if (!drag || drag.pointerId !== event.pointerId) return;
		event.preventDefault();
		event.stopImmediatePropagation();
		pan(drag.originX + event.clientX - drag.x, drag.originY + event.clientY - drag.y);
	}

	function endPan(event: PointerEvent): void {
		if (!drag || drag.pointerId !== event.pointerId) return;
		event.preventDefault();
		event.stopImmediatePropagation();
		drag = null;
		dragging = false;
		const host = event.currentTarget as HTMLElement;
		if (host.hasPointerCapture(event.pointerId)) host.releasePointerCapture(event.pointerId);
	}

	function releaseSpace(event: KeyboardEvent): void {
		if (event.code !== 'Space') return;
		if (spaceDrag) event.preventDefault();
		spaceDrag = false;
		spacePressed = false;
	}

	function pressSpace(event: KeyboardEvent): void {
		if (!viewport || viewport.getBoundingClientRect().width === 0 || event.code !== 'Space') return;
		const target = event.target;
		if (
			target instanceof Element &&
			target.closest('input:not([type=range]), select, textarea, [contenteditable="true"]')
		)
			return;
		spacePressed = true;
		if (!(target instanceof Element) || !target.closest('button, a, input')) event.preventDefault();
	}

	function keys(event: KeyboardEvent): void {
		const delta: Record<string, [number, number]> = {
			ArrowLeft: [-32, 0],
			ArrowRight: [32, 0],
			ArrowUp: [0, -32],
			ArrowDown: [0, 32]
		};
		if (delta[event.key]) {
			event.preventDefault();
			pan(panX + delta[event.key][0], panY + delta[event.key][1]);
		} else if (event.key === 'Home') {
			event.preventDefault();
			sceneView.setZoom(100);
		}
	}

	function lostPan(): void {
		dragging = false;
		drag = null;
	}
	function clearGesture(): void {
		spacePressed = false;
		lostPan();
	}
</script>

<svelte:window onkeydown={pressSpace} onkeyup={releaseSpace} onblur={clearGesture} />

{#if enabled}
	<div
		class={['scene-viewport', { panning: dragging || spacePressed || panMode }]}
		role="group"
		aria-label={t('scene.pan')}
		aria-describedby={hintId}
		bind:clientWidth={width}
		bind:clientHeight={height}
		{@attach attachViewport}
		onpointerdowncapture={startPan}
		onpointermovecapture={movePan}
		onpointerupcapture={endPan}
		onpointercancelcapture={endPan}
		onlostpointercapture={lostPan}
	>
		<div class="scene-window" style:height={`${contentHeight}px`}>
			<div class="scene-plane" style:transform={`translate(${panX}px, ${panY}px) scale(${scale})`}>
				{@render children({ width, height: contentHeight })}
			</div>
		</div>
		<span id={hintId} class="visually-hidden">{t('scene.panHint')}</span>
		<div
			class="zoom-controls"
			bind:offsetHeight={controlsHeight}
			role="group"
			aria-label={t('scene.zoom')}
		>
			<button
				type="button"
				aria-label={t('scene.zoomOut')}
				title={t('scene.zoomOut')}
				disabled={sceneView.zoom <= 25}
				onclick={() => sceneView.setZoom(sceneView.zoom - 25)}
				><ZoomOut size={16} aria-hidden="true" /></button
			>
			<input
				type="range"
				min="25"
				max="400"
				step="25"
				value={sceneView.zoom}
				aria-label={t('scene.zoom')}
				aria-valuetext={`${sceneView.zoom}%`}
				oninput={(event) => sceneView.setZoom(event.currentTarget.valueAsNumber)}
			/>
			<button
				type="button"
				aria-label={t('scene.zoomIn')}
				title={t('scene.zoomIn')}
				disabled={sceneView.zoom >= 400}
				onclick={() => sceneView.setZoom(sceneView.zoom + 25)}
				><ZoomIn size={16} aria-hidden="true" /></button
			>
			<button
				type="button"
				class="percent"
				aria-label={t('scene.fit')}
				title={t('scene.fit')}
				onclick={() => sceneView.setZoom(100)}>{sceneView.zoom}%</button
			>
			<button
				type="button"
				{@attach (node) => {
					panButton = node;
					return () => {
						panButton = null;
					};
				}}
				onkeydown={keys}
				aria-label={t('scene.panMode')}
				title={t('scene.panMode')}
				aria-pressed={panMode}
				onclick={() => (panMode = !panMode)}><Hand size={16} aria-hidden="true" /></button
			>
		</div>
	</div>
{:else}
	{@render children({ width: 0, height: 0 })}
{/if}

<style>
	.scene-viewport {
		position: relative;
		width: 100%;
		height: 100%;
		min-height: 0;
		min-width: 0;
		overflow: hidden;
		touch-action: none;
	}
	.scene-viewport:focus-visible {
		outline: 2px solid var(--color-accent);
		outline-offset: -2px;
	}
	.scene-window {
		width: 100%;
		overflow: hidden;
		position: relative;
	}
	.scene-plane {
		position: relative;
		display: grid;
		place-items: center;
		width: 100%;
		height: 100%;
		transform-origin: center;
	}
	.scene-viewport.panning {
		cursor: grab;
	}
	.scene-viewport.panning:active {
		cursor: grabbing;
	}
	.zoom-controls {
		z-index: 36;
		position: absolute;
		right: 0.5rem;
		bottom: 0.5rem;
		max-width: calc(100% - 1rem);
		display: flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.25rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		background: var(--color-surface);
		box-shadow: var(--shadow-sm);
	}
	.zoom-controls button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex: 0 0 auto;
		width: 2rem;
		height: 2rem;
		padding: 0;
		border: none;
		border-radius: var(--radius-sm);
		color: var(--color-text);
		background: transparent;
		cursor: pointer;
	}
	.zoom-controls button:hover,
	.zoom-controls button[aria-pressed='true'] {
		background: var(--color-surface-hover);
		color: var(--color-accent-text);
	}
	.zoom-controls button:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
	.zoom-controls button:focus-visible,
	.zoom-controls input:focus-visible {
		outline: 2px solid var(--color-accent);
		outline-offset: 1px;
	}
	.zoom-controls .percent {
		width: 3rem;
		font-size: 0.75rem;
		font-variant-numeric: tabular-nums;
	}
	.zoom-controls input {
		width: 6rem;
		min-width: 1.5rem;
		flex: 1 1 6rem;
		accent-color: var(--color-accent);
	}
</style>
