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
	import { tick, untrack } from 'svelte';
	import { Background, Controls, SvelteFlow, type Edge, type Node } from '@xyflow/svelte';
	import '@xyflow/svelte/dist/style.css';
	import {
		buildPromptGraph,
		COMPOSE_NODE_ID,
		fragmentIdFromNodeId,
		graphToPromptFragments,
		IMAGE_NODE_ID,
		type PromptGraph,
		type PromptGraphEdge,
		type PromptGraphNode,
		type PromptGraphResult,
		type PromptGraphValidationError
	} from '$lib/components/graph-prompt';
	import GraphComposeNode from '$lib/components/graph/GraphComposeNode.svelte';
	import GraphFragmentNode from '$lib/components/graph/GraphFragmentNode.svelte';
	import GraphImageNode from '$lib/components/graph/GraphImageNode.svelte';
	import { t, ti, type TranslationKey } from '$lib/i18n/index.svelte';
	import { request, type PromptFragment } from '$lib/state/request.svelte';

	type ImageNode = Node<Record<string, never>, 'image'>;
	type FragmentNode = Node<{ text: string; onRemove: () => void }, 'fragment'>;
	type ComposeNode = Node<Record<string, never>, 'compose'>;
	type FlowNode = ImageNode | FragmentNode | ComposeNode;

	const nodeTypes = {
		image: GraphImageNode,
		fragment: GraphFragmentNode,
		compose: GraphComposeNode
	};

	const FRAGMENT_X = 280;
	const FRAGMENT_Y_STEP = 120;
	const COMPOSE_X = 560;

	// Svelte Flow keeps a node invisible until it has a known width/height (either
	// measured via ResizeObserver, or supplied up front). Our node cards have a
	// roughly fixed footprint, so provide initial dimensions to avoid a flash of
	// hidden nodes on first paint.
	const IMAGE_NODE_SIZE = { width: 192, height: 140 };
	const FRAGMENT_NODE_SIZE = { width: 208, height: 130 };
	const COMPOSE_NODE_SIZE = { width: 224, height: 140 };

	function toFlowGraph(
		promptFragments: PromptFragment[],
		previousNodes: FlowNode[],
		onRemoveFragment: (fragmentId: string) => void
	): { nodes: FlowNode[]; edges: Edge[] } {
		const graph = buildPromptGraph(promptFragments);
		const positionById = new Map(previousNodes.map((node) => [node.id, node.position]));
		let fragmentIndex = 0;

		const nodes = graph.nodes.map((node): FlowNode => {
			if (node.kind === 'image') {
				return {
					id: node.id,
					type: 'image',
					data: {},
					position: positionById.get(node.id) ?? { x: 0, y: 0 },
					deletable: false,
					initialWidth: IMAGE_NODE_SIZE.width,
					initialHeight: IMAGE_NODE_SIZE.height
				};
			}
			if (node.kind === 'compose') {
				return {
					id: node.id,
					type: 'compose',
					data: {},
					position: positionById.get(node.id) ?? { x: COMPOSE_X, y: 0 },
					deletable: false,
					initialWidth: COMPOSE_NODE_SIZE.width,
					initialHeight: COMPOSE_NODE_SIZE.height
				};
			}
			const position = positionById.get(node.id) ?? {
				x: FRAGMENT_X,
				y: fragmentIndex * FRAGMENT_Y_STEP
			};
			fragmentIndex += 1;
			const fragmentId = fragmentIdFromNodeId(node.id) ?? '';
			return {
				id: node.id,
				type: 'fragment',
				data: { text: node.text, onRemove: () => onRemoveFragment(fragmentId) },
				position,
				deletable: false,
				initialWidth: FRAGMENT_NODE_SIZE.width,
				initialHeight: FRAGMENT_NODE_SIZE.height
			};
		});

		const edges = graph.edges.map(
			(edge): Edge => ({ id: `${edge.from}->${edge.to}`, source: edge.from, target: edge.to })
		);

		return { nodes, edges };
	}

	let liveMessage = $state('');
	let addFragmentButton: HTMLButtonElement | undefined;

	function captureAddFragmentButton(node: HTMLButtonElement): () => void {
		addFragmentButton = node;
		return () => {
			if (addFragmentButton === node) addFragmentButton = undefined;
		};
	}

	// Removing a fragment unmounts its custom node (and the button that had focus)
	// entirely, so focus management has to live here in the stable parent, not in
	// GraphFragmentNode itself — mirrors the fix already applied to KeyValueView.
	function handleRemoveFragment(fragmentId: string): void {
		const order =
			[...request.promptFragments]
				.sort((a, b) => a.order - b.order)
				.findIndex((fragment) => fragment.id === fragmentId) + 1;
		request.removeFragment(fragmentId);
		liveMessage = ti('view.graph.fragmentRemoved', { order });
		tick().then(() => addFragmentButton?.focus());
	}

	const initialFlowGraph = toFlowGraph(request.promptFragments, [], handleRemoveFragment);
	// Svelte Flow's `nodes`/`edges` are externally bindable (the canvas mutates them
	// directly on drag/connect/delete), so keeping them in sync with the store here is
	// a genuine side effect on an external widget's state, not a pure derivation —
	// this $effect (and the one below reading it back) is the documented exception to
	// "no $state reassignment in $effect", not a substitute for $derived.
	let nodes = $state.raw<FlowNode[]>(initialFlowGraph.nodes);
	let edges = $state.raw<Edge[]>(initialFlowGraph.edges);

	$effect(() => {
		const next = toFlowGraph(
			request.promptFragments,
			untrack(() => nodes),
			handleRemoveFragment
		);
		nodes = next.nodes;
		edges = next.edges;
	});

	function toPromptGraphNodes(list: FlowNode[]): PromptGraphNode[] {
		return list.map((node): PromptGraphNode => {
			if (node.type === 'fragment') return { id: node.id, kind: 'fragment', text: node.data.text };
			if (node.type === 'compose') return { id: COMPOSE_NODE_ID, kind: 'compose' };
			return { id: IMAGE_NODE_ID, kind: 'image' };
		});
	}

	function toPromptGraphEdges(list: Edge[]): PromptGraphEdge[] {
		return list.map((edge) => ({ from: edge.source, to: edge.target }));
	}

	function orderedFragmentIds(graph: PromptGraph): string[] {
		const nextByFrom = new Map(graph.edges.map((edge) => [edge.from, edge.to]));
		const ids: string[] = [];
		let current = IMAGE_NODE_ID;
		while (current !== COMPOSE_NODE_ID) {
			const next = nextByFrom.get(current);
			if (next === undefined) break;
			const fragmentId = fragmentIdFromNodeId(next);
			if (fragmentId !== null) ids.push(fragmentId);
			current = next;
		}
		return ids;
	}

	const validationMessageKeys: Record<PromptGraphValidationError, TranslationKey> = {
		cycle: 'view.graph.validation.cycle',
		'branching-node': 'view.graph.validation.branchingNode',
		'dangling-node': 'view.graph.validation.danglingNode',
		'unknown-node': 'view.graph.validation.unknownNode'
	};

	const localGraphResult = $derived.by((): PromptGraphResult => {
		const graph: PromptGraph = {
			nodes: toPromptGraphNodes(nodes),
			edges: toPromptGraphEdges(edges)
		};
		return graphToPromptFragments(graph);
	});

	const validationErrors = $derived(localGraphResult.valid ? [] : localGraphResult.errors);

	// The store write below is the genuine side effect (see the comment on the
	// `nodes`/`edges` sync above) — `localGraphResult` itself stays a pure $derived.
	$effect(() => {
		if (!localGraphResult.valid) return;

		const nextOrder = orderedFragmentIds({
			nodes: toPromptGraphNodes(untrack(() => nodes)),
			edges: toPromptGraphEdges(untrack(() => edges))
		});
		const currentOrder = untrack(() =>
			[...request.promptFragments].sort((a, b) => a.order - b.order).map((fragment) => fragment.id)
		);
		const changed =
			nextOrder.length !== currentOrder.length ||
			nextOrder.some((id, index) => id !== currentOrder[index]);
		if (changed) request.reorder(nextOrder);
	});

	function addFragment(): void {
		request.addFragment({ text: '', order: request.promptFragments.length });
	}
