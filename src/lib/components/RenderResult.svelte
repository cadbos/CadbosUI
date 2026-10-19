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
	import { sceneView } from '$lib/state/scene-view.svelte';
	import type { Snippet } from 'svelte';
	import SceneViewport from '$lib/components/SceneViewport.svelte';
	import CompareSlider from '$lib/components/CompareSlider.svelte';
	import LazyImage from '$lib/components/LazyImage.svelte';
	import RegionSelector from '$lib/components/RegionSelector.svelte';
	import { t } from '$lib/i18n/index.svelte';
	import { request } from '$lib/state/request.svelte';
	import { photoProcessing } from '$lib/state/photo-processing.svelte';
	import { mediaAccess } from '$lib/state/media-access.svelte';

	interface Props {
		naturalRatio?: number;
		regionTool?: 'repaint' | 'object-replacement';
		imagePreview?: Snippet;
		photoProcessingMode?: boolean;
	}

	let {
		regionTool = undefined,
		imagePreview,
		photoProcessingMode = false,
		naturalRatio
	}: Props = $props();

	let imageSize = $state<{ width: number; height: number } | null>(null);
	function rememberImageSize(image: HTMLImageElement): void {
		if (image.naturalWidth > 0 && image.naturalHeight > 0) {
			imageSize = { width: image.naturalWidth, height: image.naturalHeight };
		}
	}

	const render = $derived(request.currentRender);
	const imageUrl = $derived(render ? mediaAccess.get(render.outputKey)?.url : undefined);
	const afterImageUrl = $derived(
		photoProcessingMode ? (photoProcessing.previewUrl ?? imageUrl) : imageUrl
	);
	const beforeImageUrl = $derived(
		request.previousRender ? mediaAccess.get(request.previousRender.outputKey)?.url : undefined
	);
</script>

{#if imagePreview || (render && imageUrl)}
	<section class="result">
		<div class="image-card">
			<SceneViewport
				source={request.workingImageKey() ?? request.pendingImagePreviewUrl}
				imageRatio={naturalRatio ?? (imageSize ? imageSize.width / imageSize.height : undefined)}
				interactive={Boolean(regionTool) || sceneView.comparing}
				reserveControls={Boolean(regionTool)}
			>
				{#if sceneView.comparing && beforeImageUrl && afterImageUrl}
					<CompareSlider
						beforeSrc={beforeImageUrl}
						afterSrc={afterImageUrl}
						beforeAlt={t('toolbar.before')}
						afterAlt={t('toolbar.after')}
						handleLabel={t('toolbar.compare')}
					/>
				{:else if imagePreview}
					{@render imagePreview()}
				{:else if imageUrl}
					<LazyImage
						src={imageUrl}
						alt={t('render.generate')}
						imgClass="output"
						loading="eager"
						fetchPriority="high"
						onReady={rememberImageSize}
					/>
					{#if regionTool && imageSize}
						<RegionSelector
							region={regionTool === 'repaint'
								? request.activeRepaintRegion()
								: request.activeObjectReplacementRegion()}
							naturalWidth={imageSize.width}
							naturalHeight={imageSize.height}
							boxLabel={t(
								regionTool === 'repaint'
									? 'repaint.region.boxLabel'
									: 'objectReplacement.region.boxLabel'
							)}
							onchange={(region) =>
								regionTool === 'repaint'
									? request.setRepaintRegion(region)
									: request.setObjectReplacementRegion(region)}
						/>
					{/if}
				{/if}
			</SceneViewport>
		</div>
	</section>
{/if}

<style>
	.result {
		height: 100%;
		min-height: 0;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		overflow: hidden;
		background: var(--color-background);
	}
	.image-card {
		--image-fit: contain;
		position: relative;
		width: 100%;
		height: 100%;
		min-height: 0;
	}
</style>
