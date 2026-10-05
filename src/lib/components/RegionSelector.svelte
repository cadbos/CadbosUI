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
	import { t } from '$lib/i18n/index.svelte';
	import { REPAINT_REGION_MIN_SIZE, type RepaintRegion } from '$lib/repaint-region';

	interface Props {
		region: RepaintRegion | null;
		// The picture's own size: the layer fits itself to the part of its
		// container the (letterboxed) picture occupies, so the region's fractions
		// are fractions of the picture, not of the container.
		naturalWidth: number;
		naturalHeight: number;
		onchange: (region: RepaintRegion | null) => void;
	}

	type Corner = 'nw' | 'ne' | 'sw' | 'se';
	type Gesture =
		| { kind: 'draw'; startX: number; startY: number }
		| { kind: 'move'; offsetX: number; offsetY: number; origin: RepaintRegion }
		| { kind: 'resize'; corner: Corner; origin: RepaintRegion };
	interface Point {
		x: number;
		y: number;
	}

	const CORNERS: readonly Corner[] = ['nw', 'ne', 'sw', 'se'];
	const KEY_STEP = 0.01;

	let { region, naturalWidth, naturalHeight, onchange }: Props = $props();
	let surface: HTMLDivElement | null = null;
	let draft = $state<RepaintRegion | null>(null);
	let gesture: Gesture | null = null;

	const shown = $derived(draft ?? region);
	const ratio = $derived(naturalWidth / naturalHeight);

	function attachSurface(node: HTMLDivElement): () => void {
		surface = node;
		return () => {
			surface = null;
		};
	}

	function clamp(value: number, min: number, max: number): number {
		return Math.min(Math.max(value, min), max);
	}

	function pointFor(event: PointerEvent): Point | null {
		if (!surface) return null;
		const bounds = surface.getBoundingClientRect();
		if (bounds.width === 0 || bounds.height === 0) return null;
		return {
			x: clamp((event.clientX - bounds.left) / bounds.width, 0, 1),
			y: clamp((event.clientY - bounds.top) / bounds.height, 0, 1)
		};
	}

	function between(a: Point, b: Point): RepaintRegion {
		return {
			x: Math.min(a.x, b.x),
			y: Math.min(a.y, b.y),
			width: Math.abs(a.x - b.x),
			height: Math.abs(a.y - b.y)
		};
	}

	// Keeps a side no shorter than the minimum by growing it within [0, 1].
	function span(start: number, length: number): [number, number] {
		if (length >= REPAINT_REGION_MIN_SIZE) return [start, length];
		const grown = Math.min(start, 1 - REPAINT_REGION_MIN_SIZE);
		return [grown, REPAINT_REGION_MIN_SIZE];
	}

	function opposite(origin: RepaintRegion, corner: Corner): Point {
		return {
			x: corner === 'nw' || corner === 'sw' ? origin.x + origin.width : origin.x,
			y: corner === 'nw' || corner === 'ne' ? origin.y + origin.height : origin.y
		};
	}

	function begin(event: PointerEvent, next: Gesture): void {
		if (!surface || event.button !== 0) return;
		event.stopPropagation();
		gesture = next;
		surface.setPointerCapture(event.pointerId);
	}

	function startDraw(event: PointerEvent): void {
		const point = pointFor(event);
		if (!point) return;
		begin(event, { kind: 'draw', startX: point.x, startY: point.y });
	}

	function startMove(event: PointerEvent): void {
		const point = pointFor(event);
		if (!point || !region) return;
		begin(event, {
			kind: 'move',
			offsetX: point.x - region.x,
			offsetY: point.y - region.y,
			origin: region
		});
	}

	function startResize(event: PointerEvent, corner: Corner): void {
		if (!region) return;
		begin(event, { kind: 'resize', corner, origin: region });
	}

	function track(event: PointerEvent): void {
		const point = pointFor(event);
		if (!gesture || !point) return;
		if (gesture.kind === 'draw') {
			draft = between({ x: gesture.startX, y: gesture.startY }, point);
		} else if (gesture.kind === 'move') {
			const { origin, offsetX, offsetY } = gesture;
			draft = {
				...origin,
				x: clamp(point.x - offsetX, 0, 1 - origin.width),
				y: clamp(point.y - offsetY, 0, 1 - origin.height)
			};
		} else {
			const box = between(opposite(gesture.origin, gesture.corner), point);
			const [x, width] = span(box.x, box.width);
			const [y, height] = span(box.y, box.height);
			draft = { x, y, width, height };
		}
	}

	function finish(): void {
		const finished = draft;
		draft = null;
		gesture = null;
		if (
			finished &&
			finished.width >= REPAINT_REGION_MIN_SIZE &&
			finished.height >= REPAINT_REGION_MIN_SIZE
		) {
			onchange(finished);
		}
	}

	function cancel(): void {
		draft = null;
		gesture = null;
	}

	function keydown(event: KeyboardEvent): void {
		if (!region) return;
		if (event.key === 'Delete' || event.key === 'Backspace') {
			event.preventDefault();
			onchange(null);
			return;
		}
		const dx = event.key === 'ArrowRight' ? KEY_STEP : event.key === 'ArrowLeft' ? -KEY_STEP : 0;
		const dy = event.key === 'ArrowDown' ? KEY_STEP : event.key === 'ArrowUp' ? -KEY_STEP : 0;
		if (dx === 0 && dy === 0) return;
		event.preventDefault();
		if (event.shiftKey) {
			onchange({
				...region,
				width: clamp(region.width + dx, REPAINT_REGION_MIN_SIZE, 1 - region.x),
				height: clamp(region.height + dy, REPAINT_REGION_MIN_SIZE, 1 - region.y)
			});
		} else {
			onchange({
				...region,
				x: clamp(region.x + dx, 0, 1 - region.width),
				y: clamp(region.y + dy, 0, 1 - region.height)
			});
		}
	}
