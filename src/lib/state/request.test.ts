import { describe, it, expect, beforeEach } from 'vitest';
import { requestModel } from './request.svelte';
import type { ImageInput, SerializedRequest } from './request.svelte';

const TEST_IMAGE: ImageInput = {
	url: 'https://example.com/room.jpg',
	mime: 'image/jpeg',
	size: 204800,
	dimensions: [1280, 720]
};

beforeEach(() => {
	requestModel.reset();
});

// ── Prompt derivation ─────────────────────────────────────────────────────────

describe('prompt derivation', () => {
	it('is empty when no fragments', () => {
		expect(requestModel.prompt).toBe('');
	});

	it('concatenates fragment texts separated by spaces', () => {
		requestModel.addFragment({ text: 'modern living room' });
		requestModel.addFragment({ text: 'warm lighting' });
		expect(requestModel.prompt).toBe('modern living room warm lighting');
	});

	it('concatenates in ascending order, not insertion order', () => {
		const idA = requestModel.addFragment({ text: 'first' }); // order 0
		const idB = requestModel.addFragment({ text: 'second' }); // order 1
		// Manually set orders to reverse them
		requestModel.updateFragment(idA, { order: 10 });
		requestModel.updateFragment(idB, { order: 0 });
		expect(requestModel.prompt).toBe('second first');
	});

	it('skips blank fragment texts', () => {
		requestModel.addFragment({ text: 'hello' });
		requestModel.addFragment({ text: '' });
		requestModel.addFragment({ text: 'world' });
		expect(requestModel.prompt).toBe('hello world');
	});
});

// ── Reorder ───────────────────────────────────────────────────────────────────

describe('reorder', () => {
	it('updates order to match supplied id sequence', () => {
		const id1 = requestModel.addFragment({ text: 'A' });
		const id2 = requestModel.addFragment({ text: 'B' });
		const id3 = requestModel.addFragment({ text: 'C' });

		requestModel.reorder([id3, id1, id2]);

		expect(requestModel.prompt).toBe('C A B');
	});

	it('preserves fragments not in the supplied id list', () => {
		const id1 = requestModel.addFragment({ text: 'A' });
		requestModel.addFragment({ text: 'B' });

		requestModel.reorder([id1]);

		expect(requestModel.promptFragments).toHaveLength(2);
	});
});

// ── Prompt override ───────────────────────────────────────────────────────────

describe('prompt override', () => {
	it('setPrompt overrides derived value', () => {
		requestModel.addFragment({ text: 'from fragment' });
		requestModel.setPrompt('manual override');
		expect(requestModel.prompt).toBe('manual override');
		expect(requestModel.hasPromptOverride).toBe(true);
	});

	it('override persists when fragments change', () => {
		requestModel.setPrompt('override');
		requestModel.addFragment({ text: 'fragment' });
		expect(requestModel.prompt).toBe('override');
	});

	it('clearPromptOverride restores derived value', () => {
		requestModel.addFragment({ text: 'derived' });
		requestModel.setPrompt('override');
		requestModel.clearPromptOverride();
		expect(requestModel.prompt).toBe('derived');
		expect(requestModel.hasPromptOverride).toBe(false);
	});
});

// ── Validate ──────────────────────────────────────────────────────────────────

describe('validate', () => {
	it('returns both fields missing when model is empty', () => {
		const result = requestModel.validate();
		expect(result.valid).toBe(false);
		expect(result.missing).toContain('image');
		expect(result.missing).toContain('prompt');
	});

	it('returns image missing when only prompt is set', () => {
		requestModel.addFragment({ text: 'some prompt' });
		const result = requestModel.validate();
		expect(result.valid).toBe(false);
		expect(result.missing).toEqual(['image']);
	});

	it('returns prompt missing when only image is set', () => {
		requestModel.setImage(TEST_IMAGE);
		const result = requestModel.validate();
		expect(result.valid).toBe(false);
		expect(result.missing).toEqual(['prompt']);
	});

	it('is valid when both image and non-empty prompt are present', () => {
		requestModel.setImage(TEST_IMAGE);
		requestModel.addFragment({ text: 'cozy interior' });
		const result = requestModel.validate();
		expect(result.valid).toBe(true);
		expect(result.missing).toHaveLength(0);
	});

	it('treats whitespace-only prompt as missing', () => {
		requestModel.setImage(TEST_IMAGE);
		requestModel.addFragment({ text: '   ' });
		expect(requestModel.validate().valid).toBe(false);
	});
});

// ── canSubmit (double-submit guard) ──────────────────────────────────────────

