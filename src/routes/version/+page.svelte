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

	import { version as commitSha } from '$app/environment';
	import { t } from '$lib/i18n/index.svelte';

	const shortCommitSha = commitSha.slice(0, 7);
	const currentVersion = __APP_IS_PREVIEW__ ? shortCommitSha : __APP_VERSION__;
	const currentVersionUrl = __APP_IS_PREVIEW__ ? __APP_COMMIT_URL__ : __APP_RELEASE_URL__;
</script>

<svelte:head>
	<title>{t('version.title')}</title>
</svelte:head>

<main class="version-page" aria-labelledby="version-title">
	<section class="version-shell">
		<header class="version-header">
			<h1 id="version-title">{t('version.title')}</h1>
			<p>{t('version.subtitle')}</p>
		</header>

		<div class="current-version">
			<div class="current-version-labels">
				<p class="current-version-label">{t('version.current')}</p>
				<p class="current-version-stage">
					{t(__APP_IS_PREVIEW__ ? 'version.preview' : 'version.stable')}
				</p>
			</div>
			<a
				class="metadata-link"
				href={currentVersionUrl}
				title={currentVersionUrl}
				target="_blank"
				rel="external noopener noreferrer"
			>
				<code>{currentVersion}</code>
				<ArrowUpRight size={16} strokeWidth={1.8} aria-hidden="true" />
			</a>
		</div>

		<dl class="version-details">
			<div>
				<dt>{t('version.package')}</dt>
				<dd><code>{__APP_NAME__}</code></dd>
			</div>
			<div>
				<dt>{t('version.buildRevision')}</dt>
				<dd>
					<a
						class="metadata-link"
						href={__APP_COMMIT_URL__}
						title={__APP_COMMIT_URL__}
						target="_blank"
						rel="external noopener noreferrer"
					>
						<code>{shortCommitSha}</code>
						<ArrowUpRight size={16} strokeWidth={1.8} aria-hidden="true" />
					</a>
				</dd>
			</div>
			<div class="wide-detail">
				<dt>{t('version.builtAt')}</dt>
				<dd>
					<time datetime={__APP_BUILD_TIMESTAMP__}><code>{__APP_BUILD_TIMESTAMP__}</code></time>
				</dd>
			</div>
		</dl>
	</section>
</main>

<style>
	.version-page {
		width: 100%;
		min-height: calc(100dvh - 4.5rem);
		padding: clamp(1rem, 2vw, 2rem);
	}

	.version-shell {
		width: 100%;
		max-width: 70rem;
		margin: 0 auto;
		display: flex;
		flex-direction: column;
		gap: 1rem;
		padding: clamp(1rem, 2vw, 1.5rem);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		background: var(--color-surface);
		box-shadow: var(--shadow);
	}

	.version-header {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	h1,
	.version-header p,
	.current-version p,
	dl,
	dd {
		margin: 0;
	}

	h1 {
		color: var(--color-text);
		font-size: clamp(1.375rem, 2vw, 1.75rem);
		line-height: 1.15;
		font-weight: 720;
	}

	.version-header p {
		color: var(--color-muted);
		font-size: 0.9375rem;
	}

	.current-version {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: clamp(1rem, 3vw, 1.5rem);
		border: 1px solid color-mix(in srgb, var(--color-accent) 28%, var(--color-border));
		border-radius: var(--radius);
		background: color-mix(in srgb, var(--color-accent) 7%, var(--color-surface));
	}

	.current-version-label,
	dt {
		color: var(--color-muted-strong);
		font-size: 0.75rem;
		font-weight: 700;
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}

	.current-version-labels {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}

	.current-version-stage {
		color: var(--color-accent-text);
		font-size: 0.8125rem;
		font-weight: 650;
		line-height: 1.2;
	}

	.current-version code {
		font-size: clamp(1.75rem, 5vw, 3.25rem);
		font-weight: 720;
		letter-spacing: -0.04em;
		line-height: 1;
	}

	.version-details {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.75rem;
	}

	.version-details > div {
		min-width: 0;
		padding: 1rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: color-mix(in srgb, var(--color-background) 72%, var(--color-surface));
	}

	.version-details .wide-detail {
		grid-column: 1 / -1;
	}

	dt {
		margin-bottom: 0.375rem;
	}

	dd {
		color: var(--color-text);
		font-size: 0.9375rem;
		font-weight: 600;
	}

	code {
		font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
	}

	.version-details code {
		overflow-wrap: anywhere;
	}

	.metadata-link {
		display: inline-flex;
		max-width: 100%;
		align-items: center;
		gap: 0.25rem;
		color: var(--color-accent-text);
		text-decoration: underline;
		text-decoration-thickness: 0.08em;
		text-underline-offset: 0.16em;
		vertical-align: middle;
	}

	.metadata-link:hover {
		color: var(--color-accent-hover);
	}

	.metadata-link code {
		min-width: 0;
		color: inherit;
	}

	@media (max-width: 720px) {
		.version-page {
			padding: 1rem;
		}

		.version-shell {
			padding: 1rem;
			border-radius: var(--radius);
		}

		.current-version {
			align-items: flex-start;
			flex-direction: column;
		}

		.version-details {
			grid-template-columns: 1fr;
		}

		.version-details .wide-detail {
			grid-column: auto;
		}
	}
</style>
