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
	import { ArrowRight, Download, Pencil, Trash2, X } from '@lucide/svelte';
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import type { GenerationKind } from '$lib/api/contract';
	import { getLocale, t, ti, type TranslationKey } from '$lib/i18n/index.svelte';
	import { generatedImages } from '$lib/state/generated-images.svelte';
	import { request } from '$lib/state/request.svelte';
	import { buildShareUrl, destinationForGenerationKind } from '$lib/state/url-state';
	import { logBoundaryError } from '$lib/utils';

	const generationKindKeys: Record<GenerationKind, TranslationKey> = {
		render: 'generatedImages.kind.render',
		edit: 'generatedImages.kind.edit',
		'style-transfer': 'generatedImages.kind.styleTransfer',
		upscale: 'generatedImages.kind.upscale',
		'object-replacement': 'generatedImages.kind.objectReplacement',
		'texture-replacement': 'generatedImages.kind.textureReplacement'
	};

	interface Props {
		open: boolean;
		onClose: () => void;
	}

	interface DeleteCandidate {
		id: string;
		order: number;
	}

	interface GeneratedDate {
		datetime: string;
		dateLabel: string;
		timeLabel: string;
		ariaLabel: string;
	}

	let { open, onClose }: Props = $props();
	let deleteCandidate = $state<DeleteCandidate | null>(null);
	const isDeletingCandidate = $derived(
		deleteCandidate ? generatedImages.deletingIds.has(deleteCandidate.id) : false
	);

	function openModal(dialog: HTMLDialogElement): () => void {
		dialog.showModal();
		return () => {
			if (dialog.open) dialog.close();
		};
	}

	const MIN_DRAWER_WIDTH = 320;
	const RESIZE_STEP = 24;
	const WIDTH_STORAGE_KEY = 'cadbos.scenesDrawer.width.v1';

	function clampDrawerWidth(value: number): number {
		return Math.min(Math.max(value, MIN_DRAWER_WIDTH), window.innerWidth);
	}

	// null = the CSS default (min(46rem, 100vw), narrowing further at the
	// existing breakpoints below). Restored from localStorage so a size the
	// user dragged/keyboard-resized survives closing the drawer and reloading
	// the page, not just switching tabs within the same session.
	function readStoredWidth(): number | null {
		if (!browser) return null;
		try {
			const raw = localStorage.getItem(WIDTH_STORAGE_KEY);
			if (!raw) return null;
			const value = Number(raw);
			return Number.isFinite(value) ? clampDrawerWidth(value) : null;
		} catch (error) {
			logBoundaryError('scenesDrawer.restoreWidth', error);
			return null;
		}
	}

	let width = $state<number | null>(readStoredWidth());
	let resizing = $state(false);
	// The dialog stays mounted for the component's whole lifetime (see the
	// `open` prop / effect below) rather than being torn down and recreated by
	// an `{#if}` in the parent — that's what lets the native <dialog> close
	// transition (CSS `@starting-style` + `allow-discrete`, further down)
	// actually play instead of being cut short by the DOM node disappearing
	// mid-animation.
	let drawerEl = $state<HTMLDialogElement | null>(null);
	let dragStartX = 0;
	let dragStartWidth = 0;
	// Reactive mirrors of window.innerWidth / the drawer's measured width, so
	// the resize handle's aria-value* attributes below re-render on resize
	// instead of reading the DOM directly inside the template (which only
	// re-evaluates when some other tracked value changes).
	let viewportWidth = $state(browser ? window.innerWidth : MIN_DRAWER_WIDTH);
	let measuredWidth = $state(MIN_DRAWER_WIDTH);

	function attachDrawer(node: HTMLDialogElement): () => void {
		drawerEl = node;
		measuredWidth = node.getBoundingClientRect().width;
		return () => {
			drawerEl = null;
		};
	}

	$effect(() => {
		if (!drawerEl) return;
		if (open) {
			if (!drawerEl.open) drawerEl.showModal();
		} else if (drawerEl.open) {
			drawerEl.close();
		}
	});

	// Skips persisting while a resize drag is in progress — width changes on
	// every pointermove, and writing to localStorage that often would be pure
	// overhead. Reading `resizing` here (rather than only in the pointerup
	// handler) means this same effect fires once more the moment the drag
	// ends, persisting the final width without a separate explicit call.
	$effect(() => {
		if (!browser || width === null || resizing) return;
		try {
			localStorage.setItem(WIDTH_STORAGE_KEY, String(width));
		} catch (error) {
			logBoundaryError('scenesDrawer.persistWidth', error);
		}
	});

	function onResizeHandlePointerDown(event: PointerEvent): void {
		if (!drawerEl) return;
		dragStartX = event.clientX;
		dragStartWidth = drawerEl.getBoundingClientRect().width;
		measuredWidth = dragStartWidth;
		resizing = true;
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
	}

	function onResizeHandlePointerMove(event: PointerEvent): void {
		const target = event.currentTarget as HTMLElement;
		if (!target.hasPointerCapture(event.pointerId)) return;
		width = clampDrawerWidth(dragStartWidth + (event.clientX - dragStartX));
		measuredWidth = width;
	}

	function onResizeHandlePointerUp(event: PointerEvent): void {
		const target = event.currentTarget as HTMLElement;
		if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
		resizing = false;
	}

	function onResizeHandleKeydown(event: KeyboardEvent): void {
		const current = width ?? measuredWidth;
		let next: number;
		if (event.key === 'ArrowLeft') next = current - RESIZE_STEP;
		else if (event.key === 'ArrowRight') next = current + RESIZE_STEP;
		else if (event.key === 'Home') next = MIN_DRAWER_WIDTH;
		else if (event.key === 'End') next = window.innerWidth;
		else return;
		event.preventDefault();
		width = clampDrawerWidth(next);
		measuredWidth = width;
	}

	// Keeps a previously dragged width from pinning the drawer wider than the
	// viewport (or wider than the sub-540px "always fullscreen" breakpoint
	// expects) if the window shrinks while the drawer is still open.
	function onWindowResize(): void {
		viewportWidth = window.innerWidth;
		if (width === null) {
			if (drawerEl) measuredWidth = drawerEl.getBoundingClientRect().width;
			return;
		}
		const clamped = clampDrawerWidth(width);
		if (clamped !== width) width = clamped;
		measuredWidth = clamped;
	}

	$effect(() => {
		window.addEventListener('resize', onWindowResize);
		return () => window.removeEventListener('resize', onWindowResize);
	});

	function observeLoadMore(sentinel: HTMLElement): () => void {
		const root = sentinel.closest<HTMLElement>('.drawer-content');
		if (!root) throw new Error('scenes drawer scroll root missing');
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries.some((entry) => entry.isIntersecting)) void generatedImages.loadMore();
			},
			{ root, rootMargin: '0px 0px 160px 0px' }
		);
		observer.observe(sentinel);
		return () => observer.disconnect();
	}

	function datePart(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
		const part = parts.find((candidate) => candidate.type === type);
		if (!part) throw new Error(`generated image ${type} date part missing`);
		return part.value;
	}

	function generatedDate(createdAt: number): GeneratedDate {
		const date = new Date(createdAt);
		const locale = getLocale();
		const parts = new Intl.DateTimeFormat(locale, {
			day: 'numeric',
			month: 'short',
			year: 'numeric'
		}).formatToParts(date);
		const dateLabel = `${datePart(parts, 'day')} ${datePart(parts, 'month')} ${datePart(parts, 'year')}`;
		const timeLabel = new Intl.DateTimeFormat(locale, {
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit',
			hourCycle: 'h23'
		}).format(date);
		return {
			datetime: date.toISOString(),
			dateLabel,
			timeLabel,
			ariaLabel: ti('generatedImages.createdAt', { date: dateLabel, time: timeLabel })
		};
	}

	function imageExtension(url: string): string | null {
		const pathname = new URL(url).pathname;
		const match = /\.([a-z0-9]+)$/i.exec(pathname);
		return match ? match[1].toLowerCase() : null;
	}

	function downloadFilename(url: string, id: string): string {
		const extension = imageExtension(url);
		return extension ? `generated-image-${id}.${extension}` : `generated-image-${id}`;
	}

	function downloadHref(url: string, id: string): string {
		const filename = downloadFilename(url, id);
		return `/api/download?url=${encodeURIComponent(url)}&filename=${encodeURIComponent(filename)}`;
	}

	function downloadImage(url: string, id: string): void {
		const filename = downloadFilename(url, id);
		const anchor = document.createElement('a');
		anchor.href = downloadHref(url, id);
		anchor.download = filename;
		document.body.append(anchor);
		anchor.click();
		anchor.remove();
	}

	function requestDelete(id: string, order: number): void {
		if (generatedImages.deletingIds.has(id)) return;
		deleteCandidate = { id, order };
	}

	function useImage(url: string, kind: GenerationKind): void {
		request.setImage({ url });
		request.setCurrentRender(undefined);
		request.setStyleSourceMode('room-photo');
		request.setObjectReplacementSourceMode('room-photo');
		request.setTextureReplacementSourceMode('room-photo');
		request.setTextureMaskImage(undefined);
		request.setActiveObjectReplacementJobId(undefined);
		request.setActiveTextureReplacementJobId(undefined);
		request.setStatus('idle');
		const destination = destinationForGenerationKind(kind);
		onClose();
		goto(buildShareUrl(destination.mode, request, destination.subTab), {
			replaceState: false
		}).catch((error: unknown) => logBoundaryError('scenesDrawer.imageNavigation', error));
	}

	function closeDrawer(): void {
		if (deleteCandidate) return;
		onClose();
	}

	function handleDrawerClose(): void {
		onClose();
	}

	function handleDrawerCancel(event: Event): void {
		if (!deleteCandidate) return;
		event.preventDefault();
	}

	function handleDrawerClick(event: MouseEvent): void {
		if (event.target !== event.currentTarget) return;
		const dialog = event.currentTarget as HTMLDialogElement;
		const bounds = dialog.getBoundingClientRect();
		const outside =
			event.clientX < bounds.left ||
			event.clientX > bounds.right ||
			event.clientY < bounds.top ||
			event.clientY > bounds.bottom;
		if (outside) closeDrawer();
	}

	function cancelDelete(): void {
		if (isDeletingCandidate) return;
		deleteCandidate = null;
	}

	async function confirmDelete(): Promise<void> {
		const candidate = deleteCandidate;
		if (!candidate || generatedImages.deletingIds.has(candidate.id)) return;

		await generatedImages.deleteImage(candidate.id);
		if (deleteCandidate?.id === candidate.id) deleteCandidate = null;
	}

	function handleDeleteCancel(event: Event): void {
		event.preventDefault();
		cancelDelete();
	}
