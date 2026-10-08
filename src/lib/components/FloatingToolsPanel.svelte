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
	import { onMount, type Snippet } from 'svelte';
	import { innerHeight, innerWidth } from 'svelte/reactivity/window';
	import { ChevronDown, ChevronUp, Move, MoveHorizontal, SlidersHorizontal } from '@lucide/svelte';
	import { t } from '$lib/i18n/index.svelte';
	import {
		clampToolsPanelPosition,
		clampToolsPanelWidth,
		getToolsPanelTopBoundary,
		MIN_TOOLS_PANEL_WIDTH,
		nextToolsPanelSizePreset,
		toolsPanel,
		TOOLS_PANEL_WIDTH
	} from '$lib/state/tools-panel.svelte';

	interface Props {
		active: boolean;
		children: Snippet;
		header: Snippet;
	}

	let { active, children, header }: Props = $props();

	const topBoundary = getToolsPanelTopBoundary();
	const uid = $props.id();
	const bodyId = `${uid}-body`;

	let panelWidth = $state(TOOLS_PANEL_WIDTH);
	let panelHeight = $state(0);
	// The actual reachable maximum — shared by aria-valuemax and the End-key
	// branch below so the announced max always matches what End produces.
	let maxWidth = $derived(
		clampToolsPanelWidth(
			Number.MAX_SAFE_INTEGER,
			innerWidth.current ?? TOOLS_PANEL_WIDTH,
			toolsPanel.position?.x ?? 0
		)
	);

	// Where the panel is actually drawn: the user's chosen position, kept
	// inside the current viewport and below the app header. Derived rather
	// than written back into the store, so the chosen position survives
	// transient constraints — a panel pushed down by the health warning
	// returns to where the user put it once the warning is gone — and a
	// position persisted under the header by an earlier session is rendered
	// correctly without rewriting it. null = CSS-anchored default corner.
	let position = $derived.by(() => {
		const chosen = toolsPanel.position;
		if (chosen === null || innerWidth.current === undefined || innerHeight.current === undefined) {
			return chosen;
		}
		return clampToolsPanelPosition(
			chosen.x,
			chosen.y,
			panelWidth,
			panelHeight,
			innerWidth.current,
			innerHeight.current,
			topBoundary()
		);
	});

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
		if (event.button !== 0 || (event.target as HTMLElement).closest('button')) return;
		// The default corner is CSS-anchored, so its origin is only known from
		// the rendered box — the bar's, which sits at the panel's top-left.
		const origin = position ?? (event.currentTarget as HTMLElement).getBoundingClientRect();
		drag = {
			pointerId: event.pointerId,
			startX: event.clientX,
			startY: event.clientY,
			originX: origin.x,
			originY: origin.y,
			moved: false
		};
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
	}

	function onBarPointerMove(event: PointerEvent): void {
		if (!drag || drag.pointerId !== event.pointerId) return;
		const dx = event.clientX - drag.startX;
		const dy = event.clientY - drag.startY;
		if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
		drag.moved = true;
		const next = clampToolsPanelPosition(
			drag.originX + dx,
			drag.originY + dy,
			panelWidth,
			panelHeight,
			window.innerWidth,
			window.innerHeight,
			topBoundary()
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
		endDrag(event);
	}

	function onBarPointerCancel(event: PointerEvent): void {
		endDrag(event);
	}

	const RESIZE_STEP = 24;

	function clampWidth(value: number): number {
		return clampToolsPanelWidth(value, window.innerWidth, toolsPanel.position?.x ?? 0);
	}

	function cycleSizePreset(): void {
		const current = toolsPanel.width ?? panelWidth;
		toolsPanel.setWidth(clampWidth(nextToolsPanelSizePreset(current, window.innerWidth)));
	}

	let resizeStartX = 0;
	let resizeStartWidth = 0;

	function onResizeHandlePointerDown(event: PointerEvent): void {
		resizeStartX = event.clientX;
		resizeStartWidth = panelWidth;
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
		toolsPanel.updateWidth(clampWidth(resizeStartWidth + delta));
	}

	function onResizeHandlePointerUp(event: PointerEvent): void {
		const target = event.currentTarget as HTMLElement;
		if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
		toolsPanel.persist();
	}

	function onResizeHandleKeydown(event: KeyboardEvent): void {
		// The stored width updates synchronously, unlike the measured one (a
		// ResizeObserver lags a frame behind), so held-down arrow keys can't
		// step from a stale value.
		const current = toolsPanel.width ?? panelWidth;
		let next: number;
		if (event.key === 'ArrowLeft') next = current - RESIZE_STEP;
		else if (event.key === 'ArrowRight') next = current + RESIZE_STEP;
		else if (event.key === 'Home') next = MIN_TOOLS_PANEL_WIDTH;
		else if (event.key === 'End') next = maxWidth;
		else return;
		event.preventDefault();
		toolsPanel.setWidth(clampWidth(next));
	}

	onMount(() => {
		toolsPanel.hydrate();
	});
</script>

<div
	class="floating-tools-panel"
	class:at-default-corner={position === null}
	style:--tools-panel-x={position ? `${position.x}px` : undefined}
	style:--tools-panel-y={position ? `${position.y}px` : undefined}
	bind:offsetWidth={panelWidth}
	bind:offsetHeight={panelHeight}
>
	<div
		class="panel-bar"
		role="group"
		aria-label={t('toolsPanel.title')}
		onpointerdown={onBarPointerDown}
		onpointermove={onBarPointerMove}
		onpointerup={onBarPointerUp}
		onpointercancel={onBarPointerCancel}
	>
		<div class="panel-title" title={t('toolsPanel.title')}>
			<SlidersHorizontal size={16} strokeWidth={1.8} aria-hidden="true" />
			<span class="panel-title-label">{t('toolsPanel.title')}</span>
		</div>
		{#if active}
			<div class="panel-header-content">
				{@render header()}
			</div>
		{/if}
		<button
			type="button"
			class="panel-toggle size-preset"
			aria-label={t('toolsPanel.sizePreset')}
			title={t('toolsPanel.sizePreset')}
			onclick={cycleSizePreset}
		>
			<MoveHorizontal size={16} strokeWidth={1.8} aria-hidden="true" />
		</button>
		<Move size={14} strokeWidth={1.8} aria-hidden="true" class="drag-icon" />
		<button
			type="button"
			class="panel-toggle"
			aria-expanded={toolsPanel.open}
			aria-controls={bodyId}
			aria-label={toolsPanel.open ? t('toolsPanel.collapse') : t('toolsPanel.expand')}
			onclick={() => toolsPanel.setOpen(!toolsPanel.open)}
		>
			{#if toolsPanel.open}
				<ChevronUp size={16} strokeWidth={1.8} aria-hidden="true" />
			{:else}
				<ChevronDown size={16} strokeWidth={1.8} aria-hidden="true" />
			{/if}
		</button>
	</div>

	<div class="panel-body" id={bodyId} hidden={!toolsPanel.open}>
		{@render children()}
	</div>

	<div
		class="resize-handle"
		role="slider"
		aria-orientation="horizontal"
		aria-label={t('toolsPanel.resizeHandle')}
		aria-valuemin={MIN_TOOLS_PANEL_WIDTH}
		aria-valuemax={maxWidth}
		aria-valuenow={Math.round(panelWidth)}
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
		max-width: 100vw;
		max-height: calc(100dvh - 2rem);
		display: flex;
		flex-direction: column;
		container: tools-panel / inline-size;
	}

	.floating-tools-panel.at-default-corner {
		right: max(0px, min(1rem, calc(100vw - var(--tools-panel-width))));
		/* Anchored just below the workspace header (topbar, plus the project
		   tab bar row whenever one is open) rather than a fixed height — the
		   header's real height varies with that tab bar, so Workspace.svelte
		   measures it live and publishes the bottom edge as
		   --workspace-header-bottom on .workspace-main. 13.5rem (the header's
		   typical height with no tab bar, plus a margin) is only the fallback
		   for the instant before that measurement effect has run. */
		top: calc(var(--workspace-header-bottom, 13.5rem) + 1rem);
		max-height: calc(100dvh - var(--workspace-header-bottom, 13.5rem) - 2rem);
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
		padding: 0.5rem 0.75rem;
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

	.panel-title {
		flex: 0 0 auto;
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.875rem;
		font-weight: 650;
	}

	.panel-title :global(svg) {
		flex: 0 0 auto;
		width: 16px;
		height: 16px;
	}

	.panel-title-label {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	@container tools-panel (max-width: 600px) {
		.panel-title-label {
			display: none;
		}
	}

	.panel-bar :global(.drag-icon) {
		flex: 0 0 auto;
		width: 14px;
		height: 14px;
	}

	.panel-header-content {
		flex: 1 1 auto;
		min-width: 0;
	}

	.panel-toggle {
		flex: 0 0 auto;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.75rem;
		height: 1.75rem;
		padding: 0;
		border: 0;
		border-radius: var(--radius-sm);
		background: transparent;
		color: inherit;
		cursor: pointer;
	}

	.panel-toggle:hover {
		background: var(--color-surface-hover);
	}

	.panel-toggle:focus-visible {
		outline: 2px solid var(--color-accent);
		outline-offset: 1px;
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

		.panel-bar :global(.drag-icon),
		.size-preset {
			display: none;
		}

		.resize-handle {
			display: none;
		}
	}
</style>
