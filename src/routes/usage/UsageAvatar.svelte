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
	import type { UsageProfile } from '$lib/api/contract';
	import LazyImage from '$lib/components/LazyImage.svelte';

	interface Props {
		profile: UsageProfile | null | undefined;
		// Spelled out by the first letter when the profile has no usable picture.
		label: string;
	}

	let { profile, label }: Props = $props();

	let failedPicture = $state<string | null>(null);
	const picture = $derived(profile?.picture === failedPicture ? undefined : profile?.picture);
</script>

<span class="usage-avatar">
	{#if picture}
		<LazyImage
			src={picture}
			alt=""
			decorative
			fetchPriority="low"
			onError={() => (failedPicture = picture ?? null)}
		/>
	{:else}
		<span class="initial" aria-hidden="true">{[...label][0]?.toUpperCase()}</span>
	{/if}
</span>

<style>
	.usage-avatar {
		--image-width: 2rem;
		--image-height: 2rem;
		--image-radius: 50%;
		--image-fit: cover;
		--image-flex: 0 0 auto;
		display: inline-flex;
		flex: 0 0 auto;
		border-radius: 50%;
	}

	.initial {
		display: grid;
		place-items: center;
		width: 2rem;
		height: 2rem;
		border-radius: 50%;
		color: var(--color-accent-contrast);
		background: var(--color-accent);
		font-weight: 700;
	}
</style>
