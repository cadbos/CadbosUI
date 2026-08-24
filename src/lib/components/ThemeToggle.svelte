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
	import { ChevronDown, Monitor, Moon, Sun } from '@lucide/svelte';
	import { t, type TranslationKey } from '$lib/i18n/index.svelte';
	import { theme, type ThemeMode } from '$lib/state/theme.svelte';
	import { dismissable } from '$lib/utils';

	const modes: readonly ThemeMode[] = ['light', 'system', 'dark'];
	const labelKeys: Record<ThemeMode, TranslationKey> = {
		light: 'theme.light',
		system: 'theme.system',
		dark: 'theme.dark'
	};
	const icons = { light: Sun, system: Monitor, dark: Moon } as const;

	let open = $state(false);
	let CurrentIcon = $derived(icons[theme.mode]);

	function choose(mode: ThemeMode): void {
		theme.setMode(mode);
		open = false;
	}
</script>

<div
	class="theme-toggle"
	role="group"
	aria-label={t('theme.label')}
	{@attach dismissable(
		() => open,
		() => (open = false),
		'.theme-trigger'
	)}
>
	<button
		type="button"
		class="theme-trigger"
		aria-expanded={open}
		aria-controls="theme-menu"
		aria-label={t('theme.label')}
		onclick={() => (open = !open)}
	>
		<CurrentIcon size={18} strokeWidth={1.8} aria-hidden="true" />
		<ChevronDown class="chevron" size={18} strokeWidth={1.8} aria-hidden="true" />
	</button>
	<div id="theme-menu" class="menu" hidden={!open}>
		{#each modes as mode (mode)}
			{@const Icon = icons[mode]}
			<button
				type="button"
				class:active={theme.mode === mode}
				aria-current={theme.mode === mode}
				onclick={() => choose(mode)}
			>
				<Icon size={16} strokeWidth={1.8} aria-hidden="true" />
				<span>{t(labelKeys[mode])}</span>
			</button>
		{/each}
	</div>
</div>

<style>
	.theme-toggle {
		position: relative;
	}

	.theme-trigger {
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

	.theme-trigger :global(.chevron) {
		transition: transform 0.15s ease;
	}

	@media (prefers-reduced-motion: reduce) {
		.theme-trigger :global(.chevron) {
			transition: none;
		}
	}

	.theme-trigger[aria-expanded='true'] :global(.chevron) {
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
