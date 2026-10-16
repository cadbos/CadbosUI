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
	import { uploadResultSchema } from '$lib/api/contract';
	import ImageUpload from '$lib/components/ImageUpload.svelte';
	import LazyImage from '$lib/components/LazyImage.svelte';
	import { t, type TranslationKey } from '$lib/i18n/index.svelte';
	import { request } from '$lib/state/request.svelte';
	import { mediaAccess } from '$lib/state/media-access.svelte';

	const MAX_UPLOAD_SIZE = 8 * 1024 * 1024;
	const MAX_CANVAS_DIMENSION = 2048;
	type DrawingTool = 'brush' | 'eraser' | 'lasso';

	interface Props {
		sourceUrl?: string;
		sourceKey?: string;
		disabled?: boolean;
	}

	interface Point {
		x: number;
		y: number;
	}

	interface BrushCursor extends Point {
		canvasToCssScaleX: number;
		canvasToCssScaleY: number;
	}

	interface MaskBlobResult {
		blob: Blob | null;
		empty: boolean;
	}

	let { sourceUrl = undefined, sourceKey = undefined, disabled = false }: Props = $props();
	let canvas = $state<HTMLCanvasElement | null>(null);
	let tool = $state<DrawingTool>('brush');
	let brushSize = $state(48);
	let drawing = $state(false);
	let canvasReady = $state(false);
	let hasMarks = $state(false);
	let uploading = $state(false);
	let fallbackUploading = $state(false);
	let errorKey = $state<TranslationKey | null>(null);
	let brushCursor = $state<BrushCursor | null>(null);
	let lassoPoints = $state<Point[]>([]);
	let lassoHover = $state<Point | null>(null);
	let canvasWidth = $state(1);
	let canvasHeight = $state(1);
	let previousPoint: Point | null = null;
	let activePointerId: number | null = null;
	let initializedSource: number | string | undefined;
	const sourceIdentity = $derived(sourceKey ?? sourceUrl);
	const maskReady = $derived(request.textureMaskMatchesSource());
	const editorBusy = $derived(uploading || fallbackUploading);
	const hasLassoDraft = $derived(lassoPoints.length > 0);
	const canSave = $derived(canvasReady && hasMarks && !hasLassoDraft && !editorBusy && !disabled);
	const lassoOutline = $derived(lassoPoints.map((point) => `${point.x},${point.y}`).join(' '));
	const lassoPreview = $derived(
		lassoHover && hasLassoDraft ? `${lassoOutline} ${lassoHover.x},${lassoHover.y}` : lassoOutline
	);
	const brushCursorWidth = $derived(brushCursor ? brushSize * brushCursor.canvasToCssScaleX : 0);
	const brushCursorHeight = $derived(brushCursor ? brushSize * brushCursor.canvasToCssScaleY : 0);
	const brushCursorVisible = $derived(
		tool !== 'lasso' && brushCursor !== null && canvasReady && !disabled && !editorBusy
	);

	function attachCanvas(node: HTMLCanvasElement): () => void {
		canvas = node;
		canvasReady = false;
		lassoPoints = [];
		lassoHover = null;
		brushCursor = null;
		return () => {
			canvas = null;
			canvasReady = false;
			cancelLasso();
			brushCursor = null;
		};
	}

	function context(): CanvasRenderingContext2D | null {
		return canvas?.getContext('2d', { willReadFrequently: true }) ?? null;
	}

	function resetDrawing(): void {
		const drawingContext = context();
		if (drawingContext && canvas) drawingContext.clearRect(0, 0, canvas.width, canvas.height);
		hasMarks = false;
		cancelLasso();
		drawing = false;
		previousPoint = null;
		activePointerId = null;
		errorKey = null;
	}

	function initializeCanvas(image: HTMLImageElement, retry = true): void {
		if (!canvas) {
			if (retry) queueMicrotask(() => initializeCanvas(image, false));
			return;
		}
		const scale = Math.min(
			1,
			MAX_CANVAS_DIMENSION / Math.max(image.naturalWidth, image.naturalHeight)
		);
		const width = Math.max(1, Math.round(image.naturalWidth * scale));
		const height = Math.max(1, Math.round(image.naturalHeight * scale));
		if (
			sourceIdentity !== initializedSource ||
			canvas.width !== width ||
			canvas.height !== height
		) {
			canvas.width = width;
			canvas.height = height;
			canvasWidth = width;
			canvasHeight = height;
			initializedSource = sourceIdentity;
			resetDrawing();
		}
		canvasReady = image.naturalWidth > 0 && image.naturalHeight > 0;
		errorKey = null;
	}

	function sourceLoadFailed(): void {
		if (sourceIdentity !== initializedSource) {
			canvasReady = false;
			resetDrawing();
		}
		errorKey = 'textureReplacement.maskEditor.sourceFailed';
	}

	function pointFor(event: PointerEvent): Point | null {
		if (!canvas) return null;
		const bounds = canvas.getBoundingClientRect();
		if (bounds.width === 0 || bounds.height === 0) return null;
		return {
			x: ((event.clientX - bounds.left) / bounds.width) * canvas.width,
			y: ((event.clientY - bounds.top) / bounds.height) * canvas.height
		};
	}

	function updateBrushCursor(event: PointerEvent): void {
		if (
			tool === 'lasso' ||
			event.pointerType === 'touch' ||
			disabled ||
			editorBusy ||
			!canvasReady ||
			!canvas
		) {
			brushCursor = null;
			return;
		}
		const bounds = canvas.getBoundingClientRect();
		const x = event.clientX - bounds.left;
		const y = event.clientY - bounds.top;
		if (
			bounds.width === 0 ||
			bounds.height === 0 ||
			x < 0 ||
			y < 0 ||
			x > bounds.width ||
			y > bounds.height
		) {
			brushCursor = null;
			return;
		}
		brushCursor = {
			x,
			y,
			canvasToCssScaleX: bounds.width / canvas.width,
			canvasToCssScaleY: bounds.height / canvas.height
		};
	}

	function hideBrushCursor(): void {
		brushCursor = null;
		lassoHover = null;
	}

	function configureStroke(drawingContext: CanvasRenderingContext2D): void {
		drawingContext.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over';
		drawingContext.strokeStyle = '#ff00ff';
		drawingContext.fillStyle = '#ff00ff';
		drawingContext.lineCap = 'round';
		drawingContext.lineJoin = 'round';
		drawingContext.lineWidth = brushSize;
	}

	function invalidateSavedMask(): void {
		if (request.textureMaskImage) request.setTextureMaskImage(undefined);
		errorKey = null;
	}

	function drawDot(drawingContext: CanvasRenderingContext2D, point: Point): void {
		configureStroke(drawingContext);
		drawingContext.beginPath();
		drawingContext.arc(point.x, point.y, brushSize / 2, 0, Math.PI * 2);
		drawingContext.fill();
	}

	function cancelLasso(): void {
		lassoPoints = [];
		lassoHover = null;
	}

	function selectTool(nextTool: DrawingTool): void {
		if (tool === nextTool) return;
		cancelLasso();
		brushCursor = null;
		tool = nextTool;
	}

	function finishLasso(): void {
		if (lassoPoints.length < 3 || disabled || editorBusy || !canvasReady) return;
		const drawingContext = context();
		if (!drawingContext || !canvas) return;
		const polygonCanvas = document.createElement('canvas');
		polygonCanvas.width = canvas.width;
		polygonCanvas.height = canvas.height;
		const polygonContext = polygonCanvas.getContext('2d');
		if (!polygonContext) return;
		polygonContext.fillStyle = '#ff00ff';
		polygonContext.beginPath();
		polygonContext.moveTo(lassoPoints[0].x, lassoPoints[0].y);
		for (const point of lassoPoints.slice(1)) polygonContext.lineTo(point.x, point.y);
		polygonContext.closePath();
		polygonContext.fill();
		const pixels = polygonContext.getImageData(
			0,
			0,
			polygonCanvas.width,
			polygonCanvas.height
		).data;
		let hasArea = false;
		for (let index = 3; index < pixels.length; index += 4) {
			if (pixels[index] >= 128) {
				hasArea = true;
				break;
			}
		}
		if (!hasArea) return;
		drawingContext.globalCompositeOperation = 'source-over';
		drawingContext.drawImage(polygonCanvas, 0, 0);
		hasMarks = true;
		invalidateSavedMask();
		cancelLasso();
	}

	function undoLassoPoint(): void {
		lassoPoints = lassoPoints.slice(0, -1);
	}

	function handleLassoKey(event: KeyboardEvent): void {
		if (tool !== 'lasso' || !hasLassoDraft || disabled || editorBusy) return;
		if (event.key === 'Enter') finishLasso();
		else if (event.key === 'Escape') cancelLasso();
		else if (event.key === 'Backspace' || event.key === 'Delete') undoLassoPoint();
		else return;
		event.preventDefault();
		event.stopPropagation();
	}

	function addLassoPoint(point: Point, event: PointerEvent): void {
		if (!canvas) return;
		const first = lassoPoints[0];
		const bounds = canvas.getBoundingClientRect();
		if (
			lassoPoints.length >= 3 &&
			Math.hypot(
				((point.x - first.x) / canvas.width) * bounds.width,
				((point.y - first.y) / canvas.height) * bounds.height
			) <= (event.pointerType === 'touch' ? 20 : 10)
		) {
			finishLasso();
			return;
		}
		const last = lassoPoints.at(-1);
		if (last && last.x === point.x && last.y === point.y) return;
		lassoPoints = [...lassoPoints, point];
		lassoHover = null;
	}

	function beginDrawing(event: PointerEvent): void {
		updateBrushCursor(event);
		if (
			disabled ||
			editorBusy ||
			!canvasReady ||
			!canvas ||
			!event.isPrimary ||
			event.button !== 0 ||
			activePointerId !== null
		)
			return;
		if (tool === 'eraser' && !hasMarks) return;
		const point = pointFor(event);
		const drawingContext = context();
		if (!point || !drawingContext) return;
		canvas.focus({ preventScroll: true });
		if (tool === 'lasso') {
			addLassoPoint(point, event);
			return;
		}
		invalidateSavedMask();
		drawing = true;
		activePointerId = event.pointerId;
		previousPoint = point;
		canvas.setPointerCapture(event.pointerId);
		drawDot(drawingContext, point);
		if (tool === 'brush') hasMarks = true;
	}

	function handlePointerMove(event: PointerEvent): void {
		updateBrushCursor(event);
		if (tool === 'lasso' && !disabled && !editorBusy && canvasReady) {
			lassoHover = pointFor(event);
		}
		continueDrawing(event);
	}

	function continueDrawing(event: PointerEvent): void {
		if (!drawing || !previousPoint || event.pointerId !== activePointerId) return;
		const point = pointFor(event);
		const drawingContext = context();
		if (!point || !drawingContext) return;
		configureStroke(drawingContext);
		drawingContext.beginPath();
		drawingContext.moveTo(previousPoint.x, previousPoint.y);
		drawingContext.lineTo(point.x, point.y);
		drawingContext.stroke();
		previousPoint = point;
	}

	function stopDrawing(event: PointerEvent): void {
		if (!drawing || event.pointerId !== activePointerId) return;
		drawing = false;
		previousPoint = null;
		activePointerId = null;
		if (canvas?.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
	}

	function clearMask(): void {
		const drawingContext = context();
		if (!drawingContext || !canvas || disabled || editorBusy) return;
		drawingContext.clearRect(0, 0, canvas.width, canvas.height);
		hasMarks = false;
		cancelLasso();
		invalidateSavedMask();
	}

	function maskBlob(): Promise<MaskBlobResult> {
		if (!canvas) return Promise.resolve({ blob: null, empty: true });
		const output = document.createElement('canvas');
		output.width = canvas.width;
		output.height = canvas.height;
		const outputContext = output.getContext('2d');
		if (!outputContext) return Promise.resolve({ blob: null, empty: true });
		outputContext.fillStyle = '#000000';
		outputContext.fillRect(0, 0, output.width, output.height);
		outputContext.drawImage(canvas, 0, 0);
		const imageData = outputContext.getImageData(0, 0, output.width, output.height);
		let hasWhite = false;
		for (let index = 0; index < imageData.data.length; index += 4) {
			const value = imageData.data[index] >= 128 ? 255 : 0;
			if (value === 255) hasWhite = true;
			imageData.data[index] = value;
			imageData.data[index + 1] = value;
			imageData.data[index + 2] = value;
			imageData.data[index + 3] = 255;
		}
		outputContext.putImageData(imageData, 0, 0);
		if (!hasWhite) return Promise.resolve({ blob: null, empty: true });
		return new Promise((resolve) =>
			output.toBlob((blob) => resolve({ blob, empty: false }), 'image/png')
		);
	}

	function uploadErrorKey(code: string | null): TranslationKey {
		if (code === 'image_too_large') return 'upload.errorSize';
		if (code === 'unsupported_image_type') return 'upload.errorType';
		return 'textureReplacement.maskEditor.saveFailed';
	}

	async function responseErrorKey(response: Response): Promise<TranslationKey> {
		const body: unknown = await response.json().catch(() => null);
		if (
			typeof body === 'object' &&
			body !== null &&
			'error' in body &&
			typeof body.error === 'object' &&
			body.error !== null &&
			'code' in body.error &&
			typeof body.error.code === 'string'
		) {
			return uploadErrorKey(body.error.code);
		}
		return 'textureReplacement.maskEditor.saveFailed';
	}

	async function saveMask(): Promise<void> {
		if (!canSave || !canvas) return;
		errorKey = null;
		request.setTextureMaskImage(undefined);
		const operation = request.beginTextureMaskUpload();
		if (!operation) {
			errorKey = 'textureReplacement.maskEditor.sourceRequired';
			return;
		}
		uploading = true;
		try {
			const { blob, empty } = await maskBlob();
			if (empty) {
				hasMarks = false;
				errorKey = 'textureReplacement.maskEditor.empty';
				return;
			}
			if (!blob || blob.size === 0 || blob.size > MAX_UPLOAD_SIZE) {
				errorKey =
					blob && blob.size > MAX_UPLOAD_SIZE
						? 'upload.errorSize'
						: 'textureReplacement.maskEditor.saveFailed';
				return;
			}
			const formData = new FormData();
			formData.append('file', new File([blob], 'texture-mask.png', { type: 'image/png' }));
			const response = await fetch('/api/uploads', { method: 'POST', body: formData });
			if (!response.ok) {
				errorKey = await responseErrorKey(response);
				return;
			}
			const parsed = uploadResultSchema.safeParse(await response.json());
			if (!parsed.success) {
				errorKey = 'textureReplacement.maskEditor.saveFailed';
				return;
			}
			if (
				!request.commitTextureMaskUpload(
					{
						mediaKey: mediaAccess.normalize(parsed.data.image).key,
						mime: parsed.data.mime,
						size: parsed.data.size,
						dimensions: parsed.data.dimensions
					},
					operation
				)
			) {
				errorKey = 'textureReplacement.maskEditor.saveFailed';
			}
		} catch {
			errorKey = 'textureReplacement.maskEditor.saveFailed';
		} finally {
			request.finishTextureMaskUpload(operation);
			uploading = false;
		}
	}

	function brushSizeValue(event: Event): number {
		return event.currentTarget instanceof HTMLInputElement
			? Number(event.currentTarget.value)
			: brushSize;
	}
</script>

<div class="mask-editor">
	<div class="editor-heading">
		<div>
			<h4>{t('textureReplacement.maskEditor.title')}</h4>
			<p>{t('textureReplacement.maskEditor.hint')}</p>
		</div>
		<span class="required-badge">{t('textureReplacement.required')}</span>
	</div>

	{#if sourceUrl}
		<div class="toolbar" role="toolbar" aria-label={t('textureReplacement.maskEditor.toolbar')}>
			<div class="tool-group">
				<button
					type="button"
					class={{ active: tool === 'brush' }}
					aria-pressed={tool === 'brush'}
					disabled={disabled || editorBusy}
					onclick={() => selectTool('brush')}
				>
					{t('textureReplacement.maskEditor.brush')}
				</button>
				<button
					type="button"
					class={{ active: tool === 'eraser' }}
					aria-pressed={tool === 'eraser'}
					disabled={disabled || editorBusy}
					onclick={() => selectTool('eraser')}
				>
					{t('textureReplacement.maskEditor.eraser')}
				</button>
				<button
					type="button"
					class={{ active: tool === 'lasso' }}
					aria-pressed={tool === 'lasso'}
					disabled={disabled || editorBusy}
					onclick={() => selectTool('lasso')}
				>
					{t('textureReplacement.maskEditor.lasso')}
				</button>
			</div>
			{#if tool !== 'lasso'}
				<label class="brush-size">
					<span>{t('textureReplacement.maskEditor.brushSize')}</span>
					<input
						type="range"
						min="8"
						max="160"
						step="4"
						value={brushSize}
						disabled={disabled || editorBusy}
						oninput={(event) => (brushSize = brushSizeValue(event))}
					/>
					<output>{brushSize}</output>
				</label>
			{:else}
				<div class="lasso-actions">
					<button
						type="button"
						disabled={lassoPoints.length < 3 || disabled || editorBusy}
						onclick={finishLasso}
					>
						{t('textureReplacement.maskEditor.finishLasso')}
					</button>
					<button
						type="button"
						disabled={!hasLassoDraft || disabled || editorBusy}
						onclick={undoLassoPoint}
					>
						{t('textureReplacement.maskEditor.undoPoint')}
					</button>
					<button
						type="button"
						disabled={!hasLassoDraft || disabled || editorBusy}
						onclick={cancelLasso}
					>
						{t('textureReplacement.maskEditor.cancelLasso')}
					</button>
				</div>
			{/if}
			<div class="editor-actions">
				<button
					type="button"
					disabled={(!hasMarks && !hasLassoDraft) || disabled || editorBusy}
					onclick={clearMask}
				>
					{t('textureReplacement.maskEditor.clear')}
				</button>
			</div>
		</div>

		{#if tool === 'lasso'}
			<p id="mask-editor-lasso-hint" class="lasso-hint">
				{t('textureReplacement.maskEditor.lassoHint')}
			</p>
		{/if}

		{#key sourceIdentity}
			<div class={['drawing-stage', { disabled: disabled || editorBusy, lasso: tool === 'lasso' }]}>
				<LazyImage
					src={sourceUrl}
					alt={t('textureReplacement.maskEditor.sourceAlt')}
					loading="eager"
					fetchPriority="high"
					onReady={initializeCanvas}
					onError={sourceLoadFailed}
				/>
				<canvas
					{@attach attachCanvas}
					aria-label={t('textureReplacement.maskEditor.canvasLabel')}
					aria-describedby={tool === 'lasso'
						? 'mask-editor-lasso-hint mask-editor-upload-alternative'
						: 'mask-editor-upload-alternative'}
					tabindex="0"
					onkeydown={handleLassoKey}
					onpointerdown={beginDrawing}
					onpointerenter={updateBrushCursor}
					onpointermove={handlePointerMove}
					onpointerleave={hideBrushCursor}
					onpointerup={stopDrawing}
					onpointercancel={stopDrawing}
					onlostpointercapture={stopDrawing}
				></canvas>
				{#if tool === 'lasso' && hasLassoDraft && canvasReady}
					<svg
						class="lasso-preview"
						viewBox="0 0 {canvasWidth} {canvasHeight}"
						preserveAspectRatio="none"
						aria-hidden="true"
					>
						<polyline points={lassoPreview} />
						{#each lassoPoints as point, index (index)}
							<circle cx={point.x} cy={point.y} r="0.7%" class={{ first: index === 0 }} />
						{/each}
					</svg>
				{/if}
				{#if brushCursor && brushCursorVisible}
					<div
						class={['brush-cursor', { eraser: tool === 'eraser' }]}
						data-tool={tool}
						aria-hidden="true"
						style:left="{brushCursor.x}px"
						style:top="{brushCursor.y}px"
						style:width="{brushCursorWidth}px"
						style:height="{brushCursorHeight}px"
					></div>
				{/if}
			</div>
		{/key}

		<div class="save-row">
			<button type="button" class="save-button" disabled={!canSave} onclick={() => void saveMask()}>
				{uploading
					? t('textureReplacement.maskEditor.saving')
					: t('textureReplacement.maskEditor.save')}
			</button>
		</div>
	{:else}
		<p class="empty-state">{t('textureReplacement.maskEditor.sourceRequired')}</p>
	{/if}

	{#if errorKey}
		<p class="editor-error" role="alert">{t(errorKey)}</p>
	{/if}
	<div class="save-status" role="status" aria-live="polite" aria-atomic="true">
		{#if uploading}
			<span>{t('textureReplacement.maskEditor.saving')}</span>
		{:else if hasLassoDraft}
			<span>{t('textureReplacement.maskEditor.lassoDraft')}</span>
		{:else if maskReady}
			<span>{t('textureReplacement.maskEditor.saved')}</span>
		{:else if hasMarks}
			<span>{t('textureReplacement.maskEditor.unsaved')}</span>
		{/if}
	</div>

	<details class="mask-upload">
		<summary id="mask-editor-upload-alternative">
			{t('textureReplacement.maskEditor.uploadAlternative')}
		</summary>
		<ImageUpload
			target="textureMask"
			requiredLabel="textureReplacement.required"
			disabled={disabled || uploading || !sourceUrl}
			onUploadingChange={(value) => (fallbackUploading = value)}
		/>
	</details>
</div>

<style>
	.mask-editor {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.editor-heading {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
	}

	.editor-heading h4,
	.editor-heading p,
	.empty-state,
	.editor-error {
		margin: 0;
	}

	.editor-heading h4 {
		font-size: 0.9375rem;
		font-weight: 650;
	}

	.editor-heading p {
		margin-top: 0.25rem;
		max-width: 60ch;
		color: var(--color-muted-strong);
		font-size: 0.8125rem;
		line-height: 1.45;
	}

	.required-badge {
		flex: 0 0 auto;
		padding: 0.15rem 0.5rem;
		border: 1px solid var(--color-border);
		border-radius: 100px;
		color: var(--color-muted-strong);
		font-size: 0.6875rem;
		font-weight: 600;
	}

	.toolbar {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.75rem;
		padding: 0.75rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		background: var(--color-background);
	}

	.tool-group,
	.editor-actions,
	.lasso-actions {
		display: inline-flex;
		gap: 0.375rem;
		flex-wrap: wrap;
	}

	.toolbar button,
	.save-button {
		padding: 0.5rem 0.75rem;
		border: 1px solid var(--color-muted-strong);
		border-radius: 8px;
		background: var(--color-surface);
		color: var(--color-text);
		font: inherit;
		font-size: 0.8125rem;
		font-weight: 600;
		cursor: pointer;
	}

	.toolbar button.active {
		border-color: var(--color-accent);
		background: color-mix(in srgb, var(--color-accent) 12%, var(--color-surface));
		color: var(--color-accent-text);
	}

	.toolbar button:disabled,
	.save-button:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}

	.brush-size {
		display: grid;
		grid-template-columns: auto minmax(100px, 180px) 2.25rem;
		align-items: center;
		gap: 0.5rem;
		color: var(--color-muted-strong);
		font-size: 0.75rem;
		font-weight: 600;
	}

	.brush-size input {
		accent-color: var(--color-accent);
	}

	.brush-size output {
		text-align: right;
		font-variant-numeric: tabular-nums;
	}

	.editor-actions {
		margin-left: auto;
	}

	.drawing-stage {
		--image-height: auto;
		--image-position: static;
		--image-img-height: auto;
		--image-min-height: 12rem;
		--image-fit: contain;
		position: relative;
		width: 100%;
		border: 1.5px solid var(--color-muted-strong);
		border-radius: var(--radius-lg);
		overflow: hidden;
		background:
			linear-gradient(
					45deg,
					color-mix(in srgb, var(--color-border) 35%, transparent) 25%,
					transparent 25%
				)
				0 0 / 16px 16px,
			var(--color-background);
		isolation: isolate;
	}

	.drawing-stage canvas {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		cursor: none;
		filter: drop-shadow(0 0 2px #000);
		touch-action: none;
	}

	.drawing-stage.lasso canvas {
		cursor: crosshair;
	}

	.drawing-stage canvas:focus-visible {
		outline: 3px solid var(--color-accent);
		outline-offset: -3px;
	}

	.lasso-hint {
		margin: 0;
		color: var(--color-muted-strong);
		font-size: 0.8125rem;
		line-height: 1.45;
	}

	.lasso-preview {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		pointer-events: none;
		filter: drop-shadow(0 0 2px #000);
	}

	.lasso-preview polyline {
		fill: none;
		stroke: #fff;
		stroke-width: 2px;
		vector-effect: non-scaling-stroke;
	}

	.lasso-preview circle {
		fill: #ff00ff;
		stroke: #fff;
		stroke-width: 2px;
		vector-effect: non-scaling-stroke;
	}

	.lasso-preview circle.first {
		fill: #fff;
		stroke: #ff00ff;
	}

	.drawing-stage.disabled canvas {
		cursor: not-allowed;
	}

	.brush-cursor {
		position: absolute;
		z-index: 1;
		box-sizing: border-box;
		border: 2px solid #fff;
		border-radius: 50%;
		background: color-mix(in srgb, var(--color-accent) 20%, transparent);
		box-shadow:
			0 0 0 1px #000,
			inset 0 0 0 1px #000;
		pointer-events: none;
		transform: translate(-50%, -50%);
	}

	.brush-cursor.eraser {
		border-style: dashed;
		background: color-mix(in srgb, var(--color-background) 60%, transparent);
	}

	.save-row {
		display: flex;
		align-items: center;
		gap: 0.875rem;
	}

	.save-button {
		border-color: var(--color-accent);
		background: var(--color-accent);
		color: var(--color-accent-contrast);
	}

	.save-status {
		color: var(--color-muted-strong);
		font-size: 0.8125rem;
	}

	.save-status:empty {
		display: none;
	}

	.empty-state {
		padding: 1rem;
		border: 1px dashed var(--color-muted-strong);
		border-radius: var(--radius);
		color: var(--color-muted-strong);
		font-size: 0.875rem;
	}

	.editor-error {
		color: var(--color-danger);
		font-size: 0.875rem;
	}

	.mask-upload {
		border-top: 1px solid var(--color-border);
		padding-top: 0.875rem;
	}

	.mask-upload summary {
		color: var(--color-muted-strong);
		font-size: 0.8125rem;
		font-weight: 600;
		cursor: pointer;
	}

	.mask-upload :global(.upload) {
		margin-top: 0.75rem;
	}

	@media (max-width: 640px) {
		.toolbar {
			align-items: stretch;
			flex-direction: column;
		}

		.tool-group,
		.editor-actions {
			display: grid;
			grid-template-columns: repeat(3, 1fr);
			margin-left: 0;
		}

		.brush-size {
			grid-template-columns: auto 1fr 2.25rem;
		}

		.save-row {
			align-items: flex-start;
			flex-direction: column;
		}
	}
</style>
