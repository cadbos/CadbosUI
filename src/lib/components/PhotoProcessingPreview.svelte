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
	import { onDestroy } from 'svelte';

	import ImageSkeleton from '$lib/components/ImageSkeleton.svelte';
	import RenderResult from '$lib/components/RenderResult.svelte';
	import { t } from '$lib/i18n/index.svelte';
	import { photoProcessing } from '$lib/state/photo-processing.svelte';
	import { request } from '$lib/state/request.svelte';

	const sourceUrl = $derived(photoProcessing.sourceUrl);
	function displayImage(host: HTMLDivElement): () => void {
		const readyImage = photoProcessing.previewImage;
		const source = sourceUrl;
		const alt = t('photoProcessing.previewAlt');
		let cancelled = false;
		if (readyImage) {
			readyImage.alt = alt;
			host.replaceChildren(readyImage);
		} else if (source) {
			const image = new Image();
			image.alt = alt;
			image.fetchPriority = 'high';
			image.src = source;
			void image.decode().then(
				() => {
					if (!cancelled) host.replaceChildren(image);
				},
				(error: unknown) => {
					if (!cancelled) photoProcessing.reportPreviewError(error);
				}
			);
		}
		return () => {
			cancelled = true;
		};
	}

	$effect(() => {
		const source = sourceUrl;
		const settings = { ...request.photoAdjustments };
		if (!source) return;
		photoProcessing.preview(source, settings);
	});

	onDestroy(() => photoProcessing.clearPreview());
</script>

<RenderResult photoProcessingMode>
	{#snippet imagePreview()}
		<div class="preview" aria-busy={photoProcessing.loading}>
			<div class="preview-image" {@attach displayImage}></div>
			{#if !sourceUrl}
				<ImageSkeleton />
			{/if}
			<div class="preview-status" role="status" aria-live="polite">
				{#if photoProcessing.loading && !photoProcessing.previewUrl}
					<span class="preview-label">{t('photoProcessing.previewLoading')}</span>
				{/if}
			</div>
		</div>
	{/snippet}
</RenderResult>

<style>
	.preview {
		position: relative;
		width: 100%;
		height: 100%;
	}

	.preview-image {
		width: 100%;
		height: 100%;
	}

	.preview-image :global(img) {
		width: 100%;
		height: 100%;
		object-fit: contain;
		display: block;
	}

	.preview-label {
		position: absolute;
		top: 0.875rem;
		left: 0.875rem;
		max-width: calc(100% - 1.75rem);
		padding: 0.375rem 0.625rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-surface);
		color: var(--color-text);
		font-size: 0.75rem;
		box-shadow: var(--shadow-sm);
	}

	.preview-status .preview-label {
		left: auto;
		right: 0.875rem;
	}
</style>
