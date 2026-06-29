import { beforeEach, describe, expect, it } from 'vitest';
import {
	AC9_IMAGE,
	AC9_PROMPT,
	AC9_RENDER_REQUEST,
	applyAc9Fixture,
	buildAc9RequestJSON
} from '$lib/state/request-fixtures';
import { RequestReorderError, request } from '$lib/state/request.svelte';

beforeEach(() => {
	request.reset();
});

describe('prompt derivation', () => {
	it('concatenates fragments by order without a separator', () => {
		request.addFragment({ text: 'warm ', order: 1 });
		request.addFragment({ text: 'Scandinavian ', order: 0 });
		request.addFragment({ text: 'light', order: 2 });
		expect(request.prompt).toBe('Scandinavian warm light');
	});

	it('formats labeled fragments as ordered key-value lines', () => {
		request.addFragment({ label: 'Room', text: 'living room', order: 1 });
		request.addFragment({ label: 'Style', text: 'Scandinavian ', order: 0 });
		expect(request.prompt).toBe('Style: Scandinavian\nRoom: living room');
	});

	it('returns an empty prompt when there are no fragments', () => {
		expect(request.prompt).toBe('');
	});
});

describe('reorder', () => {
	it('changes the derived prompt when fragment order changes', () => {
		const first = request.addFragment({ text: 'A' });
		const second = request.addFragment({ text: 'B' });
		expect(request.prompt).toBe('AB');
		request.reorder([second, first]);
		expect(request.prompt).toBe('BA');
	});

	it('throws when orderedIds is incomplete', () => {
		const first = request.addFragment({ text: 'A' });
		request.addFragment({ text: 'B' });
		expect(() => request.reorder([first])).toThrow(RequestReorderError);
	});

	it('throws when orderedIds contains an unknown id', () => {
		request.addFragment({ text: 'A' });
		expect(() => request.reorder(['unknown-id'])).toThrow(RequestReorderError);
	});

	it('throws when orderedIds contains a duplicate id', () => {
		const first = request.addFragment({ text: 'A' });
		request.addFragment({ text: 'B' });
		expect(() => request.reorder([first, first])).toThrow(RequestReorderError);
	});
});

describe('prompt override', () => {
	it('keeps override text when fragments change', () => {
		request.setPromptOverride('custom prompt');
		request.addFragment({ text: 'ignored fragment' });
		expect(request.prompt).toBe('custom prompt');
	});

	it('restores derived prompt after clearPromptOverride', () => {
		request.addFragment({ text: 'derived' });
		request.setPromptOverride('override');
		request.clearPromptOverride();
		expect(request.prompt).toBe('derived');
	});

	it('clears fragment labels through updateFragment', () => {
		const id = request.addFragment({ label: 'style', text: 'styled room' });
		request.updateFragment(id, { label: null });
		expect(request.toJSON().promptFragments[0]).toEqual(
			expect.objectContaining({ id, text: 'styled room', order: 0 })
		);
		expect('label' in request.toJSON().promptFragments[0]).toBe(false);
	});
});

describe('validate', () => {
	it('reports missing prompt and image', () => {
		expect(request.validate()).toEqual({ valid: false, missing: ['prompt', 'image'] });
	});

	it('reports missing image when prompt is present', () => {
		request.addFragment({ text: 'styled room' });
		expect(request.validate()).toEqual({ valid: false, missing: ['image'] });
	});

	it('reports missing prompt when image is present', () => {
		request.setImage(AC9_IMAGE);
		expect(request.validate()).toEqual({ valid: false, missing: ['prompt'] });
	});

	it('accepts an image URL without derived metadata', () => {
		request.setImage({ url: AC9_IMAGE.url });
		expect(request.toJSON().image).toEqual({ url: AC9_IMAGE.url });
	});

	it('trims image URLs at the store boundary', () => {
		request.setImage({ url: ` ${AC9_IMAGE.url} ` });
		expect(request.toJSON().image).toEqual({ url: AC9_IMAGE.url });
	});

	it('rejects invalid image URLs at the store boundary', () => {
		request.setImage(AC9_IMAGE);
		expect(() => request.setImage({ url: 'not a url' })).toThrow();
		expect(request.image?.url).toBe(AC9_IMAGE.url);
	});

	it('is valid when prompt and image are present', () => {
		applyAc9Fixture();
		expect(request.validate()).toEqual({ valid: true, missing: [] });
	});
});

