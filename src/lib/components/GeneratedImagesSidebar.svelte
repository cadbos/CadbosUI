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
	import { Download, Trash2 } from '@lucide/svelte';
	import { getLocale, t, ti } from '$lib/i18n/index.svelte';
	import { generatedImages } from '$lib/state/generated-images.svelte';

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

	let deleteCandidate = $state<DeleteCandidate | null>(null);
	let sidebarContent = $state<HTMLElement | null>(null);
	let loadMoreSentinel = $state<HTMLElement | null>(null);
	const isDeletingCandidate = $derived(
		deleteCandidate ? generatedImages.deletingIds.has(deleteCandidate.id) : false
	);

	$effect(() => {
		const root = sidebarContent;
		const sentinel = loadMoreSentinel;
		if (!root || !sentinel || !generatedImages.hasMore) return;

		const observer = new IntersectionObserver(
			(entries) => {
				if (entries.some((entry) => entry.isIntersecting)) void generatedImages.loadMore();
			},
			{ root, rootMargin: '0px 0px 160px 0px' }
		);
		observer.observe(sentinel);

		return () => observer.disconnect();
	});

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

	function handleDialogKeydown(event: KeyboardEvent): void {
		if (event.key === 'Escape') cancelDelete();
	}
</script>

<aside
	class="sidebar"
	class:modal-open={deleteCandidate !== null}
	aria-labelledby="generated-images-title"
>
	<div
		class="sidebar-content"
		class:content-blurred={deleteCandidate !== null}
		bind:this={sidebarContent}
		inert={deleteCandidate !== null}
		aria-hidden={deleteCandidate !== null}
	>
		<div class="header">
			<h2 id="generated-images-title">{t('generatedImages.title')}</h2>
		</div>

		{#if generatedImages.status === 'loading'}
			<p class="status">{t('generatedImages.loading')}</p>
		{:else if generatedImages.status === 'error' && generatedImages.images.length === 0}
			<p class="status error" role="alert">{t('generatedImages.failed')}</p>
		{:else if generatedImages.images.length === 0}
			<p class="status">{t('generatedImages.empty')}</p>
		{:else}
			<ul class="list" aria-label={t('generatedImages.listLabel')}>
				{#each generatedImages.images as image, index (image.id)}
					{@const date = generatedDate(image.createdAt)}
					<li class="item">
						<img
							class="thumb"
							src={image.url}
							alt={ti('generatedImages.imageAlt', { order: index + 1 })}
							loading="lazy"
						/>
						<div class="details">
							<time class="date" datetime={date.datetime} aria-label={date.ariaLabel}>
								<span>{date.dateLabel}</span>
								<span>{date.timeLabel}</span>
							</time>
							<div class="actions">
								<button
									type="button"
									class="icon-button"
									aria-label={ti('generatedImages.download', { order: index + 1 })}
									title={ti('generatedImages.download', { order: index + 1 })}
									onclick={() => downloadImage(image.url, image.id)}
								>
									<Download size={16} strokeWidth={1.8} aria-hidden="true" />
								</button>
								<button
									type="button"
									class="icon-button danger"
									disabled={generatedImages.deletingIds.has(image.id)}
									aria-label={ti('generatedImages.delete', { order: index + 1 })}
									title={ti('generatedImages.delete', { order: index + 1 })}
									onclick={() => requestDelete(image.id, index + 1)}
								>
									<Trash2 size={16} strokeWidth={1.8} aria-hidden="true" />
								</button>
							</div>
						</div>
					</li>
				{/each}
			</ul>
			{#if generatedImages.hasMore}
				<div bind:this={loadMoreSentinel} class="load-more-sentinel">
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

	{#if deleteCandidate}
		<div class="dialog-overlay">
			<dialog
				class="delete-dialog"
				open
				aria-modal="true"
				aria-labelledby="generated-images-delete-title"
				aria-describedby="generated-images-delete-description generated-images-delete-warning"
				onkeydown={handleDialogKeydown}
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
		</div>
	{/if}
</aside>

<style>
	.sidebar {
		width: min(100%, 368px);
		display: flex;
		flex-direction: column;
		gap: 1rem;
		padding: 1.25rem;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow);
		align-self: flex-start;
		position: sticky;
		top: 1rem;
		max-height: calc(100dvh - 2rem);
		overflow: auto;
	}

	.sidebar.modal-open {
		overflow: hidden;
	}

	.sidebar-content {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		transition:
			filter 0.15s,
			opacity 0.15s;
	}

	.content-blurred {
		filter: blur(0.25rem);
		opacity: 0.42;
		pointer-events: none;
		user-select: none;
	}

	.header {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	h2 {
		margin: 0;
		font-size: 1rem;
		font-weight: 650;
		color: var(--color-text);
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
		gap: 0.625rem;
		padding: 0;
		margin: 0;
		list-style: none;
	}

	.item {
		display: grid;
		grid-template-columns: 4.5rem minmax(0, 1fr);
		align-items: stretch;
		gap: 0.75rem;
		padding: 0.5rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-background);
	}

	.thumb {
		display: block;
		width: 100%;
		height: 100%;
		min-height: 4.5rem;
		overflow: hidden;
		border-radius: var(--radius-sm);
		object-fit: cover;
	}

	.details {
		min-width: 0;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.5rem;
	}

	.date {
		display: flex;
		flex-direction: column;
		color: var(--color-muted);
		font-size: 0.8125rem;
		line-height: 1.25;
		overflow-wrap: anywhere;
	}

	.actions {
		display: flex;
		justify-content: flex-start;
		gap: 0.375rem;
	}

	.icon-button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 2.25rem;
		height: 2.25rem;
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

	.icon-button:hover {
		background: var(--color-surface-hover);
		border-color: var(--color-accent);
		color: var(--color-accent);
	}

	.icon-button:disabled {
		cursor: progress;
		opacity: 0.55;
	}

	.danger:hover {
		border-color: var(--color-danger);
		color: var(--color-danger);
	}

	.dialog-overlay {
		position: absolute;
		inset: 0;
		z-index: 2;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1rem;
		background: color-mix(in srgb, var(--color-surface) 58%, transparent);
	}

	.delete-dialog {
		width: min(100%, 17.5rem);
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		max-width: none;
		margin: 0;
		padding: 1rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-surface);
		box-shadow: var(--shadow);
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

	.load-more-sentinel {
		min-height: 2.5rem;
		display: flex;
		align-items: center;
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
		.sidebar {
			width: 100%;
			max-height: none;
			position: static;
			align-self: stretch;
		}
	}
</style>
