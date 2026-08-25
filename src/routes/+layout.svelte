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
	import { ArrowUpRight } from '@lucide/svelte';
	import { onMount, type Snippet } from 'svelte';
	import '../app.css';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import favicon from '$lib/assets/favicon.svg';
	import AuthBar from '$lib/components/AuthBar.svelte';
	import GenerationOverlay from '$lib/components/GenerationOverlay.svelte';
	import Workspace from '$lib/components/Workspace.svelte';
	import { hydrateLocale, t } from '$lib/i18n/index.svelte';
	import { auth } from '$lib/state/auth.svelte';
	import { currency } from '$lib/state/currency.svelte';
	import { status } from '$lib/state/status.svelte';
	import { theme } from '$lib/state/theme.svelte';
	import { isWorkspaceRoute } from '$lib/state/url-state';
	import { restorePersistedTabs } from '$lib/state/workspace-tabs.svelte';
	import { logBoundaryError } from '$lib/utils';

	// children() renders whichever leaf +page.svelte matched the URL — those are
	// intentionally empty (see src/routes/create/[scene=scene]/+page.svelte): the
	// workspace itself lives here, in the layout, so it stays mounted (and its
	// UI state intact) while the user navigates between mode/scene routes.
	let { children }: { children: Snippet } = $props();

	// Standalone pages outside the three-tab workspace (e.g. '/usage') must not
	// mount it: Workspace derives its mode from the route id, defaulting to
	// 'render' for anything it doesn't recognize, and its URL-sync effect would
	// then "correct" that unrecognized address back to /render/*.
	const showWorkspace = $derived(isWorkspaceRoute(page.route.id));
	const showHealthWarning = $derived(
		page.route.id !== '/status' && status.snapshot?.status === 'unhealthy'
	);

	onMount(() => {
		auth.loadSession();
		void status.checkOnce();
		hydrateLocale();
		theme.hydrate();
		currency.hydrate();
		// Started here, not in Workspace.svelte, so a reload on any route (not
		// just /create|/edit|/style-transfer) re-opens every previously open
		// project/session tab before the user can act on a stale, empty one —
		// e.g. clicking "Continue" on /projects/[id] right after a reload.
		restorePersistedTabs().catch((error: unknown) =>
			logBoundaryError('layout.restorePersistedTabs', error)
		);
		window.dispatchEvent(new CustomEvent('cadbos:client-ready'));
	});
</script>

<svelte:head>
	<title>{t('app.title')}</title>
	<link rel="icon" href={favicon} />
	<link rel="apple-touch-icon" href="/apple-touch-icon.png" />
	<link rel="manifest" href="/manifest.webmanifest" />
	<meta name="theme-color" content="#2f6f4f" />
</svelte:head>

{#if showHealthWarning}
	<div class="health-warning" role="alert">
		<p>
			{t('health.warning')}
			<a href={resolve('/status', {})} target="_blank" rel="noopener noreferrer">
				{t('health.statusPage')}
				<ArrowUpRight size={16} strokeWidth={1.8} aria-hidden="true" />
			</a>
		</p>
	</div>
{/if}

<header class="app-header">
	<a class="brand" href={resolve('/', {})}>
		<img class="brand-mark" src={favicon} alt="" />
		<div class="brand-copy">
			<h1 class="brand-title">{t('app.title')}</h1>
			<p class="brand-subtitle">{t('app.subtitle')}</p>
		</div>
	</a>
	<div class="header-actions">
		<AuthBar />
	</div>
</header>

{#if showWorkspace}
	<Workspace />
{/if}

{@render children()}

<GenerationOverlay />

<style>
	.health-warning {
		width: 100%;
		padding: 0.625rem clamp(1rem, 3vw, 2rem);
		background: var(--color-warning-bg);
		color: var(--color-warning-text);
		font-size: 0.875rem;
		line-height: 1.4;
		text-align: center;
	}

	.health-warning p {
		margin: 0;
	}

	.health-warning a {
		display: inline-flex;
		align-items: center;
		gap: 0.2rem;
		color: inherit;
		font-weight: 700;
		text-underline-offset: 0.15em;
	}

	.app-header {
		position: sticky;
		top: 0;
		/* Above the workspace's floating panels (--z-tools-panel: 10,
		   --z-scenes-panel: 20) so header dropdowns (e.g. the auth profile
		   panel) are never occluded by workspace content underneath. */
		z-index: 30;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
		padding: 0.875rem clamp(1rem, 3vw, 2rem);
		background: color-mix(in srgb, var(--color-surface) 92%, transparent);
		border-bottom: 1px solid var(--color-border);
		backdrop-filter: blur(14px);
	}

	.brand {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		min-width: 0;
		color: inherit;
		text-decoration: none;
	}

	.brand-mark {
		width: 2.5rem;
		height: 2.5rem;
		object-fit: contain;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-surface);
		flex: 0 0 auto;
	}

	.brand-copy {
		min-width: 0;
	}

	.header-actions {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.brand-title,
	.brand-subtitle {
		margin: 0;
	}

	.brand-title {
		font-size: 1rem;
		font-weight: 700;
		line-height: 1.2;
		color: var(--color-text);
	}

	.brand-subtitle {
		max-width: 42rem;
		font-size: 0.8125rem;
		line-height: 1.35;
		color: var(--color-muted);
	}

	@media (max-width: 720px) {
		.app-header {
			align-items: flex-start;
			flex-direction: column;
		}
	}
</style>
