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
	import { Move, SlidersHorizontal, X } from '@lucide/svelte';
	import { t } from '$lib/i18n/index.svelte';
	import { clampToolsPanelPosition, toolsPanel } from '$lib/state/tools-panel.svelte';

	interface Props {
		children: Snippet;
	}

	let { children }: Props = $props();

	const uid = $props.id();
	const bodyId = `${uid}-body`;

	let panel = $state<HTMLDivElement | null>(null);

	function attachPanel(node: HTMLDivElement): void {
		panel = node;
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
		toolsPanel.setPosition(next.x, next.y);
	}

	function endDrag(event: PointerEvent): boolean {
		const target = event.currentTarget as HTMLElement;
		if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
		const wasDrag = drag?.moved ?? false;
		drag = null;
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

	// Re-clamps a previously dragged position after the viewport shrinks (e.g.
	// rotating a tablet) so the panel can't end up stranded off-screen. A
	// position that's still null (never dragged) is left alone — it's
	// CSS-anchored to the default corner and already tracks the viewport.
	function onWindowResize(): void {
		if (!panel || !toolsPanel.position) return;
		const bounds = panel.getBoundingClientRect();
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

	$effect(() => {
		window.addEventListener('resize', onWindowResize);
		return () => window.removeEventListener('resize', onWindowResize);
	});
</script>

<div
	{@attach attachPanel}
	class="floating-tools-panel"
	class:at-default-corner={toolsPanel.position === null}
	style:left={toolsPanel.position ? `${toolsPanel.position.x}px` : undefined}
	style:top={toolsPanel.position ? `${toolsPanel.position.y}px` : undefined}
	style:max-height={toolsPanel.position
		? `calc(100dvh - ${toolsPanel.position.y}px - 1rem)`
		: undefined}
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
		<Move size={14} strokeWidth={1.8} aria-hidden="true" class="drag-icon" />
		<span>{t('toolsPanel.title')}</span>
		{#if toolsPanel.open}
			<X size={16} strokeWidth={1.8} aria-hidden="true" />
		{:else}
			<SlidersHorizontal size={16} strokeWidth={1.8} aria-hidden="true" />
		{/if}
	</div>

	{#if toolsPanel.open}
		<div class="panel-body" id={bodyId}>
			{@render children()}
		</div>
	{/if}
</div>

<style>
	.floating-tools-panel {
		position: fixed;
		z-index: var(--z-tools-panel);
		width: 360px;
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
	}
</style>
