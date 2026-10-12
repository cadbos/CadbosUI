<!--
Copyright (c) 2026 Cadbos company. All rights reserved.

SPDX-License-Identifier: LicenseRef-Cadbos-BSL-1.1

Cadbos Interior Design AI is licensed under the Business Source License 1.1.
Access is limited to automated analysis tools for analysis of this repository.
This code is not open for contribution or usage except under a separate
written agreement with Cadbos company.

Commercial use in Interior Design & AEC Generative AI Services is prohibited
before the Change Date. See LICENSE for complete terms.
-->

<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import type { PathnameWithSearchOrHash } from '$app/types';
	import { t, type TranslationKey } from '$lib/i18n/index.svelte';
	import { request } from '$lib/state/request.svelte';
	import { buildWorkspaceUrl, type Mode } from '$lib/state/url-state';
	import { logBoundaryError } from '$lib/utils';
	import { startHomeLanding } from './home-landing-canvas';

	const actions = [
		{
			mode: 'render',
			effect: 'cre',
			label: 'mode.render',
			description: 'render.panelDescription'
		},
		{
			mode: 'edit',
			effect: 'edit',
			label: 'mode.edit',
			description: 'edit.panelDescription'
		},
		{
			mode: 'styleTransfer',
			effect: 'mig',
			label: 'mode.styleTransfer',
			description: 'styleTransfer.panelDescription'
		}
	] satisfies {
		mode: Mode;
		effect: 'cre' | 'edit' | 'mig';
		label: TranslationKey;
		description: TranslationKey;
	}[];

	function openMode(mode: Mode): void {
		void goto(resolve(buildWorkspaceUrl(mode, request) as PathnameWithSearchOrHash, {}), {
			keepFocus: true,
			noScroll: true
		}).catch((error: unknown) => logBoundaryError('homeLanding.openMode', error));
	}

	function playLanding(node: HTMLElement): () => void {
		const canvas = node.querySelector('canvas');
		const clouds = node.querySelector('.clouds');
		if (!(canvas instanceof HTMLCanvasElement) || !(clouds instanceof HTMLElement)) {
			return () => {};
		}
		return startHomeLanding(canvas, clouds);
	}
</script>