</script>

<div class="layer">
	<div
		class="surface"
		style:--ratio={ratio}
		{@attach attachSurface}
		role="presentation"
		onpointerdown={startDraw}
		onpointermove={track}
		onpointerup={finish}
		onpointercancel={cancel}
	>
		{#if shown}
			<button
				type="button"
				class="box"
				class:drafting={draft !== null}
				style:left="{shown.x * 100}%"
				style:top="{shown.y * 100}%"
				style:width="{shown.width * 100}%"
				style:height="{shown.height * 100}%"
				aria-label={t('repaint.region.boxLabel')}
				onpointerdown={startMove}
				onkeydown={keydown}
			>
				{#each CORNERS as corner (corner)}
					<span
						class="handle {corner}"
						aria-hidden="true"
						onpointerdown={(event) => startResize(event, corner)}
					></span>
				{/each}
			</button>
		{/if}
	</div>
</div>

<style>
	/* Covers the container; as a size container it lets the surface be sized
	   from the container's own width and height. */
	.layer {
		position: absolute;
		inset: 0;
		container-type: size;
		display: grid;
		place-items: center;
		pointer-events: none;
	}

	.surface {
		position: relative;
		width: min(100cqw, calc(100cqh * var(--ratio)));
		aspect-ratio: var(--ratio);
		overflow: hidden;
		cursor: crosshair;
		touch-action: none;
		pointer-events: auto;
	}

	/* The shadow dims everything outside the box; the surface clips it. */
	.box {
		position: absolute;
		box-sizing: border-box;
		padding: 0;
		background: transparent;
		border: 2px solid var(--color-accent);
		box-shadow: 0 0 0 100vmax rgb(0 0 0 / 0.4);
		cursor: move;
	}

	.box.drafting {
		border-style: dashed;
	}

	.box:focus-visible {
		outline: 2px solid var(--color-accent-contrast);
		outline-offset: 2px;
	}

	.handle {
		position: absolute;
		width: 0.875rem;
		height: 0.875rem;
		box-sizing: border-box;
		background: var(--color-accent);
		border: 2px solid var(--color-accent-contrast);
		border-radius: 50%;
	}

	.handle.nw {
		top: -0.4375rem;
		left: -0.4375rem;
		cursor: nwse-resize;
	}

	.handle.ne {
		top: -0.4375rem;
		right: -0.4375rem;
		cursor: nesw-resize;
	}

	.handle.sw {
		bottom: -0.4375rem;
		left: -0.4375rem;
		cursor: nesw-resize;
	}

	.handle.se {
		right: -0.4375rem;
		bottom: -0.4375rem;
		cursor: nwse-resize;
	}
</style>
