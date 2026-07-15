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
	import { page } from '$app/state';
	import favicon from '$lib/assets/favicon.svg';
	import AuthBar from '$lib/components/AuthBar.svelte';
	import Workspace from '$lib/components/Workspace.svelte';
	import { t } from '$lib/i18n/index.svelte';
	import { auth } from '$lib/state/auth.svelte';
	import { isWorkspaceRoute } from '$lib/state/url-state';

	// children() renders whichever leaf +page.svelte matched the URL — those are
	// intentionally empty (see src/routes/render/[scene=scene]/+page.svelte): the
	// workspace itself lives here, in the layout, so it stays mounted (and its
	// UI state intact) while the user navigates between mode/scene routes.
	let { children } = $props();

	// Standalone pages outside the three-tab workspace (e.g. '/usage') must not
	// mount it: Workspace derives its mode from the route id, defaulting to
	// 'render' for anything it doesn't recognize, and its URL-sync effect would
	// then "correct" that unrecognized address back to /render/*.
	const showWorkspace = $derived(isWorkspaceRoute(page.route.id));

	onMount(() => {
		auth.loadSession();
	});
</script>

<svelte:head>
	<title>{t('app.title')}</title>
	<link rel="icon" href={favicon} />
	<link rel="manifest" href="/manifest.webmanifest" />
	<meta name="theme-color" content="#ff3e00" />
</svelte:head>

<header class="app-header">
	<AuthBar />
</header>

{#if showWorkspace}
	<Workspace />
{/if}

{@render children()}

<style>
	.app-header {
		display: flex;
		justify-content: flex-end;
		padding: var(--space-2);
		border-bottom: 1px solid var(--color-border);
	}
</style>