describe('canSubmit', () => {
	it('is false while rendering', () => {
		applyAc9Fixture();
		request.setStatus('rendering');
		expect(request.canSubmit).toBe(false);
	});

	it('is true when valid and idle', () => {
		applyAc9Fixture();
		expect(request.canSubmit).toBe(true);
	});
});

describe('serialization', () => {
	it('round-trips through toJSON and fromJSON including override', () => {
		applyAc9Fixture();
		request.setPromptOverride('override text');
		const snapshot = request.toJSON();
		request.reset();
		request.fromJSON(snapshot);
		expect(request.toJSON()).toEqual(snapshot);
		expect(request.prompt).toBe('override text');
	});

	it('rejects invalid JSON', () => {
		expect(() => request.fromJSON({ id: '' })).toThrow();
	});

	it('rejects invalid image URLs from JSON', () => {
		const snapshot = buildAc9RequestJSON();
		snapshot.image = { url: 'not a url' };
		expect(() => request.fromJSON(snapshot)).toThrow();
	});

	it('rejects duplicate fragment ids from JSON', () => {
		const snapshot = buildAc9RequestJSON();
		snapshot.promptFragments = [
			snapshot.promptFragments[0],
			{ ...snapshot.promptFragments[1], id: snapshot.promptFragments[0].id }
		];
		expect(() => request.fromJSON(snapshot)).toThrow();
	});

	it('rejects duplicate fragment orders from JSON', () => {
		const snapshot = buildAc9RequestJSON();
		snapshot.promptFragments = [
			snapshot.promptFragments[0],
			{ ...snapshot.promptFragments[1], order: snapshot.promptFragments[0].order }
		];
		expect(() => request.fromJSON(snapshot)).toThrow();
	});

	it('does not expose mutable state through JSON snapshots', () => {
		applyAc9Fixture();
		const snapshot = request.toJSON();
		expect(snapshot.image).toBeDefined();
		if (!snapshot.image) return;
		snapshot.image.url = 'https://example.invalid/mutated';
		snapshot.promptFragments[0].text = 'mutated';
		expect(request.image?.url).toBe(AC9_IMAGE.url);
		expect(request.prompt).toBe(AC9_PROMPT);
	});

	it('builds isolated fixture snapshots', () => {
		const snapshot = buildAc9RequestJSON();
		expect(snapshot.image).toBeDefined();
		expect(snapshot.image?.dimensions).toBeDefined();
		if (!snapshot.image || !snapshot.image.dimensions) return;
		snapshot.image.url = 'https://example.invalid/mutated';
		snapshot.image.dimensions[0] = 1;
		snapshot.promptFragments[0].text = 'mutated';

		const nextSnapshot = buildAc9RequestJSON();
		expect(nextSnapshot.image).toEqual(AC9_IMAGE);
		expect(nextSnapshot.promptFragments[0].text).toBe('Scandinavian ');
		expect(nextSnapshot.image).not.toBe(AC9_IMAGE);
		expect(nextSnapshot.image?.dimensions).not.toBe(AC9_IMAGE.dimensions);
	});
});

describe('normalizeForComparison', () => {
	it('ignores request id and status', () => {
		applyAc9Fixture();
		const baseline = request.normalizeForComparison();
		request.id = 'different-id';
		request.setStatus('rendering');
		expect(request.normalizeForComparison()).toEqual(baseline);
	});

	it('matches across two loads of the same fixture content', () => {
		applyAc9Fixture();
		const first = request.normalizeForComparison();
		request.reset();
		request.fromJSON(buildAc9RequestJSON());
		expect(request.normalizeForComparison()).toEqual(first);
	});
});

describe('toRenderRequest', () => {
	it('returns the wire body for a valid AC-9 fixture', () => {
		applyAc9Fixture();
		expect(request.toRenderRequest()).toEqual(AC9_RENDER_REQUEST);
		expect(request.prompt).toBe(AC9_PROMPT);
	});

	it('returns null when invalid', () => {
		expect(request.toRenderRequest()).toBeNull();
	});
});
