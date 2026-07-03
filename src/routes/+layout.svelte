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
	import { onMount } from 'svelte';
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import AuthBar from '$lib/components/AuthBar.svelte';
	import { t } from '$lib/i18n/index.svelte';
	import { auth } from '$lib/state/auth.svelte';

	let { children } = $props();

	onMount(() => {
		auth.loadSession();
	});
</script>

<svelte:head>
	<title>{t('app.title')}</title>
	<link rel="icon" href={favicon} />
</svelte:head>

<header class="app-header">
	<AuthBar />
</header>

{@render children()}

<style>
	.app-header {
		display: flex;
		justify-content: flex-end;
		padding: var(--space-2);
		border-bottom: 1px solid var(--color-border);
	}
</style>
