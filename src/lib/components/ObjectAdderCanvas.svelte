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
	import { type ObjectAdderRect, uploadResultSchema } from '$lib/api/contract';
	import { t } from '$lib/i18n/index.svelte';
	import { objectAdder } from '$lib/state/object-adder.svelte';

	const MAX_SIZE = 8 * 1024 * 1024;
	const DEFAULT_WIDTH = 0.3;
	const MIN_HEIGHT = 0.05;
	const MAX_HEIGHT = 0.9;
	const MIN_SIZE = 0.03;

	type DragMode = 'move' | 'resize';

	interface DragState {
		mode: DragMode;
		pointerId: number;
		startX: number;
		startY: number;
		startRect: ObjectAdderRect;
		containerWidth: number;
		containerHeight: number;
	}

	interface Props {
		sceneImageUrl?: string;
		disabled: boolean;
	}

	let { sceneImageUrl = undefined, disabled }: Props = $props();

	let containerEl = $state<HTMLDivElement | null>(null);
	let inputEl = $state<HTMLInputElement | null>(null);
	let sceneNaturalWidth = $state<number | undefined>(undefined);
	let sceneNaturalHeight = $state<number | undefined>(undefined);
	// The object photo's url this natural size was actually measured for —
	// compared against objectAdder.objectImage.url below instead of an
	// explicit "reset on change" effect, so a newly picked object can never
	// be measured against a stale aspect ratio left over from the last one.
	let measuredObjectUrl = $state<string | undefined>(undefined);
	let objectNaturalWidth = $state<number | undefined>(undefined);
	let objectNaturalHeight = $state<number | undefined>(undefined);
	let uploading = $state(false);
	let uploadError = $state<string | null>(null);

	// Not reactive on purpose — only ever read/written from pointer handlers,
	// never rendered, so tracking it as $state would just add churn.
	let drag: DragState | null = null;

	// Bookkeeping for the "reset rect on scene change" effect below — plain
	// (non-reactive) variables updated from inside that effect's own closure,
	// never read at the top level, so the prop is only ever observed through
	// a reactive read.
	let sceneUrlTracked = false;
	let previousSceneUrl: string | undefined;

	const placementRect = $derived(objectAdder.rect);
	const objectNaturalReady = $derived(
		objectAdder.objectImage !== undefined && objectAdder.objectImage.url === measuredObjectUrl
	);

	function attachContainer(node: HTMLDivElement): void {
		containerEl = node;
	}

	function attachInput(node: HTMLInputElement): void {
		inputEl = node;
	}

	function handleSceneLoad(event: Event): void {
		if (!(event.currentTarget instanceof HTMLImageElement)) return;
		sceneNaturalWidth = event.currentTarget.naturalWidth;
		sceneNaturalHeight = event.currentTarget.naturalHeight;
	}

	function handleObjectLoad(event: Event): void {
		if (!(event.currentTarget instanceof HTMLImageElement)) return;
		measuredObjectUrl = objectAdder.objectImage?.url;
		objectNaturalWidth = event.currentTarget.naturalWidth;
		objectNaturalHeight = event.currentTarget.naturalHeight;
	}

	// A stale placement from a previous, differently-sized scene photo makes
	// no sense against a new one — but this must only fire on a genuine change
	// of `sceneImageUrl`, not on this component's own mount (it isn't sticky
	// like the side-panel tools — switching edit tool tabs away and back
	// destroys and recreates it against the *same* photo, and that must not
	// wipe out the user's placement). The first run just records the initial
	// value instead of resetting anything, since there's nothing to compare
	// it against yet.
	$effect(() => {
		const url = sceneImageUrl;
		if (!sceneUrlTracked) {
			sceneUrlTracked = true;
			previousSceneUrl = url;
			return;
		}
		if (url === previousSceneUrl) return;
		previousSceneUrl = url;
		objectAdder.setRect(null);
	});

	// Once both images have reported their natural size, place a sensible
	// centered default the first time (or after a reset above) — preserving
	// the object photo's own aspect ratio, converted into the scene's
	// fractional coordinate space.
	$effect(() => {
		if (objectAdder.rect !== null) return;
		if (!objectAdder.objectImage || !objectNaturalReady) return;
		if (sceneNaturalWidth === undefined || sceneNaturalHeight === undefined) return;
		if (objectNaturalWidth === undefined || objectNaturalHeight === undefined) return;
		const width = DEFAULT_WIDTH;
		const rawHeight =
			width * (objectNaturalHeight / objectNaturalWidth) * (sceneNaturalWidth / sceneNaturalHeight);
		const height = Math.min(Math.max(rawHeight, MIN_HEIGHT), MAX_HEIGHT);
		objectAdder.setRect({ x: 0.5 - width / 2, y: 0.5 - height / 2, width, height });
	});

	function onFileInputChange(event: Event): void {
		const file = (event.currentTarget as HTMLInputElement).files?.[0];
		if (file) void handleFile(file);
	}

	async function handleFile(file: File): Promise<void> {
		if (disabled || uploading) return;
		uploadError = null;
		if (!file.type.startsWith('image/') || file.size > MAX_SIZE) {
			uploadError = t('upload.errorUpload');
			return;
		}
		uploading = true;
		try {
			const formData = new FormData();
			formData.append('file', file);
			const response = await fetch('/api/uploads', { method: 'POST', body: formData });
			if (!response.ok) {
				uploadError = t('upload.errorUpload');
				return;
			}
			const parsed = uploadResultSchema.safeParse(await response.json());
			if (!parsed.success) {
				uploadError = t('upload.errorUpload');
				return;
			}
			objectAdder.setObjectImage({ url: parsed.data.url, hash: parsed.data.hash });
		} catch {
			uploadError = t('upload.errorUpload');
		} finally {
			uploading = false;
			if (inputEl) inputEl.value = '';
		}
	}

	function beginMove(event: PointerEvent): void {
		if (disabled || !objectAdder.rect || !containerEl) return;
		const containerRect = containerEl.getBoundingClientRect();
		if (containerRect.width === 0 || containerRect.height === 0) return;
		drag = {
			mode: 'move',
			pointerId: event.pointerId,
			startX: event.clientX,
			startY: event.clientY,
			startRect: objectAdder.rect,
			containerWidth: containerRect.width,
			containerHeight: containerRect.height
		};
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
	}

	function continueMove(event: PointerEvent): void {
		if (!drag || drag.mode !== 'move' || event.pointerId !== drag.pointerId) return;
		const dx = (event.clientX - drag.startX) / drag.containerWidth;
		const dy = (event.clientY - drag.startY) / drag.containerHeight;
		const { startRect } = drag;
		const maxX = Math.max(1 - startRect.width, 0);
		const maxY = Math.max(1 - startRect.height, 0);
		objectAdder.setRect({
			...startRect,
			x: Math.min(Math.max(startRect.x + dx, 0), maxX),
			y: Math.min(Math.max(startRect.y + dy, 0), maxY)
		});
	}

	function beginResize(event: PointerEvent): void {
		event.stopPropagation();
		if (disabled || !objectAdder.rect || !containerEl) return;
		const containerRect = containerEl.getBoundingClientRect();
		if (containerRect.width === 0 || containerRect.height === 0) return;
		drag = {
			mode: 'resize',
			pointerId: event.pointerId,
			startX: event.clientX,
			startY: event.clientY,
			startRect: objectAdder.rect,
			containerWidth: containerRect.width,
			containerHeight: containerRect.height
		};
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
	}

	function continueResize(event: PointerEvent): void {
		if (!drag || drag.mode !== 'resize' || event.pointerId !== drag.pointerId) return;
		const dx = (event.clientX - drag.startX) / drag.containerWidth;
		const dy = (event.clientY - drag.startY) / drag.containerHeight;
		const { startRect } = drag;
		const width = Math.min(Math.max(startRect.width + dx, MIN_SIZE), 1 - startRect.x);
		const height = Math.min(Math.max(startRect.height + dy, MIN_SIZE), 1 - startRect.y);
		objectAdder.setRect({ ...startRect, width, height });
	}

	function endDrag(event: PointerEvent): void {
		if (!drag || event.pointerId !== drag.pointerId) return;
		const target = event.currentTarget as HTMLElement;
		if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
		drag = null;
	}
