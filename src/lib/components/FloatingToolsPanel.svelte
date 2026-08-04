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
	import { ChevronDown, ChevronUp, Move, SlidersHorizontal } from '@lucide/svelte';
	import { browser } from '$app/environment';
	import { t } from '$lib/i18n/index.svelte';
	import {
		clampToolsPanelPosition,
		clampToolsPanelWidth,
		MIN_TOOLS_PANEL_WIDTH,
		toolsPanel,
		TOOLS_PANEL_WIDTH
	} from '$lib/state/tools-panel.svelte';

	interface Props {
		children: Snippet;
	}

	let { children }: Props = $props();

	const uid = $props.id();
	const bodyId = `${uid}-body`;

	let panel = $state<HTMLDivElement | null>(null);
	// Reactive mirrors of window.innerWidth / the panel's measured width, so
	// the resize handle's aria-value* attributes below re-render on resize
	// instead of reading the DOM directly inside the template.
	let viewportWidth = $state(browser ? window.innerWidth : TOOLS_PANEL_WIDTH);
	let measuredWidth = $state(TOOLS_PANEL_WIDTH);
	// The actual reachable maximum (clamped, unlike viewportWidth itself) —
	// shared by aria-valuemax and the End-key branch below so the announced
	// max always matches what End actually produces.
	let maxWidth = $derived(clampToolsPanelWidth(Number.MAX_SAFE_INTEGER, viewportWidth));

	function attachPanel(node: HTMLDivElement): void {
		panel = node;
		measuredWidth = node.getBoundingClientRect().width;
	}

	// A drag gesture and a click-to-toggle share the same bar: below the
	// threshold it's a click, at/above it the panel follows the pointer. This
	// avoids a second, redundant control just for toggling (which would also
	// double-fire on pointerup if the bar itself were a <button>).
	const DRAG_THRESHOLD_PX = 4;
	let drag: {
		pointerId: number;
		startX: number;
		startY: number;
		originX: number;
		originY: number;
		moved: boolean;
	} | null = null;

	function onBarPointerDown(event: PointerEvent): void {
		if (!panel || event.button !== 0) return;
		const bounds = panel.getBoundingClientRect();
		drag = {
			pointerId: event.pointerId,
			startX: event.clientX,
			startY: event.clientY,
			originX: bounds.left,
			originY: bounds.top,
			moved: false
		};
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
	}

	function onBarPointerMove(event: PointerEvent): void {
		if (!panel || !drag || drag.pointerId !== event.pointerId) return;
		const dx = event.clientX - drag.startX;
		const dy = event.clientY - drag.startY;
		if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
		drag.moved = true;
		const bounds = panel.getBoundingClientRect();
		const next = clampToolsPanelPosition(
			drag.originX + dx,
			drag.originY + dy,
			bounds.width,
			bounds.height,
			window.innerWidth,
			window.innerHeight
		);
		// Not persisted here — pointermove fires far too often to justify a
		// localStorage write on every event. The final position is persisted
		// once the drag ends, in endDrag below.
		toolsPanel.updatePosition(next.x, next.y);
	}

	function endDrag(event: PointerEvent): boolean {
		const target = event.currentTarget as HTMLElement;
		if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
		const wasDrag = drag?.moved ?? false;
		drag = null;
		if (wasDrag) toolsPanel.persist();
		return wasDrag;
	}

	function onBarPointerUp(event: PointerEvent): void {
		const wasDrag = endDrag(event);
		if (!wasDrag) toolsPanel.setOpen(!toolsPanel.open);
	}

	function onBarPointerCancel(event: PointerEvent): void {
		endDrag(event);
	}

	function onBarKeydown(event: KeyboardEvent): void {
		if (event.key !== 'Enter' && event.key !== ' ') return;
		event.preventDefault();
		toolsPanel.setOpen(!toolsPanel.open);
	}

	const RESIZE_STEP = 24;

	function clampWidth(value: number): number {
		return clampToolsPanelWidth(value, window.innerWidth);
	}

	let resizeStartX = 0;
	let resizeStartWidth = 0;

	function onResizeHandlePointerDown(event: PointerEvent): void {
		if (!panel) return;
		resizeStartX = event.clientX;
		resizeStartWidth = panel.getBoundingClientRect().width;
		measuredWidth = resizeStartWidth;
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
	}

	function onResizeHandlePointerMove(event: PointerEvent): void {
		const target = event.currentTarget as HTMLElement;
		if (!target.hasPointerCapture(event.pointerId)) return;
		const dx = event.clientX - resizeStartX;
		// At the default corner the panel is anchored to its right edge (CSS
		// `right: 1rem`) and grows leftward, so dragging the handle left widens
		// it. Once dragged to an explicit position it's anchored to its left
		// edge (`left: var(--tools-panel-x)`) and grows rightward instead, like
		// ScenesDrawer's drawer — so the sign flips.
		const delta = toolsPanel.position === null ? -dx : dx;
		const next = clampWidth(resizeStartWidth + delta);
		toolsPanel.updateWidth(next);
		measuredWidth = next;
	}

	function onResizeHandlePointerUp(event: PointerEvent): void {
		const target = event.currentTarget as HTMLElement;
		if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
		toolsPanel.persist();
	}

	function onResizeHandleKeydown(event: KeyboardEvent): void {
		const current = toolsPanel.width ?? measuredWidth;
		let next: number;
		if (event.key === 'ArrowLeft') next = current - RESIZE_STEP;
		else if (event.key === 'ArrowRight') next = current + RESIZE_STEP;
		else if (event.key === 'Home') next = MIN_TOOLS_PANEL_WIDTH;
		else if (event.key === 'End') next = maxWidth;
		else return;
		event.preventDefault();
		const clamped = clampWidth(next);
		toolsPanel.setWidth(clamped);
		measuredWidth = clamped;
	}

	// Re-clamps a previously dragged position/width after the viewport shrinks
	// (e.g. rotating a tablet) so the panel can't end up stranded off-screen or
	// wider than the viewport. A position/width that's still null (never
	// dragged/resized) is left alone — it's CSS-anchored and already tracks
	// the viewport on its own.
	//
	// Workspace.svelte mounts one FloatingToolsPanel per mode (render/edit/
	// styleTransfer) sharing this same `toolsPanel` singleton, with only the
	// active mode's instance actually visible — the others sit behind
	// `hidden` on an ancestor. A hidden element's getBoundingClientRect() is
	// all zeros, so without this guard every window resize would have the
	// *inactive* panels clamp the shared position/width against a 0×0 box and
	// stomp on whatever the visible panel just computed.
	function onWindowResize(): void {
		viewportWidth = window.innerWidth;
		if (!panel) return;
		const bounds = panel.getBoundingClientRect();
		if (bounds.width === 0 && bounds.height === 0) return;
		measuredWidth = bounds.width;
		if (toolsPanel.position) {
			const next = clampToolsPanelPosition(
				bounds.left,
				bounds.top,
				bounds.width,
				bounds.height,
				window.innerWidth,
				window.innerHeight
			);
			if (next.x !== toolsPanel.position.x || next.y !== toolsPanel.position.y) {
				toolsPanel.setPosition(next.x, next.y);
			}
		}
		if (toolsPanel.width !== null) {
			const clampedWidth = clampWidth(toolsPanel.width);
			if (clampedWidth !== toolsPanel.width) toolsPanel.setWidth(clampedWidth);
		}
	}

	$effect(() => {
		toolsPanel.hydrate();
		window.addEventListener('resize', onWindowResize);
		return () => window.removeEventListener('resize', onWindowResize);
	});
