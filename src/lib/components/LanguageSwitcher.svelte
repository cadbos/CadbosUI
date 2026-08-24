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
	import { ChevronDown } from '@lucide/svelte';
	import { getLocale, locales, setLocale, t } from '$lib/i18n/index.svelte';
	import { dismissable } from '$lib/utils';

	const labelKeys = { ru: 'language.ru', en: 'language.en' } as const;
	const flags = { ru: '🇷🇺', en: '🇬🇧' } as const;

	let open = $state(false);

	function choose(code: (typeof locales)[number]): void {
		setLocale(code);
		open = false;
	}
</script>

<div
	class="language-switcher"
	role="group"
	aria-label={t('language.switcher.label')}
	{@attach dismissable(
		() => open,
		() => (open = false),
		'.language-trigger'
	)}
>
	<button
		type="button"
		class="language-trigger"
		aria-expanded={open}
		aria-controls="language-menu"
		aria-label={t('language.switcher.label')}
		onclick={() => (open = !open)}
	>
		<span class="flag" aria-hidden="true">{flags[getLocale()]}</span>
		<ChevronDown class="chevron" size={18} strokeWidth={1.8} aria-hidden="true" />
	</button>
	<div id="language-menu" class="menu" hidden={!open}>
		{#each locales as code (code)}
			<button
				type="button"
				class:active={getLocale() === code}
				aria-current={getLocale() === code}
				onclick={() => choose(code)}
			>
				<span aria-hidden="true">{flags[code]}</span>
				<span>{t(labelKeys[code])}</span>
			</button>
		{/each}
	</div>
</div>

<style>
	.language-switcher {
		position: relative;
	}

	.language-trigger {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-1);
		min-height: 2.2rem;
		padding: 0.4rem 0.65rem;
		font: inherit;
		font-weight: 500;
		color: var(--color-text);
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
	}

	.language-trigger .flag {
		font-size: 1.3rem;
		line-height: 1;
	}

	.language-trigger :global(.chevron) {
		transition: transform 0.15s ease;
	}

	@media (prefers-reduced-motion: reduce) {
		.language-trigger :global(.chevron) {
			transition: none;
		}
	}

	.language-trigger[aria-expanded='true'] :global(.chevron) {
		transform: rotate(180deg);
	}

	.menu {
		position: absolute;
		right: 0;
		top: calc(100% + var(--space-1));
		z-index: 20;
		display: flex;
		flex-direction: column;
		min-width: 8rem;
		padding: var(--space-1);
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		box-shadow: 0 8px 24px rgb(0 0 0 / 12%);
	}

	.menu[hidden] {
		display: none;
	}

	.menu button {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		justify-content: flex-start;
		padding: 0.25rem 0.5rem;
		font-size: 0.78rem;
		text-align: left;
		color: var(--color-text);
		background: transparent;
		border-color: transparent;
	}

	.menu button:hover,
	.menu button:focus-visible {
		background: var(--color-bg);
	}

	.menu button.active {
		background: var(--color-bg);
		font-weight: 600;
	}
</style>
