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
	import { MessageSquareText } from '@lucide/svelte';
	import { onMount } from 'svelte';
	import Featurebase, {
		clearConfig,
		destroyFeedback,
		initFeedback,
		shutdown
	} from 'featurebase-js';
	import '../app.css';
	import { page } from '$app/state';
	import favicon from '$lib/assets/favicon.svg';
	import AuthBar from '$lib/components/AuthBar.svelte';
	import Workspace from '$lib/components/Workspace.svelte';
	import { getLocale, t } from '$lib/i18n/index.svelte';
	import { auth } from '$lib/state/auth.svelte';
	import { isWorkspaceRoute } from '$lib/state/url-state';
	import type { LayoutProps } from './$types';

	// children() renders whichever leaf +page.svelte matched the URL — those are
	// intentionally empty (see src/routes/create/[scene=scene]/+page.svelte): the
	// workspace itself lives here, in the layout, so it stays mounted (and its
	// UI state intact) while the user navigates between mode/scene routes.
	let { children, data }: LayoutProps = $props();
	let featurebaseReady = $state(false);
	let configuredJwt: string | null = null;

	// Standalone pages outside the three-tab workspace (e.g. '/usage') must not
	// mount it: Workspace derives its mode from the route id, defaulting to
	// 'render' for anything it doesn't recognize, and its URL-sync effect would
	// then "correct" that unrecognized address back to /render/*.
	const showWorkspace = $derived(isWorkspaceRoute(page.route.id));

	function initializeFeaturebase(featurebaseJwt: string | null, clearIdentity = false): void {
		if (!data.featurebaseAppId) return;

		destroyFeedback();
		if (clearIdentity) {
			shutdown();
			clearConfig();
		}

		Featurebase({
			appId: data.featurebaseAppId,
			...(featurebaseJwt === null ? {} : { featurebaseJwt })
		});
		initFeedback({ theme: 'light', locale: getLocale() });
		configuredJwt = featurebaseJwt;
	}

	$effect(() => {
		const featurebaseJwt = auth.featurebaseJwt;
		if (!featurebaseReady || featurebaseJwt === configuredJwt) return;
		initializeFeaturebase(featurebaseJwt, featurebaseJwt === null);
	});

	onMount(() => {
		let disposed = false;

		void auth.loadSession().then(() => {
			if (disposed || !data.featurebaseAppId) return;
			initializeFeaturebase(auth.featurebaseJwt);
			featurebaseReady = true;
		});

		return () => {
			disposed = true;
			featurebaseReady = false;
			if (!data.featurebaseAppId) return;
			destroyFeedback();
			shutdown();
			clearConfig();
		};
	});
</script>

<svelte:head>
	<title>{t('app.title')}</title>
	<link rel="icon" href={favicon} />
	<link rel="apple-touch-icon" href="/apple-touch-icon.png" />
	<link rel="manifest" href="/manifest.webmanifest" />
	<meta name="theme-color" content="#2f6f4f" />
</svelte:head>

<header class="app-header">
	<div class="brand">
		<img class="brand-mark" src={favicon} alt="" />
		<div class="brand-copy">
			<h1 class="brand-title">{t('app.title')}</h1>
			<p class="brand-subtitle">{t('app.subtitle')}</p>
		</div>
	</div>
	<AuthBar />
</header>

{#if showWorkspace}
	<Workspace />
{/if}

{@render children()}

{#if data.featurebaseAppId}
	<button
		type="button"
		class="feedback-trigger"
		data-featurebase-feedback
		aria-label={t('feedback.open')}
	>
		<MessageSquareText size={20} aria-hidden="true" />
		<span>{t('feedback.open')}</span>
	</button>
{/if}

<style>
	.app-header {
		position: sticky;
		top: 0;
		z-index: 10;
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

	.feedback-trigger {
		position: fixed;
		right: var(--space-3);
		bottom: var(--space-3);
		z-index: 10;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-1);
		min-height: 3rem;
		padding: 0.75rem var(--space-2);
		font: inherit;
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--color-accent-contrast);
		background: var(--color-accent);
		border: 1px solid var(--color-accent);
		border-radius: var(--radius-xl);
		box-shadow: var(--shadow-lg);
		cursor: pointer;
		transition:
			background 0.15s,
			transform 0.1s,
			box-shadow 0.15s;
	}

	.feedback-trigger:hover {
		background: var(--color-accent-hover);
		box-shadow: var(--shadow-md);
		transform: translateY(-1px);
	}

	.feedback-trigger:active {
		transform: translateY(0);
	}

	@media (max-width: 640px) {
		.feedback-trigger {
			right: var(--space-2);
			bottom: var(--space-2);
			width: 3rem;
			padding: 0;
		}

		.feedback-trigger span {
			display: none;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.feedback-trigger {
			transition: none;
		}
	}
</style>