</script>

<div
	{@attach attachPanel}
	class="floating-tools-panel"
	class:at-default-corner={toolsPanel.position === null}
	style:--tools-panel-x={toolsPanel.position ? `${toolsPanel.position.x}px` : undefined}
	style:--tools-panel-y={toolsPanel.position ? `${toolsPanel.position.y}px` : undefined}
>
	<div
		class="panel-bar"
		role="button"
		tabindex="0"
		aria-expanded={toolsPanel.open}
		aria-controls={bodyId}
		aria-label={toolsPanel.open ? t('toolsPanel.collapse') : t('toolsPanel.expand')}
		onpointerdown={onBarPointerDown}
		onpointermove={onBarPointerMove}
		onpointerup={onBarPointerUp}
		onpointercancel={onBarPointerCancel}
		onkeydown={onBarKeydown}
	>
		<SlidersHorizontal size={16} strokeWidth={1.8} aria-hidden="true" />
		<span>{t('toolsPanel.title')}</span>
		<Move size={14} strokeWidth={1.8} aria-hidden="true" class="drag-icon" />
		{#if toolsPanel.open}
			<ChevronUp size={16} strokeWidth={1.8} aria-hidden="true" />
		{:else}
			<ChevronDown size={16} strokeWidth={1.8} aria-hidden="true" />
		{/if}
	</div>

	{#if toolsPanel.open}
		<div class="panel-body" id={bodyId}>
			{@render children()}
		</div>
	{/if}

	<div
		class="resize-handle"
		role="slider"
		aria-orientation="horizontal"
		aria-label={t('toolsPanel.resizeHandle')}
		aria-valuemin={MIN_TOOLS_PANEL_WIDTH}
		aria-valuemax={maxWidth}
		aria-valuenow={Math.round(toolsPanel.width ?? measuredWidth)}
		tabindex="0"
		onpointerdown={onResizeHandlePointerDown}
		onpointermove={onResizeHandlePointerMove}
		onpointerup={onResizeHandlePointerUp}
		onpointercancel={onResizeHandlePointerUp}
		onkeydown={onResizeHandleKeydown}
	></div>
</div>

<style>
	.floating-tools-panel {
		position: fixed;
		z-index: var(--z-tools-panel);
		width: var(--tools-panel-width);
		max-width: calc(100vw - 2rem);
		max-height: calc(100dvh - 2rem);
		display: flex;
		flex-direction: column;
	}

	.floating-tools-panel.at-default-corner {
		right: 1rem;
		/* Clears .workspace-topbar (~200px tall at desktop widths) plus a margin,
		   so the panel doesn't open on top of the mode switcher on first load. */
		top: 13.5rem;
		/* max-height above assumes a 1rem top offset; re-derive it here from the
		   real default-corner offset so the panel's bottom edge (and controls
		   like the generate button inside it) never falls below the viewport. */
		max-height: calc(100dvh - 13.5rem - 1rem);
	}

	/* Desktop-only: a dragged position is stored/applied as pixel coordinates,
	   which only make sense once the panel is `position: fixed` (see the
	   media query below, which drops it to a static, normal-flow block on
	   narrow screens). Scoping this to the same breakpoint — rather than
	   relying on the mobile rule to override it — means a stale dragged
	   position from a previous desktop session can't constrain the panel's
	   height on mobile, since the custom properties driving it simply don't
	   apply outside this query. */
	@media (min-width: 901px) {
		.floating-tools-panel:not(.at-default-corner) {
			left: var(--tools-panel-x);
			top: var(--tools-panel-y);
			max-height: calc(100dvh - var(--tools-panel-y) - 1rem);
		}
	}

	.panel-bar {
		flex: 0 0 auto;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.625rem 0.75rem;
		background: var(--color-surface);
		border: 1.5px solid var(--color-border);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow);
		color: var(--color-text);
		font-size: 0.8125rem;
		font-weight: 650;
		cursor: grab;
		touch-action: none;
		user-select: none;
	}

	.panel-bar:active {
		cursor: grabbing;
	}

	.panel-bar:focus-visible {
		outline: 2px solid var(--color-accent);
		outline-offset: 2px;
	}

	.panel-bar span {
		flex: 1 1 auto;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.panel-body {
		flex: 1 1 auto;
		min-height: 0;
		margin-top: 0.5rem;
		overflow-y: auto;
	}

	.resize-handle {
		position: absolute;
		top: 0;
		bottom: 0;
		right: 0;
		width: 8px;
		cursor: ew-resize;
		touch-action: none;
	}

	.resize-handle:focus-visible {
		outline: 2px solid var(--color-accent);
		outline-offset: -2px;
		border-radius: var(--radius-sm);
	}

	@media (max-width: 900px) {
		.floating-tools-panel {
			position: static;
			width: 100%;
			max-width: 100%;
			max-height: none;
		}

		.panel-bar {
			cursor: default;
			touch-action: auto;
		}

		.panel-bar :global(.drag-icon) {
			display: none;
		}

		.resize-handle {
			display: none;
		}
	}
</style>
