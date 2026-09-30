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
	import { Images, Layers } from '@lucide/svelte';
	import { ti } from '$lib/i18n/index.svelte';

	interface Props {
		sessionCount: number;
		generationCount: number;
	}

	let { sessionCount, generationCount }: Props = $props();
</script>

<span class="project-stats">
	<span class="stat">
		<Layers size={14} strokeWidth={1.8} aria-hidden="true" />
		{ti('projects.stats.sessions', { count: sessionCount })}
	</span>
	<span class="stat">
		<Images size={14} strokeWidth={1.8} aria-hidden="true" />
		{ti('projects.stats.generations', { count: generationCount })}
	</span>
</span>

<style>
	.project-stats {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 0.875rem;
		color: var(--color-muted);
		font-size: 0.8125rem;
		font-variant-numeric: tabular-nums;
	}

	.stat {
		display: inline-flex;
		align-items: center;
		gap: 0.3125rem;
	}
</style>