describe('canSubmit', () => {
	it('is false while status is submitting', () => {
		requestModel.setImage(TEST_IMAGE);
		requestModel.addFragment({ text: 'prompt' });
		requestModel.setStatus('submitting');
		expect(requestModel.canSubmit()).toBe(false);
	});

	it('is true when valid and idle', () => {
		requestModel.setImage(TEST_IMAGE);
		requestModel.addFragment({ text: 'prompt' });
		expect(requestModel.canSubmit()).toBe(true);
	});
});

// ── Serialization round-trip ──────────────────────────────────────────────────

describe('toJSON / fromJSON', () => {
	it('round-trips model fields', () => {
		requestModel.setImage(TEST_IMAGE);
		requestModel.addFragment({ text: 'scandinavian style', label: 'Style' });
		requestModel.addFragment({ text: 'natural light', label: 'Lighting' });
		requestModel.setOutputFormat('png');

		const snapshot = requestModel.toJSON();
		requestModel.reset();
		requestModel.fromJSON(snapshot);

		expect(requestModel.image).toEqual(TEST_IMAGE);
		expect(requestModel.promptFragments).toHaveLength(2);
		expect(requestModel.outputFormat).toBe('png');
		expect(requestModel.prompt).toBe(snapshot.prompt);
	});

	it('restores prompt override across round-trip', () => {
		requestModel.addFragment({ text: 'fragment text' });
		requestModel.setPrompt('manual prompt');

		const snapshot = requestModel.toJSON();
		requestModel.reset();
		requestModel.fromJSON(snapshot);

		expect(requestModel.prompt).toBe('manual prompt');
		expect(requestModel.hasPromptOverride).toBe(true);
	});

	it('serialized prompt matches derived prompt', () => {
		requestModel.addFragment({ text: 'A' });
		requestModel.addFragment({ text: 'B' });
		const snapshot = requestModel.toJSON();
		expect(snapshot.prompt).toBe(requestModel.prompt);
	});

	it('deep-copies image dimensions array', () => {
		requestModel.setImage(TEST_IMAGE);
		const snapshot = requestModel.toJSON();
		expect(snapshot.image?.dimensions).not.toBe(TEST_IMAGE.dimensions);
		expect(snapshot.image?.dimensions).toEqual(TEST_IMAGE.dimensions);
	});
});

// ── Reset ─────────────────────────────────────────────────────────────────────

describe('reset', () => {
	it('clears all model data', () => {
		requestModel.setImage(TEST_IMAGE);
		requestModel.addFragment({ text: 'test' });
		requestModel.setOutputFormat('jpg');
		requestModel.setPrompt('override');
		requestModel.setCurrentRender({
			id: 'r1',
			outputUrls: ['https://example.com/result.jpg'],
			cost: 1,
			balance: 99,
			ts: Date.now()
		});

		requestModel.reset();

		expect(requestModel.image).toBeUndefined();
		expect(requestModel.promptFragments).toHaveLength(0);
		expect(requestModel.outputFormat).toBe('webp');
		expect(requestModel.prompt).toBe('');
		expect(requestModel.hasPromptOverride).toBe(false);
		expect(requestModel.currentRender).toBeUndefined();
		expect(requestModel.status).toBe('idle');
	});

	it('generates a new id on reset', () => {
		const idBefore = requestModel.id;
		requestModel.reset();
		expect(requestModel.id).not.toBe(idBefore);
	});
});

// ── AC-9 fixture helper ───────────────────────────────────────────────────────
// Builds a deterministic model state. Used by Playwright e2e tests to verify
// that the same content entered via different UIs produces identical prompts
// and request payloads.

export function buildAc9Fixture(): SerializedRequest {
	requestModel.reset();
	requestModel.setImage(TEST_IMAGE);
	requestModel.addFragment({ text: 'bright scandinavian style', label: 'Стиль' });
	requestModel.addFragment({ text: 'warm natural lighting', label: 'Освещение' });
	requestModel.addFragment({ text: 'minimalist furniture', label: 'Мебель' });
	requestModel.setOutputFormat('webp');
	return requestModel.toJSON();
}

describe('AC-9 fixture', () => {
	it('produces a deterministic prompt regardless of call order', () => {
		const snap1 = buildAc9Fixture();
		const snap2 = buildAc9Fixture();
		expect(snap1.prompt).toBe(snap2.prompt);
	});

	it('content is byte-identical across two builds (IDs are random, excluded)', () => {
		const snap1 = buildAc9Fixture();
		const snap2 = buildAc9Fixture();
		// UUIDs (model id and fragment ids) are random — strip them before comparing.
		// AC-9 identity is about prompt text, fragment content, image, and outputFormat.
		const normalize = ({ promptFragments, ...rest }: SerializedRequest) => ({
			...rest,
			id: undefined,
			promptFragments: promptFragments.map(({ id: _, ...f }) => f)
		});
		expect(JSON.stringify(normalize(snap1))).toBe(JSON.stringify(normalize(snap2)));
	});
});
