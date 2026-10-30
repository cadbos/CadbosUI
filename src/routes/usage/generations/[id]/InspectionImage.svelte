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
	import type { ImageRegion } from '$lib/image-region';
	import LazyImage from '$lib/components/LazyImage.svelte';
	import { t } from '$lib/i18n/index.svelte';

	let {
		src,
		alt,
		region = null
	}: { src: string | null; alt: string; region?: ImageRegion | null } = $props();
	let loaded = $state<{ src: string; ratio: number } | null>(null);
	let failed = $state<string | null>(null);
	const ratio = $derived(loaded?.src === src ? loaded.ratio : 4 / 3);
	function rememberImage(image: HTMLImageElement): void {
		if (image.naturalWidth > 0 && image.naturalHeight > 0)
			loaded = {
				src: image.getAttribute('src') ?? image.currentSrc,
				ratio: image.naturalWidth / image.naturalHeight
			};
	}
</script>

{#if src && failed !== src}
	<div class="inspection-image" style:aspect-ratio={ratio}>
		<LazyImage
			{src}
			{alt}
			loading="eager"
			onReady={rememberImage}
			onError={() => {
				failed = src;
			}}
		/>
		{#if region}
			<div
				class="saved-region"
				role="img"
				aria-label={t('adminGeneration.region')}
				style:left={`${region.x * 100}%`}
				style:top={`${region.y * 100}%`}
				style:width={`${region.width * 100}%`}
				style:height={`${region.height * 100}%`}
			></div>
		{/if}
	</div>
{:else}
	<p class="unavailable">{t('adminGeneration.imageUnavailable')}</p>
{/if}

<style>
	.inspection-image {
		position: relative;
		width: 100%;
		overflow: hidden;
		border-radius: var(--radius-sm);
		background: var(--color-background);
	}
	.saved-region {
		position: absolute;
		box-sizing: border-box;
		border: 2px solid var(--color-primary, #6d5dfc);
		background: rgb(109 93 252 / 12%);
		pointer-events: none;
	}
	.unavailable {
		margin: 0;
		padding: 1rem;
		color: var(--color-muted);
	}
</style>