</script>

<div class="graph-view">
	<div class="graph-canvas">
		<SvelteFlow bind:nodes bind:edges {nodeTypes} fitView>
			<Background />
			<Controls />
		</SvelteFlow>
	</div>

	{#if validationErrors.length > 0}
		<div class="graph-validation" role="alert">
			<p>{t('view.graph.validation.heading')}</p>
			<ul>
				{#each validationErrors as error (error)}
					<li>{t(validationMessageKeys[error])}</li>
				{/each}
			</ul>
		</div>
	{/if}

	<div class="actions">
		<button type="button" {@attach captureAddFragmentButton} onclick={addFragment}>
			{t('view.graph.addFragment')}
		</button>
	</div>

	<p class="graph-mobile-message">{t('view.graph.mobileUnsupported')}</p>
	<div class="visually-hidden" role="status" aria-live="polite">{liveMessage}</div>
</div>

<style>
	.graph-view {
		width: 100%;
		display: grid;
		gap: var(--space-2);
	}

	.graph-canvas {
		width: 100%;
		min-height: 24rem;
		border: 1.5px solid var(--color-border);
		border-radius: var(--radius);
		overflow: hidden;
	}

	.graph-validation {
		padding: var(--space-2);
		background: var(--color-danger-bg);
		border: 1.5px solid var(--color-danger);
		border-radius: var(--radius);
		color: var(--color-danger);
	}

	.graph-validation p {
		margin: 0 0 var(--space-1);
		font-weight: 600;
	}

	.graph-validation ul {
		margin: 0;
		padding-left: 1.25rem;
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}

	button {
		font: inherit;
	}

	.graph-mobile-message {
		display: none;
		margin: 0;
		color: var(--color-muted);
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

	@media (max-width: 640px) {
		.graph-canvas,
		.graph-validation,
		.actions {
			display: none;
		}

		.graph-mobile-message {
			display: block;
		}
	}
</style>
