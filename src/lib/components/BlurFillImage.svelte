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

	interface Props {
		src: string;
		alt: string;
		loading?: 'lazy' | 'eager';
		fetchPriority?: 'high' | 'low' | 'auto';
	}

	let { src, alt, loading = 'lazy', fetchPriority }: Props = $props();

	let loadedUrl = $state<string | null>(null);
	let failedUrl = $state<string | null>(null);
	const ready = $derived(loadedUrl === src);
	const failed = $derived(!ready && failedUrl === src);

	function watchPhoto(node: HTMLImageElement): () => void {
		const current = src;
		return bindImageLoad(node, {
			onReady: () => {
				loadedUrl = current;
			},
			onError: () => {
				failedUrl = current;
			}
		});
	}
</script>

<span class="blur-fill" class:ready>
	{#if !ready}
		<ImageSkeleton quiet={failed} />
	{/if}
	<img
		class="backdrop"
		class:failed
		{src}
		alt=""
		{loading}
		decoding="async"
		fetchpriority={fetchPriority}
		aria-hidden="true"
	/>
	<img
		class="photo"
		class:failed
		{src}
		{alt}
		{loading}
		decoding="async"
		fetchpriority={fetchPriority}
		{@attach watchPhoto}
	/>
</span>

<style>
	/* Fills whatever box its parent sets (aspect ratio, rounding, overflow).
	   The photo is shown whole — cropping a thumbnail would hide edges where an
	   edit may have happened — and the letterbox space around it is filled with
	   a blurred, enlarged copy of the same image (served from the browser
	   cache) instead of empty bars. */
	.blur-fill {
		position: relative;
		display: block;
		width: 100%;
		height: 100%;
		overflow: hidden;
		background: var(--color-skeleton);
	}

	.blur-fill.ready {
		background: transparent;
	}

	img {
		position: absolute;
		inset: 0;
		display: block;
		width: 100%;
		height: 100%;
	}

	/* Scaled up so the blur's transparent fringe falls outside the box. */
	.backdrop {
		object-fit: cover;
		filter: blur(20px) brightness(0.85);
		transform: scale(1.15);
	}

	.photo {
		object-fit: contain;
	}

	img.failed {
		opacity: 0;
	}
</style>
