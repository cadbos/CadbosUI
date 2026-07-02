import { describe, expect, it } from 'vitest';
import {
	COMPOSE_NODE_ID,
	IMAGE_NODE_ID,
	buildPromptGraph,
	graphToPromptFragments,
	type PromptGraph
} from '$lib/components/graph-prompt';
import type { PromptFragment } from '$lib/state/request.svelte';

describe('graph prompt mapping', () => {
	it('builds graph edges from request fragment order', () => {
		const fragments: PromptFragment[] = [
			{ id: 'second', text: 'B', order: 1 },
			{ id: 'first', text: 'A', order: 0 }
		];

		const result = graphToPromptFragments(buildPromptGraph(fragments));

		expect(result).toEqual({
			valid: true,
			fragments: [
				{ text: 'A', order: 0 },
				{ text: 'B', order: 1 }
			]
		});
	});

	it('derives inclusion order from graph edges instead of node array order', () => {
		const graph: PromptGraph = {
			nodes: [
				{ id: IMAGE_NODE_ID, kind: 'image' },
				{ id: 'a', kind: 'fragment', text: 'A' },
				{ id: 'b', kind: 'fragment', text: 'B' },
				{ id: COMPOSE_NODE_ID, kind: 'compose' }
			],
			edges: [
				{ from: IMAGE_NODE_ID, to: 'b' },
				{ from: 'b', to: 'a' },
				{ from: 'a', to: COMPOSE_NODE_ID }
			]
		};

		expect(graphToPromptFragments(graph)).toEqual({
			valid: true,
			fragments: [
				{ text: 'B', order: 0 },
				{ text: 'A', order: 1 }
			]
		});
	});

	it('rejects cycles', () => {
		const graph: PromptGraph = {
			nodes: [
				{ id: IMAGE_NODE_ID, kind: 'image' },
				{ id: 'a', kind: 'fragment', text: 'A' },
				{ id: 'b', kind: 'fragment', text: 'B' },
				{ id: COMPOSE_NODE_ID, kind: 'compose' }
			],
			edges: [
				{ from: IMAGE_NODE_ID, to: 'a' },
				{ from: 'a', to: 'b' },
				{ from: 'b', to: 'a' }
			]
		};

		const result = graphToPromptFragments(graph);

		expect(result.valid).toBe(false);
		if (!result.valid) expect(result.errors).toContain('cycle');
	});

	it('rejects dangling fragment nodes', () => {
		const graph: PromptGraph = {
			nodes: [
				{ id: IMAGE_NODE_ID, kind: 'image' },
				{ id: 'a', kind: 'fragment', text: 'A' },
				{ id: 'b', kind: 'fragment', text: 'B' },
				{ id: COMPOSE_NODE_ID, kind: 'compose' }
			],
			edges: [
				{ from: IMAGE_NODE_ID, to: 'a' },
				{ from: 'a', to: COMPOSE_NODE_ID }
			]
		};

		const result = graphToPromptFragments(graph);

		expect(result.valid).toBe(false);
		if (!result.valid) expect(result.errors).toContain('dangling-node');
	});
});
