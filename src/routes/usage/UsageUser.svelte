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
	import { npubEncode } from 'nostr-tools/nip19';
	import type { UsageProfile } from '$lib/api/contract';
	import LazyImage from '$lib/components/LazyImage.svelte';
	import { ti } from '$lib/i18n/index.svelte';
	import { userUsageHref } from './usage-day';

	interface Props {
		pubkey: string;
		profile: UsageProfile | undefined;
		pubkeyViewer: string;
	}

	let { pubkey, profile, pubkeyViewer }: Props = $props();

	let failedPicture = $state<string | null>(null);
	const npub = $derived(npubEncode(pubkey));
	const label = $derived(profile?.name ?? npub);
	const picture = $derived(profile?.picture === failedPicture ? undefined : profile?.picture);
	const shortKey = $derived(`…${npub.slice(-5)}`);
</script>

<span class="user-identity" title={npub}>
	<a
		class="avatar-link"
		href={pubkeyViewer.replaceAll('{}', npub)}
		target="_blank"
		rel="external noopener noreferrer"
		aria-label={ti('usage.user.profileLink', { user: label })}
	>
		{#if picture}
			<LazyImage
				src={picture}
				alt=""
				decorative
				fetchPriority="low"
				onError={() => (failedPicture = picture ?? null)}
			/>
		{:else}
			<span class="avatar" aria-hidden="true">{[...label][0]?.toUpperCase()}</span>
		{/if}
	</a>
	<a class="key" href={userUsageHref(npub)}>{shortKey}</a>
</span>

<style>
	.user-identity {
		--image-width: 2rem;
		--image-height: 2rem;
		--image-radius: 50%;
		--image-fit: cover;
		--image-flex: 0 0 auto;
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		white-space: nowrap;
		font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
	}

	.avatar-link {
		display: inline-flex;
		border-radius: 50%;
	}

	.avatar {
		display: grid;
		place-items: center;
		width: 2rem;
		height: 2rem;
		border-radius: 50%;
		flex: 0 0 auto;
		color: var(--color-accent-contrast);
		background: var(--color-accent);
		font-family: inherit;
		font-weight: 700;
	}

	a.key {
		color: var(--color-accent-text);
		text-decoration: underline;
		text-underline-offset: 0.15em;
	}

	a.key:hover {
		color: var(--color-accent-hover);
	}
</style>
