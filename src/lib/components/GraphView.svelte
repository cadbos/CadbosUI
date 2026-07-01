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
	import {
		buildPromptGraph,
		fragmentIdFromNodeId,
		graphToPromptFragments,
		graphWithFragmentText
	} from '$lib/components/graph-prompt';
	import { t, ti } from '$lib/i18n/index.svelte';
	import { request } from '$lib/state/request.svelte';

	const graph = $derived(buildPromptGraph(request.promptFragments));
	const fragmentNodes = $derived(graph.nodes.filter((node) => node.kind === 'fragment'));
	const graphValidation = $derived(graphToPromptFragments(graph));

	function addNode(): void {
		request.addFragment({ text: '', order: request.promptFragments.length });
	}

	function removeNode(nodeId: string): void {
		const fragmentId = fragmentIdFromNodeId(nodeId);
		if (fragmentId) request.removeFragment(fragmentId);
	}

	function applyPrompt(event: SubmitEvent): void {
		event.preventDefault();
		if (!(event.currentTarget instanceof HTMLFormElement)) return;

		const formData = new FormData(event.currentTarget);
		const textByNodeId = new Map(
			fragmentNodes.map((node) => {
				const text = formData.get(node.id);
				return [node.id, typeof text === 'string' ? text : ''];
			})
		);
		// Validate via the graph (catches cycles/branching/dangling nodes, FR-Г5), but
		// commit through updateFragment by id rather than remove-all/add-all — the
		// graph's fragment set always mirrors the store 1:1 here (no reconnect UI yet),
		// and result.fragments (text + order only) would silently drop each
		// fragment's label and regenerate its id.
		const result = graphToPromptFragments(graphWithFragmentText(graph, textByNodeId));
		if (!result.valid) return;

		request.clearPromptOverride();
		for (const node of fragmentNodes) {
			const fragmentId = fragmentIdFromNodeId(node.id);
			const text = textByNodeId.get(node.id);
			if (fragmentId !== null && text !== undefined) {
				request.updateFragment(fragmentId, { text });
			}
		}
	}
</script>

<form class="entry" onsubmit={applyPrompt}>
	<div class="nodes">
		{#each fragmentNodes as node, index (node.id)}
			<div class="node">
				<label>
					<span>{ti('view.graph.fragment', { order: index + 1 })}</span>
					<input name={node.id} value={node.text} />
				</label>
				<button
					type="button"
					aria-label={ti('view.graph.removeFragment', { order: index + 1 })}
					onclick={() => removeNode(node.id)}
				>
					{t('view.graph.remove')}
				</button>
			</div>
		{/each}
	</div>
	<div class="actions">
		<button type="button" onclick={addNode}>{t('view.graph.addFragment')}</button>
		<button type="submit" disabled={!graphValidation.valid}>{t('view.graph.apply')}</button>
	</div>
</form>

<style>
	.entry {
		width: min(100%, 34rem);
		display: grid;
		gap: var(--space-2);
	}

	label {
		display: grid;
		gap: var(--space-1);
	}

	.nodes {
		display: grid;
		gap: var(--space-2);
	}

	.node {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: end;
		gap: var(--space-2);
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}

	input,
	button {
		font: inherit;
	}
</style>
