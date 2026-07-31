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
	import { ChevronsLeftRight } from '@lucide/svelte';

	interface Props {
		beforeSrc: string | undefined;
		afterSrc: string | undefined;
		beforeAlt: string;
		afterAlt: string;
		handleLabel: string;
		onBeforeLoad?: () => void;
		onAfterLoad?: () => void;
	}

	let { beforeSrc, afterSrc, beforeAlt, afterAlt, handleLabel, onBeforeLoad, onAfterLoad }: Props =
		$props();

	let position = $state(50);
	let frame = $state<HTMLDivElement | null>(null);

	function attachFrame(node: HTMLDivElement): void {
		frame = node;
	}

	function positionFromPointer(clientX: number): number {
		if (!frame) return position;
		const bounds = frame.getBoundingClientRect();
		if (bounds.width === 0) return position;
		const ratio = ((clientX - bounds.left) / bounds.width) * 100;
		return Math.min(100, Math.max(0, ratio));
	}

	// Pointer capture is set on the frame (not the handle) because dragging
	// must work from anywhere on the image, not just the small handle.
	function onPointerDown(event: PointerEvent): void {
		position = positionFromPointer(event.clientX);
		frame?.setPointerCapture(event.pointerId);
	}

	function onPointerMove(event: PointerEvent): void {
		if (!frame?.hasPointerCapture(event.pointerId)) return;
		position = positionFromPointer(event.clientX);
	}

	function onPointerUp(event: PointerEvent): void {
		if (frame?.hasPointerCapture(event.pointerId)) {
			frame.releasePointerCapture(event.pointerId);
		}
	}

	function onHandleKeydown(event: KeyboardEvent): void {
		let next = position;
		if (event.key === 'ArrowLeft') next -= 2;
		else if (event.key === 'ArrowRight') next += 2;
		else if (event.key === 'PageDown') next -= 10;
		else if (event.key === 'PageUp') next += 10;
		else if (event.key === 'Home') next = 0;
		else if (event.key === 'End') next = 100;
		else return;
		event.preventDefault();
		position = Math.min(100, Math.max(0, next));
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions (dragging here is a pointer convenience; the accessible role and keyboard handling live on the .handle below) -->
<div
	{@attach attachFrame}
	class="compare-slider"
	onpointerdown={onPointerDown}
	onpointermove={onPointerMove}
	onpointerup={onPointerUp}
	onpointercancel={onPointerUp}
>
	<img src={afterSrc} alt={afterAlt} class="output" onload={onAfterLoad} />
	<img
		src={beforeSrc}
		alt={beforeAlt}
		class="overlay"
		style:clip-path={`inset(0 ${100 - position}% 0 0)`}
		onload={onBeforeLoad}
	/>
	<div class="divider" style:left="{position}%" aria-hidden="true"></div>
	<div
		class="handle"
		role="slider"
		tabindex="0"
		aria-label={handleLabel}
		aria-valuemin="0"
		aria-valuemax="100"
		aria-valuenow={Math.round(position)}
		style:left="{position}%"
		onkeydown={onHandleKeydown}
	>
		<ChevronsLeftRight size={14} aria-hidden="true" />
	</div>
</div>

<style>
	.compare-slider {
		position: relative;
		width: 100%;
		height: 100%;
		touch-action: none;
		cursor: ew-resize;
	}

	.output {
		width: 100%;
		height: 100%;
		object-fit: contain;
		display: block;
	}

	.overlay {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: contain;
	}

	.divider {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 1px;
		background: var(--color-border);
		pointer-events: none;
	}

	.handle {
		position: absolute;
		top: 50%;
		width: 2.25rem;
		height: 2.25rem;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 50%;
		background: #fff;
		border: 1.5px solid var(--color-border);
		box-shadow: var(--shadow);
		color: var(--color-text);
		cursor: ew-resize;
		transform: translate(-50%, -50%);
	}

	.handle:focus-visible {
		outline: 2px solid var(--color-accent);
		outline-offset: 2px;
	}
</style>
