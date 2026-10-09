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
	import { bindImageLoad } from '$lib/bind-image-load';
	import ImageSkeleton from '$lib/components/ImageSkeleton.svelte';
	import { revealNearScrollParent } from '$lib/reveal-near-scroll-parent';

	interface Props {
		src: string;
		alt: string;
		loading?: 'lazy' | 'eager';
		fetchPriority?: 'high' | 'low' | 'auto';
		draggable?: boolean;
		class?: string;
		imgClass?: string;
		decorative?: boolean;
		bleed?: boolean;
		onReady?: (image: HTMLImageElement) => void;
		onError?: () => void;
	}

	let {
		src,
		alt,
		loading = 'lazy',
		fetchPriority,
		draggable = true,
		class: className = '',
		imgClass = '',
		decorative = false,
		bleed = false,
		onReady,
		onError
	}: Props = $props();

	let loadedUrl = $state<string | null>(null);
	let failedUrl = $state<string | null>(null);
	let visible = $state(false);
	const ready = $derived(loadedUrl === src);
	const failed = $derived(!ready && failedUrl === src);

	function reveal(node: HTMLElement): () => void {
		if (loading === 'eager') {
			visible = true;
			return () => {};
		}
		return revealNearScrollParent(node, () => {
			visible = true;
		});
	}

	function watch(node: HTMLImageElement): () => void {
		const current = src;
		return bindImageLoad(node, {
			onReady: (image) => {
				loadedUrl = current;
				onReady?.(image);
			},
			onError: () => {
				failedUrl = current;
				onError?.();
			}
		});
	}
</script>

<span class="frame {className}" class:ready class:bleed {@attach reveal}>
	{#if !ready}
		<ImageSkeleton quiet={failed} />
	{/if}
	{#if visible}
		<img
			{src}
			alt={decorative ? '' : alt}
			{loading}
			decoding="async"
			fetchpriority={fetchPriority}
			draggable={draggable ? 'true' : 'false'}
			aria-hidden={decorative ? 'true' : undefined}
			class={imgClass}
			class:failed
			{@attach watch}
		/>
	{/if}
</span>

<style>
	.frame {
		position: relative;
		display: block;
		width: var(--image-width, 100%);
		height: var(--image-height, 100%);
		max-height: var(--image-max-height, none);
		aspect-ratio: var(--image-ratio, auto);
		border-radius: var(--image-radius, 0);
		overflow: hidden;
		flex: var(--image-flex, initial);
		background: var(--image-bg, transparent);
	}

	.frame.ready {
		min-height: 0;
	}

	.frame:not(.ready) {
		min-height: var(--image-min-height, 0);
		background: var(--color-skeleton);
	}

	.frame.bleed:not(.ready) {
		position: static;
		overflow: visible;
		border-radius: inherit;
	}

	img {
		position: var(--image-position, absolute);
		inset: 0;
		display: block;
		width: 100%;
		height: var(--image-img-height, 100%);
		max-height: var(--image-max-height, none);
		object-fit: var(--image-fit, contain);
	}

	img.failed {
		opacity: 0;
	}
</style>