</script>

<div class="object-adder-canvas" {@attach attachContainer}>
	{#if sceneImageUrl}
		<img src={sceneImageUrl} alt="" class="scene-image" onload={handleSceneLoad} />
	{/if}

	{#if objectAdder.objectImage}
		{@const image = objectAdder.objectImage}
		<div
			class="object-wrapper"
			style:left={placementRect ? `${placementRect.x * 100}%` : '0%'}
			style:top={placementRect ? `${placementRect.y * 100}%` : '0%'}
			style:width={placementRect ? `${placementRect.width * 100}%` : '10%'}
			style:height={placementRect ? `${placementRect.height * 100}%` : '10%'}
			style:visibility={placementRect ? 'visible' : 'hidden'}
		>
			<img
				src={image.url}
				alt=""
				class="object-image"
				class:disabled
				onload={handleObjectLoad}
				onpointerdown={beginMove}
				onpointermove={continueMove}
				onpointerup={endDrag}
				onpointercancel={endDrag}
			/>
			<div
				class="resize-handle"
				class:disabled
				aria-hidden="true"
				onpointerdown={beginResize}
				onpointermove={continueResize}
				onpointerup={endDrag}
				onpointercancel={endDrag}
			></div>
		</div>
	{/if}

	<div class="picker">
		{#if !objectAdder.objectImage}
			<p class="hint">{t('objectAdder.hint')}</p>
		{/if}
		<button type="button" class="pick-btn" {disabled} onclick={() => inputEl?.click()}>
			{uploading
				? t('upload.uploading')
				: objectAdder.objectImage
					? t('objectAdder.changeObject')
					: t('objectAdder.pickObject')}
		</button>
		<input
			{@attach attachInput}
			type="file"
			accept="image/*"
			class="file-input"
			disabled={disabled || uploading}
			onchange={onFileInputChange}
		/>
		{#if uploadError}
			<p class="upload-error" role="alert">{uploadError}</p>
		{/if}
	</div>
</div>

<style>
	.object-adder-canvas {
		position: relative;
		width: 100%;
		border: 1.5px solid var(--color-muted-strong);
		border-radius: var(--radius-lg);
		overflow: hidden;
		background: var(--color-background);
	}

	.scene-image {
		display: block;
		width: 100%;
		height: auto;
	}

	.object-wrapper {
		position: absolute;
		z-index: 1;
	}

	.object-image {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: contain;
		cursor: move;
		touch-action: none;
		filter: drop-shadow(0 0 4px rgb(0 0 0 / 0.5));
	}

	.object-image.disabled {
		cursor: not-allowed;
	}

	.resize-handle {
		position: absolute;
		right: -0.375rem;
		bottom: -0.375rem;
		width: 1rem;
		height: 1rem;
		border: 2px solid var(--color-accent-contrast);
		border-radius: 3px;
		background: var(--color-accent);
		box-shadow: 0 0 0 1px rgb(0 0 0 / 0.4);
		cursor: nwse-resize;
		touch-action: none;
	}

	.resize-handle.disabled {
		cursor: not-allowed;
	}

	.picker {
		position: absolute;
		z-index: 2;
		top: 0.75rem;
		left: 0.75rem;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.375rem;
		max-width: calc(100% - 1.5rem);
	}

	.hint {
		margin: 0;
		padding: 0.375rem 0.625rem;
		border-radius: 8px;
		background: color-mix(in srgb, var(--color-background) 85%, transparent);
		color: var(--color-muted-strong);
		font-size: 0.8125rem;
		box-shadow: var(--shadow-sm);
	}

	.pick-btn {
		padding: 0.5rem 0.875rem;
		border: 1px solid var(--color-muted-strong);
		border-radius: var(--radius);
		background: var(--color-surface);
		color: var(--color-text);
		font: inherit;
		font-size: 0.8125rem;
		font-weight: 600;
		cursor: pointer;
		box-shadow: var(--shadow-sm);
	}

	.pick-btn:hover:not(:disabled) {
		border-color: var(--color-accent);
		color: var(--color-accent-text);
	}

	.pick-btn:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.file-input {
		display: none;
	}

	.upload-error {
		margin: 0;
		padding: 0.375rem 0.625rem;
		border-radius: 8px;
		background: color-mix(in srgb, var(--color-background) 85%, transparent);
		color: var(--color-danger);
		font-size: 0.8125rem;
		box-shadow: var(--shadow-sm);
	}
</style>