</script>

<dialog
	id="scenes-drawer"
	class="drawer"
	{@attach attachDrawer}
	aria-labelledby="scenes-title"
	style:width={width !== null ? `${width}px` : undefined}
	oncancel={handleDrawerCancel}
	onclose={handleDrawerClose}
	onclick={handleDrawerClick}
>
	<div
		class="resize-handle"
		class:resizing
		role="slider"
		aria-orientation="horizontal"
		aria-label={t('generatedImages.resizeHandle')}
		aria-valuemin={MIN_DRAWER_WIDTH}
		aria-valuemax={viewportWidth}
		aria-valuenow={Math.round(width ?? measuredWidth)}
		tabindex="0"
		onpointerdown={onResizeHandlePointerDown}
		onpointermove={onResizeHandlePointerMove}
		onpointerup={onResizeHandlePointerUp}
		onpointercancel={onResizeHandlePointerUp}
		onkeydown={onResizeHandleKeydown}
	></div>

	<div class="drawer-panel" inert={deleteCandidate !== null} aria-hidden={deleteCandidate !== null}>
		<header class="drawer-header">
			<div>
				<h2 id="scenes-title">{t('generatedImages.title')}</h2>
				<p>{t('generatedImages.subtitle')}</p>
			</div>
			<button
				type="button"
				class="close-button"
				aria-label={t('generatedImages.close')}
				title={t('generatedImages.close')}
				onclick={closeDrawer}
			>
				<X size={20} strokeWidth={1.8} aria-hidden="true" />
			</button>
		</header>

		<div class="drawer-content">
			{#if generatedImages.status === 'loading'}
				<p class="status">{t('generatedImages.loading')}</p>
			{:else if generatedImages.status === 'error' && generatedImages.images.length === 0}
				<p class="status error" role="alert">{t('generatedImages.failed')}</p>
			{:else if generatedImages.images.length === 0}
				<p class="status">{t('generatedImages.empty')}</p>
			{:else}
				<ul class="list" aria-label={t('generatedImages.listLabel')}>
					{#each generatedImages.images as image, index (image.id)}
						{const date = generatedDate(image.createdAt)}
						<li class="scene-card">
							<div class="scene-meta">
								<span class="generation-kind">{t(generationKindKeys[image.kind])}</span>
								<div class="scene-record-actions">
									<time class="date" datetime={date.datetime} aria-label={date.ariaLabel}>
										<span>{date.dateLabel}</span>
										<span>{date.timeLabel}</span>
									</time>
									<button
										type="button"
										class="record-delete-button"
										disabled={generatedImages.deletingIds.has(image.id)}
										aria-label={ti('generatedImages.delete', { order: index + 1 })}
										title={ti('generatedImages.delete', { order: index + 1 })}
										onclick={() => requestDelete(image.id, index + 1)}
									>
										<Trash2 size={16} strokeWidth={1.8} aria-hidden="true" />
									</button>
								</div>
							</div>

							<div class="scene-flow">
								<div class="image-column">
									<span class="image-label">{t('generatedImages.source')}</span>
									<div class="image-frame">
										<img
											src={image.sourceUrl}
											alt={ti('generatedImages.sourceImageAlt', { order: index + 1 })}
											loading="lazy"
										/>
										<div class="actions">
											<button
												type="button"
												class="icon-button"
												aria-label={ti('generatedImages.useSource', { order: index + 1 })}
												title={ti('generatedImages.useSource', { order: index + 1 })}
												onclick={() => useImage(image.sourceUrl, image.kind)}
											>
												<Pencil size={17} strokeWidth={1.8} aria-hidden="true" />
											</button>
											<button
												type="button"
												class="icon-button"
												aria-label={ti('generatedImages.downloadSource', { order: index + 1 })}
												title={ti('generatedImages.downloadSource', { order: index + 1 })}
												onclick={() => downloadImage(image.sourceUrl, `${image.id}-source`)}
											>
												<Download size={17} strokeWidth={1.8} aria-hidden="true" />
											</button>
										</div>
									</div>
								</div>

								<div class="flow-arrow" aria-hidden="true">
									<ArrowRight size={20} strokeWidth={1.8} />
								</div>

								<div class="image-column">
									<span class="image-label">{t('generatedImages.result')}</span>
									<div class="image-frame result-frame">
										<img
											src={image.url}
											alt={ti('generatedImages.resultImageAlt', { order: index + 1 })}
											loading="lazy"
										/>
										<div class="actions">
											<button
												type="button"
												class="icon-button"
												aria-label={ti('generatedImages.useResult', { order: index + 1 })}
												title={ti('generatedImages.useResult', { order: index + 1 })}
												onclick={() => useImage(image.url, image.kind)}
											>
												<Pencil size={17} strokeWidth={1.8} aria-hidden="true" />
											</button>
											<button
												type="button"
												class="icon-button"
												aria-label={ti('generatedImages.download', { order: index + 1 })}
												title={ti('generatedImages.download', { order: index + 1 })}
												onclick={() => downloadImage(image.url, image.id)}
											>
												<Download size={17} strokeWidth={1.8} aria-hidden="true" />
											</button>
										</div>
									</div>
								</div>
							</div>
						</li>
					{/each}
				</ul>

				{#if generatedImages.hasMore}
					<div class="load-more-sentinel" {@attach observeLoadMore}>
						{#if generatedImages.loadingMore}
							<p class="status" aria-live="polite">{t('generatedImages.loadingMore')}</p>
						{/if}
					</div>
				{/if}
				{#if generatedImages.status === 'error'}
					<p class="status error" role="alert">{t('generatedImages.failed')}</p>
				{/if}
				{#if generatedImages.deleteFailed}
					<p class="status error" role="alert">{t('generatedImages.deleteFailed')}</p>
				{/if}
			{/if}
		</div>
	</div>
</dialog>

{#if deleteCandidate}
	<dialog
		class="delete-dialog"
		{@attach openModal}
		aria-labelledby="generated-images-delete-title"
		aria-describedby="generated-images-delete-description generated-images-delete-warning"
		oncancel={handleDeleteCancel}
	>
		<h3 id="generated-images-delete-title">{t('generatedImages.confirmDeleteTitle')}</h3>
		<p id="generated-images-delete-description">
			{ti('generatedImages.confirmDeleteDescription', { order: deleteCandidate.order })}
		</p>
		<p id="generated-images-delete-warning" class="warning">
			{t('generatedImages.confirmDeleteWarning')}
		</p>
		<div class="dialog-actions">
			<button
				type="button"
				class="secondary-button"
				disabled={isDeletingCandidate}
				onclick={cancelDelete}
			>
				{t('generatedImages.confirmDeleteCancel')}
			</button>
			<button
				type="button"
				class="primary-danger-button"
				disabled={isDeletingCandidate}
				onclick={() => void confirmDelete()}
			>
				{isDeletingCandidate
					? t('generatedImages.confirmDeleteDeleting')
					: t('generatedImages.confirmDeleteConfirm')}
			</button>
		</div>
	</dialog>
{/if}

<style>
	.drawer {
		position: fixed;
		z-index: var(--z-scenes-panel);
		inset: 0 auto 0 0;
		width: min(46rem, 100vw);
		height: 100dvh;
		max-width: none;
		max-height: none;
		margin: 0;
		padding: 0;
		overflow: hidden;
		border: 0;
		border-right: 1px solid var(--color-border);
		background: var(--color-surface);
		box-shadow: 16px 0 40px rgb(29 29 31 / 0.14);
		opacity: 0;
		transform: translateX(-100%);
		transition:
			opacity 0.24s ease,
			transform 0.24s ease,
			display 0.24s allow-discrete,
			overlay 0.24s allow-discrete;
	}

	.resize-handle {
		position: absolute;
		top: 0;
		bottom: 0;
		right: 0;
		width: 8px;
		background: transparent;
		cursor: ew-resize;
		touch-action: none;
	}

	.resize-handle::after {
		content: '';
		position: absolute;
		top: 0;
		bottom: 0;
		left: 50%;
		width: 2px;
		transform: translateX(-50%);
		background: transparent;
		transition: background 0.15s;
	}

	.resize-handle:hover::after,
	.resize-handle:focus-visible::after,
	.resize-handle.resizing::after {
		background: var(--color-accent);
	}

	.resize-handle:focus-visible {
		outline: 2px solid var(--color-accent);
		outline-offset: -2px;
	}

	.drawer[open] {
		opacity: 1;
		transform: translateX(0);
	}

	@starting-style {
		.drawer[open] {
			opacity: 0;
			transform: translateX(-100%);
		}
	}

	.drawer::backdrop {
		background: rgb(29 29 31 / 0);
		transition:
			background 0.24s ease,
			display 0.24s allow-discrete,
			overlay 0.24s allow-discrete;
	}

	.drawer[open]::backdrop {
		background: rgb(29 29 31 / 0.24);
	}

	@starting-style {
		.drawer[open]::backdrop {
			background: rgb(29 29 31 / 0);
		}
	}

	.drawer-panel {
		height: 100%;
		display: flex;
		flex-direction: column;
	}

	.drawer-header {
		flex: 0 0 auto;
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
		padding: 1.25rem 1.5rem 1rem;
		border-bottom: 1px solid var(--color-border);
	}

	.drawer-header h2,
	.drawer-header p {
		margin: 0;
	}

	.drawer-header h2 {
		color: var(--color-text);
		font-size: 1.125rem;
		font-weight: 700;
		line-height: 1.35;
	}

	.drawer-header p {
		margin-top: 0.2rem;
		color: var(--color-muted);
		font-size: 0.8125rem;
		line-height: 1.4;
	}

	.close-button {
		flex: 0 0 auto;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 2.5rem;
		height: 2.5rem;
		padding: 0;
		border: 1px solid var(--color-border);
		border-radius: 50%;
		background: var(--color-background);
		color: var(--color-text);
		cursor: pointer;
		transition:
			background 0.15s,
			border-color 0.15s,
			color 0.15s;
	}

	.close-button:hover {
		background: var(--color-surface-hover);
		border-color: var(--color-accent);
		color: var(--color-accent);
	}

	.drawer-content {
		flex: 1 1 auto;
		min-height: 0;
		display: flex;
		flex-direction: column;
		gap: 1rem;
		padding: 1rem 1.5rem 1.5rem;
		overflow-y: auto;
		overscroll-behavior: contain;
	}

	.status {
		margin: 0;
		color: var(--color-muted);
		font-size: 0.875rem;
	}

	.error {
		color: var(--color-danger);
	}

	.list {
		display: flex;
		flex-direction: column;
		gap: 0.875rem;
		padding: 0;
		margin: 0;
		list-style: none;
	}

	.scene-card {
		display: flex;
		flex-direction: column;
		gap: 0.625rem;
		padding: 0.75rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		background: color-mix(in srgb, var(--color-background) 72%, var(--color-surface));
	}

	.scene-meta {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.625rem;
		flex-wrap: wrap;
	}

	.scene-record-actions {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.generation-kind {
		display: inline-flex;
		align-items: center;
		min-height: 1.5rem;
		padding: 0.2rem 0.5rem;
		border: 1px solid color-mix(in srgb, var(--color-accent) 24%, var(--color-border));
		border-radius: 999px;
		background: color-mix(in srgb, var(--color-accent) 7%, var(--color-surface));
		color: var(--color-accent);
		font-size: 0.6875rem;
		font-weight: 650;
		line-height: 1.1;
	}

	.date {
		display: flex;
		align-items: baseline;
		gap: 0.45rem;
		color: var(--color-muted);
		font-size: 0.75rem;
		line-height: 1.25;
	}

	.date span + span::before {
		content: '·';
		margin-right: 0.45rem;
	}

	.record-delete-button {
		flex: 0 0 auto;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 2rem;
		height: 2rem;
		padding: 0;
		border: 1px solid transparent;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--color-muted);
		cursor: pointer;
		transition:
			background 0.15s,
			border-color 0.15s,
			color 0.15s,
			opacity 0.15s;
	}

	.record-delete-button:hover {
		border-color: color-mix(in srgb, var(--color-danger) 32%, var(--color-border));
		background: color-mix(in srgb, var(--color-danger) 7%, var(--color-surface));
		color: var(--color-danger);
	}

	.record-delete-button:disabled {
		cursor: progress;
		opacity: 0.55;
	}

	.scene-flow {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 2.25rem minmax(0, 1fr);
		align-items: center;
		gap: 0.5rem;
	}

	.image-column {
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}

	.image-label {
		color: var(--color-muted);
		font-size: 0.6875rem;
		font-weight: 650;
		letter-spacing: 0.045em;
		line-height: 1.2;
		text-transform: uppercase;
	}

	.image-frame {
		position: relative;
		aspect-ratio: 16 / 9;
		overflow: hidden;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: #000;
	}

	.image-frame img {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: contain;
	}

	.flow-arrow {
		display: flex;
		align-items: center;
		justify-content: center;
		aspect-ratio: 1;
		margin-top: 1.2rem;
		border: 1px solid color-mix(in srgb, var(--color-accent) 24%, var(--color-border));
		border-radius: 50%;
		background: var(--color-surface);
		color: var(--color-accent);
	}

	.actions {
		position: absolute;
		top: 0.5rem;
		right: 0.5rem;
		display: flex;
		gap: 0.375rem;
		opacity: 0;
		pointer-events: none;
		transform: translateY(-0.25rem);
		transition:
			opacity 0.15s,
			transform 0.15s;
	}

	.image-frame:hover .actions,
	.image-frame:focus-within .actions {
		opacity: 1;
		pointer-events: auto;
		transform: translateY(0);
	}

	.icon-button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 2.125rem;
		height: 2.125rem;
		padding: 0;
		border: 1px solid rgb(255 255 255 / 0.68);
		border-radius: var(--radius-sm);
		background: rgb(255 255 255 / 0.92);
		color: var(--color-text);
		box-shadow: 0 2px 8px rgb(29 29 31 / 0.18);
		backdrop-filter: blur(8px);
		cursor: pointer;
		transition:
			background 0.15s,
			border-color 0.15s,
			color 0.15s;
	}

	.icon-button:hover {
		background: var(--color-surface);
		border-color: var(--color-accent);
		color: var(--color-accent);
	}

	.icon-button:disabled {
		cursor: progress;
		opacity: 0.55;
	}

	.load-more-sentinel {
		min-height: 2.5rem;
		display: flex;
		align-items: center;
	}

	.delete-dialog {
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

	.delete-dialog::backdrop {
		background: rgb(29 29 31 / 0.32);
		backdrop-filter: blur(4px);
	}

	h3 {
		margin: 0;
		color: var(--color-text);
		font-size: 1rem;
		font-weight: 650;
	}

	.delete-dialog p {
		margin: 0;
		color: var(--color-muted);
		font-size: 0.875rem;
		line-height: 1.4;
	}

	.delete-dialog .warning {
		color: var(--color-danger);
		font-weight: 600;
	}

	.dialog-actions {
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
			color 0.15s,
			opacity 0.15s;
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

	.secondary-button:disabled,
	.primary-danger-button:disabled {
		cursor: progress;
		opacity: 0.65;
	}

	@media (max-width: 960px) {
		.drawer {
			width: min(40rem, 100vw);
		}
	}

	@media (max-width: 540px) {
		.drawer {
			width: 100vw;
			border-right: 0;
		}

		.resize-handle {
			display: none;
		}

		.drawer-header {
			padding: 1rem;
		}

		.drawer-content {
			padding: 0.875rem 1rem 1rem;
		}

		.scene-card {
			padding: 0.625rem;
		}

		.scene-flow {
			grid-template-columns: minmax(0, 1fr) 1.75rem minmax(0, 1fr);
			gap: 0.375rem;
		}
	}

	@media (hover: none) {
		.actions {
			opacity: 1;
			pointer-events: auto;
			transform: none;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.drawer,
		.drawer::backdrop,
		.actions {
			transition: none;
		}
	}
</style>
