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
	import { ChevronDown, ChevronUp, X } from '@lucide/svelte';
	import { tick } from 'svelte';
	import { t, ti } from '$lib/i18n/index.svelte';
	import { request } from '$lib/state/request.svelte';

	const fragments = $derived([...request.promptFragments].sort((a, b) => a.order - b.order));

	let liveMessage = $state('');
	let addFragmentButton: HTMLButtonElement | undefined;
	let removeButtons: (HTMLButtonElement | undefined)[] = [];

	function captureAddFragmentButton(node: HTMLButtonElement): () => void {
		addFragmentButton = node;
		return () => {
			if (addFragmentButton === node) addFragmentButton = undefined;
		};
	}

	function captureRemoveButton(index: number) {
		return (node: HTMLButtonElement): (() => void) => {
			removeButtons[index] = node;
			return () => {
				if (removeButtons[index] === node) removeButtons[index] = undefined;
			};
		};
	}

	function inputValue(event: Event): string {
		return event.currentTarget instanceof HTMLInputElement ? event.currentTarget.value : '';
	}

	// Key-value edits always win over a promptOverride set elsewhere (e.g. Chat) —
	// there's no separate "apply" step, so every mutation here must itself make
	// the fragments authoritative again.
	function addFragment(): void {
		request.clearPromptOverride();
		request.addFragment({ text: '', order: request.promptFragments.length });
	}

	function updateLabel(id: string, event: Event): void {
		const label = inputValue(event);
		request.clearPromptOverride();
		request.updateFragment(id, { label: label === '' ? null : label });
	}

	function updateText(id: string, event: Event): void {
		request.clearPromptOverride();
		request.updateFragment(id, { text: inputValue(event) });
	}

	function reorderFragment(index: number, offset: -1 | 1): void {
		const target = index + offset;
		if (target < 0 || target >= fragments.length) return;
		const orderedIds = fragments.map((fragment) => fragment.id);
		[orderedIds[index], orderedIds[target]] = [orderedIds[target], orderedIds[index]];
		request.clearPromptOverride();
		request.reorder(orderedIds);
		liveMessage = ti(offset === -1 ? 'view.keyValue.movedUp' : 'view.keyValue.movedDown', {
			order: target + 1
		});
	}

	function removeFragment(index: number, id: string): void {
		request.clearPromptOverride();
		request.removeFragment(id);
		liveMessage = ti('view.keyValue.removed', { order: index + 1 });
		tick().then(() => {
			const remaining = fragments.length;
			if (remaining === 0) {
				addFragmentButton?.focus();
				return;
			}
			const nextIndex = Math.min(index, remaining - 1);
			removeButtons[nextIndex]?.focus();
		});
	}
</script>

<div class="entry">
	<ul class="fragments">
		{#each fragments as fragment, index (fragment.id)}
			<li class="fragment">
				<label>
					<span>{ti('view.keyValue.label', { order: index + 1 })}</span>
					<input
						value={fragment.label ?? ''}
						oninput={(event) => updateLabel(fragment.id, event)}
					/>
				</label>
				<label>
					<span>{ti('view.keyValue.text', { order: index + 1 })}</span>
					<input value={fragment.text} oninput={(event) => updateText(fragment.id, event)} />
				</label>
				<div class="fragment-actions">
					<button
						type="button"
						class="icon-button"
						aria-label={ti('view.keyValue.moveUp', { order: index + 1 })}
						disabled={index === 0}
						onclick={() => reorderFragment(index, -1)}
					>
						<ChevronUp size={16} strokeWidth={2} aria-hidden="true" />
					</button>
					<button
						type="button"
						class="icon-button"
						aria-label={ti('view.keyValue.moveDown', { order: index + 1 })}
						disabled={index === fragments.length - 1}
						onclick={() => reorderFragment(index, 1)}
					>
						<ChevronDown size={16} strokeWidth={2} aria-hidden="true" />
					</button>
					<button
						type="button"
						class="icon-button"
						aria-label={ti('view.keyValue.removeFragment', { order: index + 1 })}
						{@attach captureRemoveButton(index)}
						onclick={() => removeFragment(index, fragment.id)}
					>
						<X size={16} strokeWidth={2} aria-hidden="true" />
					</button>
				</div>
			</li>
		{/each}
	</ul>
	<div class="actions">
		<button
			type="button"
			class="btn-secondary"
			{@attach captureAddFragmentButton}
			onclick={addFragment}
		>
			{t('view.keyValue.addFragment')}
		</button>
	</div>
	<div class="visually-hidden" role="status" aria-live="polite">{liveMessage}</div>
</div>

<style>
	.entry {
		width: 100%;
		max-width: 52rem;
		display: grid;
		gap: var(--space-2);
	}

	label {
		display: grid;
		gap: var(--space-1);
	}

	.fragments {
		display: grid;
		gap: var(--space-2);
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.fragment {
		display: grid;
		grid-template-columns: minmax(10rem, 1fr) minmax(14rem, 1.25fr) auto;
		align-items: end;
		gap: var(--space-2);
	}

	.fragment input {
		width: 100%;
		min-width: 0;
		padding: var(--space-1);
		border: 1.5px solid var(--color-border);
		border-radius: var(--radius);
		background: var(--color-surface);
		color: var(--color-text);
	}

	.fragment-actions {
		display: flex;
		gap: var(--space-1);
		align-items: center;
	}

	.icon-button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 2.25rem;
		height: 2.25rem;
		padding: 0;
		color: var(--color-text);
		background: var(--color-surface);
		border: 1.5px solid var(--color-border);
		border-radius: var(--radius-sm);
		cursor: pointer;
		transition:
			background 0.15s,
			border-color 0.15s,
			color 0.15s;
	}

	.icon-button:hover:not(:disabled) {
		color: var(--color-accent);
		background: var(--color-surface-hover);
		border-color: var(--color-muted);
	}

	.icon-button:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}

	@media (max-width: 760px) {
		.fragment {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}

		.fragment-actions {
			grid-column: 1 / -1;
		}
	}

	@media (max-width: 520px) {
		.fragment {
			grid-template-columns: 1fr;
		}

		.fragment-actions {
			grid-column: auto;
		}

		.icon-button {
			width: 2.75rem;
			height: 2.75rem;
		}
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}

	.btn-secondary {
		padding: 0.5rem 1rem;
		font-size: 0.875rem;
		font-weight: 500;
		color: var(--color-text);
		background: var(--color-surface);
		border: 1.5px solid var(--color-border);
		border-radius: var(--radius);
		cursor: pointer;
		transition:
			background 0.15s,
			border-color 0.15s;
	}

	.btn-secondary:hover {
		background: var(--color-surface-hover);
		border-color: var(--color-muted);
	}

	input,
	button {
		font: inherit;
	}

	.visually-hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}
</style>