<section class="landing" aria-label={t('home.landing')} {@attach playLanding}>
	<canvas aria-hidden="true"></canvas>
	<nav class="clouds" aria-label={t('mode.switcher.label')}>
		{#each actions as action (action.mode)}
			<button
				class="cloud"
				data-m={action.effect}
				type="button"
				onclick={() => openMode(action.mode)}
			>
				<span class="ic">
					{#if action.effect === 'cre'}
						<svg viewBox="0 0 24 24" aria-hidden="true">
							<path
								d="M9 3l1.6 4.4L15 9l-4.4 1.6L9 15l-1.6-4.4L3 9l4.4-1.6zM18 13l.9 2.1L21 16l-2.1.9L18 19l-.9-2.1L15 16l2.1-.9z"
							/>
						</svg>
					{:else if action.effect === 'edit'}
						<svg viewBox="0 0 24 24" aria-hidden="true">
							<path d="M4 20l1-4L16 5a2.1 2.1 0 013 3L8 19z" />
							<path d="M14 7l3 3" />
						</svg>
					{:else}
						<svg viewBox="0 0 24 24" aria-hidden="true">
							<path
								d="M12 3a9 9 0 100 18c1.3 0 2-.8 2-1.8 0-.5-.2-.9-.5-1.2-.3-.4-.5-.7-.5-1.2 0-1 .8-1.8 1.8-1.8H17a4 4 0 004-4c0-4.4-4-8-9-8z"
							/>
							<circle cx="7.5" cy="11" r="1" />
							<circle cx="10" cy="7" r="1" />
							<circle cx="15" cy="7.5" r="1" />
						</svg>
					{/if}
				</span>
				<span class="tx">
					<b>{t(action.label)}</b>
					<small>{t(action.description)}</small>
				</span>
			</button>
		{/each}
	</nav>
</section>

<style>
	.landing {
		--landing-bg: #f5f5f7;
		--landing-ink: #1d1d1f;
		--landing-mute: #6e6e73;
		--landing-acc: #2f6f4f;
		--landing-glow: rgba(47, 111, 79, 0.14);
		--landing-card: #ffffff;
		position: relative;
		height: calc(100dvh - var(--app-chrome-height, 0px));
		overflow: hidden;
		color: var(--landing-ink);
		background:
			radial-gradient(60% 55% at 50% 45%, var(--landing-glow), transparent 70%), var(--landing-bg);
	}

	:global(:root[data-theme='dark']) .landing {
		--landing-bg: #1c1c1e;
		--landing-ink: #f2f2f3;
		--landing-mute: #98989f;
		--landing-acc: #48a374;
		--landing-glow: rgba(72, 163, 116, 0.18);
		--landing-card: #2a302f;
	}

	@media (prefers-color-scheme: dark) {
		:global(:root:not([data-theme='light'])) .landing {
			--landing-bg: #1c1c1e;
			--landing-ink: #f2f2f3;
			--landing-mute: #98989f;
			--landing-acc: #48a374;
			--landing-glow: rgba(72, 163, 116, 0.18);
			--landing-card: #2a302f;
		}
	}

	canvas {
		position: absolute;
		inset: 0;
		display: block;
		width: 100%;
		height: 100%;
	}

	.clouds {
		position: absolute;
		inset: 0;
		pointer-events: none;
	}

	.cloud {
		position: absolute;
		pointer-events: auto;
		display: flex;
		gap: 14px;
		align-items: center;
		width: min(300px, 86vw);
		box-sizing: border-box;
		padding: 20px 24px;
		border: 1px solid rgba(127, 127, 127, 0.16);
		cursor: pointer;
		text-align: left;
		color: var(--landing-ink);
		font: inherit;
		background: var(--landing-card);
		border-radius: 34px;
		filter: drop-shadow(0 10px 22px rgba(0, 0, 0, 0.14));
		opacity: 1;
		scale: 1;
		transition:
			scale 0.7s cubic-bezier(0.2, 1.4, 0.4, 1),
			filter 0.35s,
			rotate 0.4s;
	}

	.cloud > * {
		position: relative;
		z-index: 1;
	}

	.cloud:hover,
	.cloud:focus-visible {
		scale: 1.06;
		rotate: 0deg;
		filter: drop-shadow(0 0 1.2px var(--landing-acc)) drop-shadow(0 12px 28px var(--landing-glow));
		outline: 0;
	}

	.ic {
		flex: none;
		width: 44px;
		height: 44px;
		border-radius: 50%;
		display: grid;
		place-items: center;
		background: var(--landing-glow);
	}

	.ic svg {
		width: 22px;
		height: 22px;
		fill: none;
		stroke: var(--landing-acc);
		stroke-width: 1.7;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.tx b {
		display: block;
		font-size: 16px;
		font-weight: 600;
		letter-spacing: -0.01em;
	}

	.tx small {
		display: block;
		margin-top: 3px;
		font-size: 12.5px;
		line-height: 1.35;
		color: var(--landing-mute);
	}

	.cloud[data-m='cre'] {
		left: 4%;
		top: 27%;
		rotate: -2.5deg;
	}

	.cloud[data-m='edit'] {
		right: 3%;
		top: 13%;
		rotate: 2deg;
	}

	.cloud[data-m='mig'] {
		right: 11%;
		bottom: 12%;
		rotate: -1.5deg;
	}

	@media (max-width: 820px) {
		.clouds {
			display: flex;
			flex-direction: column;
			justify-content: flex-end;
			align-items: center;
			gap: 18px;
			padding: 0 16px max(16px, env(safe-area-inset-bottom, 0px));
		}

		.cloud[data-m='cre'],
		.cloud[data-m='edit'],
		.cloud[data-m='mig'] {
			position: relative;
			left: auto;
			right: auto;
			top: auto;
			bottom: auto;
			rotate: 0deg;
			width: 100%;
			max-width: 380px;
			padding: 14px 20px;
		}
	}
</style>
