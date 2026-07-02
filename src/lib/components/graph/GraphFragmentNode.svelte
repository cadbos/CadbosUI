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
	import { Handle, Position, type Node, type NodeProps } from '@xyflow/svelte';
	import { fragmentIdFromNodeId } from '$lib/components/graph-prompt';
	import { t, ti } from '$lib/i18n/index.svelte';
	import { request } from '$lib/state/request.svelte';

	type FragmentNode = Node<{ text: string; onRemove: () => void }, 'fragment'>;

	let { id, data }: NodeProps<FragmentNode> = $props();

	const fragmentId = $derived(fragmentIdFromNodeId(id) ?? '');
	const order = $derived(
		[...request.promptFragments]
			.sort((a, b) => a.order - b.order)
			.findIndex((fragment) => fragment.id === fragmentId) + 1
	);

	function updateText(event: Event): void {
		const value = event.currentTarget instanceof HTMLInputElement ? event.currentTarget.value : '';
		request.updateFragment(fragmentId, { text: value });
	}
</script>

<div class="graph-node graph-node--fragment">
	<Handle type="target" position={Position.Left} />
	<label class="graph-node__field">
		<span>{ti('view.graph.fragment', { order })}</span>
		<input class="nodrag" value={data.text} oninput={updateText} />
	</label>
	<button
		type="button"
		class="graph-node__remove nodrag"
		aria-label={ti('view.graph.removeFragment', { order })}
		onclick={data.onRemove}
	>
		{t('view.graph.remove')}
	</button>
	<Handle type="source" position={Position.Right} />
</div>

<style>
	.graph-node {
		width: 13rem;
		padding: var(--space-2);
		background: var(--color-surface);
		border: 1.5px solid var(--color-border);
		border-radius: var(--radius);
		display: grid;
		gap: var(--space-1);
	}

	.graph-node__field {
		display: grid;
		gap: var(--space-1);
		font-size: 0.8125rem;
	}

	input,
	button {
		font: inherit;
	}

	input {
		padding: var(--space-1);
		border: 1.5px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-background);
		color: var(--color-text);
	}

	.graph-node__remove {
		justify-self: start;
		font-size: 0.8125rem;
		color: var(--color-danger);
		background: none;
		border: none;
		cursor: pointer;
		padding: 0;
	}
</style>
