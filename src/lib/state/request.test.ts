/*
 * Copyright (c) 2026 Cadbos company. All rights reserved.
 *
 * SPDX-License-Identifier: LicenseRef-Cadbos-BSL-1.1
 *
 * Cadbos Interior Design AI is licensed under the Business Source License 1.1.
 * Access is limited to automated analysis tools for analysis of this repository.
 * This code is not open for contribution or usage except under a separate
 * written agreement with Cadbos company.
 *
 * Commercial use in Interior Design & AEC Generative AI Services is prohibited
 * before the Change Date. See LICENSE for complete terms.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
	AC9_IMAGE,
	AC9_PROMPT,
	AC9_REFERENCE_IMAGE,
	AC9_RENDER_REQUEST,
	AC9_STYLE_TRANSFER_REQUEST,
	applyAc9Fixture,
	buildAc9RequestJSON
} from '$lib/state/request-fixtures';
import { RequestReorderError, request, type RenderResult } from '$lib/state/request.svelte';

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
	it('reports missing image when no state is set', () => {
		expect(request.validate()).toEqual({ valid: false, missing: ['image'] });
	});

	it('reports missing image when prompt is present', () => {
		request.addFragment({ text: 'styled room' });
		expect(request.validate()).toEqual({ valid: false, missing: ['image'] });
	});

	it('is valid when only image is set', () => {
		request.setImage(AC9_IMAGE);
		expect(request.validate()).toEqual({ valid: true, missing: [] });
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

	it('loads snapshots created before style-transfer settings existed', () => {
		const snapshot = buildAc9RequestJSON() as unknown as Record<string, unknown>;
		delete snapshot.styleReferenceImage;
		delete snapshot.styleTransferStrength;
		delete snapshot.styleNegativePrompt;
		delete snapshot.styleSourceMode;

		request.fromJSON(snapshot);

		expect(request.toJSON()).toEqual({
			...snapshot,
			styleReferenceImage: undefined,
			styleTransferStrength: 0.7,
			styleNegativePrompt: '',
			styleSourceMode: 'current-result'
		});
	});

	it('invalidates any pending undo/redo chain when loading a snapshot', () => {
		applyAc9Fixture();
		request.setCurrentRender({
			id: 'render-a',
			outputUrls: ['https://example.test/a.webp'],
			cost: 1,
			balance: 24,
			ts: 0
		});
		request.applyEditResult({
			id: 'render-b',
			outputUrls: ['https://example.test/b.webp'],
			cost: 1,
			balance: 23,
			ts: 1
		});
		expect(request.canUndoEdit).toBe(true);

		request.fromJSON(buildAc9RequestJSON());

		expect(request.canUndoEdit).toBe(false);
		expect(request.canRedoEdit).toBe(false);
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

describe('sceneType', () => {
	it('defaults to interior', () => {
		expect(request.sceneType).toBe('interior');
	});

	it('setSceneType updates the UI routing value without changing the render body', () => {
		applyAc9Fixture();
		request.setSceneType('exterior');
		expect(request.sceneType).toBe('exterior');
		expect(request.toRenderRequest()).toEqual(AC9_RENDER_REQUEST);
	});

	it('reset() reverts to interior', () => {
		request.setSceneType('exterior');
		request.reset();
		expect(request.sceneType).toBe('interior');
	});

	it('round-trips through toJSON/fromJSON', () => {
		applyAc9Fixture();
		request.setSceneType('exterior');
		const snapshot = request.toJSON();
		request.reset();
		request.fromJSON(snapshot);
		expect(request.sceneType).toBe('exterior');
	});

	it('defaults to interior when restoring JSON saved before this field existed', () => {
		const legacySnapshot = buildAc9RequestJSON() as Partial<ReturnType<typeof buildAc9RequestJSON>>;
		delete legacySnapshot.sceneType;
		request.fromJSON(legacySnapshot);
		expect(request.sceneType).toBe('interior');
	});
});

describe('isFloorPlan', () => {
	it('defaults to false', () => {
		expect(request.isFloorPlan).toBe(false);
	});

	it('reset() reverts to false', () => {
		request.setIsFloorPlan(true);
		request.reset();
		expect(request.isFloorPlan).toBe(false);
	});

	it('round-trips through toJSON/fromJSON', () => {
		applyAc9Fixture();
		request.setIsFloorPlan(true);
		const snapshot = request.toJSON();
		request.reset();
		request.fromJSON(snapshot);
		expect(request.isFloorPlan).toBe(true);
	});

	it('defaults to false when restoring JSON saved before this field existed', () => {
		const legacySnapshot = buildAc9RequestJSON() as Partial<ReturnType<typeof buildAc9RequestJSON>>;
		delete legacySnapshot.isFloorPlan;
		request.fromJSON(legacySnapshot);
		expect(request.isFloorPlan).toBe(false);
	});

	it('prepends floor-plan instructions to the render body without altering request.prompt', () => {
		applyAc9Fixture();
		request.setIsFloorPlan(true);

		expect(request.prompt).toBe(AC9_PROMPT);

		const body = request.toRenderRequest();
		expect(body?.prompt).not.toBe(AC9_PROMPT);
		expect(body?.prompt.endsWith(AC9_PROMPT)).toBe(true);
		expect(body?.prompt.toLowerCase()).toContain('floor plan');
		expect(body).toEqual({ ...AC9_RENDER_REQUEST, prompt: body?.prompt });
	});

	it('leaves the render body unchanged when off', () => {
		applyAc9Fixture();
		expect(request.toRenderRequest()).toEqual(AC9_RENDER_REQUEST);
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

describe('toStyleTransferRequest', () => {
	it('reports missing source and reference images when no state is set', () => {
		expect(request.validateStyleTransfer()).toEqual({
			valid: false,
			missing: ['image', 'referenceImage']
		});
	});

	it('reports missing reference image when only the source is set', () => {
		request.setImage(AC9_IMAGE);
		expect(request.validateStyleTransfer()).toEqual({
			valid: false,
			missing: ['referenceImage']
		});
	});

	it('builds the wire body from the room photo and reference image', () => {
		applyAc9Fixture();
		request.setStyleSourceMode('room-photo');
		expect(request.toStyleTransferRequest(AC9_PROMPT)).toEqual(AC9_STYLE_TRANSFER_REQUEST);
	});

	it('uses the current result as the source when selected and available', () => {
		applyAc9Fixture();
		request.setCurrentRender({
			id: 'render-1',
			outputUrls: ['https://example.test/current-result.webp'],
			cost: 2,
			balance: 18,
			ts: 0
		});

		expect(request.toStyleTransferRequest(AC9_PROMPT)).toEqual({
			...AC9_STYLE_TRANSFER_REQUEST,
			image: 'https://example.test/current-result.webp'
		});
	});

	it('falls back to the room photo when current-result is selected before a result exists', () => {
		applyAc9Fixture();
		expect(request.toStyleTransferRequest(AC9_PROMPT)?.image).toBe(AC9_IMAGE.url);
	});

	it('omits optional prompt fields when they are empty', () => {
		request.setImage(AC9_IMAGE);
		request.setStyleReferenceImage(AC9_REFERENCE_IMAGE);
		request.setStyleNegativePrompt('   ');

		expect(request.toStyleTransferRequest('   ')).toEqual({
			image: AC9_IMAGE.url,
			referenceImage: AC9_REFERENCE_IMAGE.url,
			outputFormat: 'webp',
			styleTransferStrength: 0.7
		});
	});

	it('includes a trimmed negative prompt when set', () => {
		applyAc9Fixture();
		request.setStyleNegativePrompt('  no people  ');

		expect(request.toStyleTransferRequest(AC9_PROMPT)).toEqual({
			...AC9_STYLE_TRANSFER_REQUEST,
			negativePrompt: 'no people'
		});
	});

	it('uses explicit style guidance instead of the render prompt', () => {
		applyAc9Fixture();
		request.setPromptOverride('render prompt that must stay isolated');

		expect(request.toStyleTransferRequest('  style transfer guidance  ')).toEqual({
			...AC9_STYLE_TRANSFER_REQUEST,
			prompt: 'style transfer guidance'
		});
	});

	it('rejects strength values outside the provider range', () => {
		expect(() => request.setStyleTransferStrength(-0.1)).toThrow();
		expect(() => request.setStyleTransferStrength(1.1)).toThrow();
	});

	it('round-trips style transfer settings through JSON', () => {
		applyAc9Fixture();
		request.setStyleTransferStrength(0.35);
		request.setStyleNegativePrompt('no people');
		request.setStyleSourceMode('room-photo');
		const snapshot = request.toJSON();

		request.reset();
		request.fromJSON(snapshot);

		expect(request.toJSON()).toEqual(snapshot);
		expect(request.toStyleTransferRequest(AC9_PROMPT)).toEqual({
			...AC9_STYLE_TRANSFER_REQUEST,
			styleTransferStrength: 0.35,
			negativePrompt: 'no people'
		});
	});
});

describe('isObjectReplacement', () => {
	it('defaults to false', () => {
		expect(request.isObjectReplacement).toBe(false);
	});

	it('reset() reverts to false', () => {
		request.setIsObjectReplacement(true);
		request.reset();
		expect(request.isObjectReplacement).toBe(false);
	});

	it('round-trips through toJSON/fromJSON', () => {
		applyAc9Fixture();
		request.setIsObjectReplacement(true);
		const snapshot = request.toJSON();
		request.reset();
		request.fromJSON(snapshot);
		expect(request.isObjectReplacement).toBe(true);
	});

	it('defaults to false when restoring JSON saved before this field existed', () => {
		const legacySnapshot = buildAc9RequestJSON() as Partial<ReturnType<typeof buildAc9RequestJSON>>;
		delete legacySnapshot.isObjectReplacement;
		request.fromJSON(legacySnapshot);
		expect(request.isObjectReplacement).toBe(false);
	});

	it('prepends object-replacement instructions to the style transfer prompt', () => {
		applyAc9Fixture();
		request.setIsObjectReplacement(true);

		const body = request.toStyleTransferRequest(AC9_PROMPT);
		expect(body?.prompt).not.toBe(AC9_PROMPT);
		expect(body?.prompt?.endsWith(AC9_PROMPT)).toBe(true);
		expect(body?.prompt?.toLowerCase()).toContain('replace');
		expect(body).toEqual({ ...AC9_STYLE_TRANSFER_REQUEST, prompt: body?.prompt });
	});

	it('still injects the instruction when guidance is empty', () => {
		applyAc9Fixture();
		request.setIsObjectReplacement(true);

		const body = request.toStyleTransferRequest('   ');
		expect(body?.prompt).toBeTruthy();
		expect(body?.prompt?.toLowerCase()).toContain('replace');
	});

	it('leaves the style transfer prompt unchanged when off', () => {
		applyAc9Fixture();
		expect(request.toStyleTransferRequest(AC9_PROMPT)).toEqual(AC9_STYLE_TRANSFER_REQUEST);
	});
});

describe('edit lifecycle (FR-К4/К6)', () => {
	function render(id: string): RenderResult {
		return { id, outputUrls: [`https://example.test/${id}.jpg`], cost: 1, balance: 24, ts: 0 };
	}

	it('a fresh generation has nothing to undo', () => {
		request.setCurrentRender(render('gen-1'));
		expect(request.canUndoEdit).toBe(false);
	});

	it('applying an edit makes the prior render the undo target', () => {
		request.setCurrentRender(render('gen-1'));
		request.applyEditResult(render('edit-1'));

		expect(request.currentRender?.id).toBe('edit-1');
		expect(request.canUndoEdit).toBe(true);
	});

	it('undoing restores the render from before the last edit', () => {
		request.setCurrentRender(render('gen-1'));
		request.applyEditResult(render('edit-1'));

		request.undoLastEdit();

		expect(request.currentRender?.id).toBe('gen-1');
		expect(request.canUndoEdit).toBe(false);
	});

	it('undo is a no-op when there is nothing to undo', () => {
		request.setCurrentRender(render('gen-1'));

		request.undoLastEdit();

		expect(request.currentRender?.id).toBe('gen-1');
	});

	it('only holds a single undo step — a second edit replaces the earlier one', () => {
		request.setCurrentRender(render('gen-1'));
		request.applyEditResult(render('edit-1'));
		request.applyEditResult(render('edit-2'));

		request.undoLastEdit();

		expect(request.currentRender?.id).toBe('edit-1');
		expect(request.canUndoEdit).toBe(false);
	});

	it('a fresh generation clears any pending undo from a prior edit chain', () => {
		request.setCurrentRender(render('gen-1'));
		request.applyEditResult(render('edit-1'));

		request.setCurrentRender(render('gen-2'));

		expect(request.canUndoEdit).toBe(false);
	});

	it('reset() clears both the current and the undo target', () => {
		request.setCurrentRender(render('gen-1'));
		request.applyEditResult(render('edit-1'));

		request.reset();

		expect(request.currentRender).toBeUndefined();
		expect(request.canUndoEdit).toBe(false);
	});
});

describe('edit redo (symmetric one-step undo/redo, not a history tree — Д-16)', () => {
	function render(id: string): RenderResult {
		return { id, outputUrls: [`https://example.test/${id}.jpg`], cost: 1, balance: 24, ts: 0 };
	}

	it('there is nothing to redo before an undo happens', () => {
		request.setCurrentRender(render('gen-1'));
		request.applyEditResult(render('edit-1'));

		expect(request.canRedoEdit).toBe(false);
	});

	it('redo re-applies the edit that undo just reverted', () => {
		request.setCurrentRender(render('gen-1'));
		request.applyEditResult(render('edit-1'));
		request.undoLastEdit();

		request.redoEdit();

		expect(request.currentRender?.id).toBe('edit-1');
		expect(request.canRedoEdit).toBe(false);
		expect(request.canUndoEdit).toBe(true);
	});

	it('redo is a no-op when there is nothing to redo', () => {
		request.setCurrentRender(render('gen-1'));

		request.redoEdit();

		expect(request.currentRender?.id).toBe('gen-1');
	});

	it('a new edit after undo discards the redo target instead of continuing it', () => {
		request.setCurrentRender(render('gen-1'));
		request.applyEditResult(render('edit-1'));
		request.undoLastEdit();

		request.applyEditResult(render('edit-2'));

		expect(request.currentRender?.id).toBe('edit-2');
		expect(request.canRedoEdit).toBe(false);
	});

	it('a fresh generation clears any pending redo from a prior edit chain', () => {
		request.setCurrentRender(render('gen-1'));
		request.applyEditResult(render('edit-1'));
		request.undoLastEdit();

		request.setCurrentRender(render('gen-2'));

		expect(request.canRedoEdit).toBe(false);
	});

	it('reset() clears the redo target too', () => {
		request.setCurrentRender(render('gen-1'));
		request.applyEditResult(render('edit-1'));
		request.undoLastEdit();

		request.reset();

		expect(request.canRedoEdit).toBe(false);
	});
});
