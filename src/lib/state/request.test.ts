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

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	AC9_IMAGE,
	AC9_PROJECT_ID,
	AC9_PROMPT,
	AC9_REFERENCE_IMAGE,
	AC9_RENDER_REQUEST,
	AC9_SESSION_ID,
	AC9_STYLE_TRANSFER_REQUEST,
	applyAc9Fixture,
	buildAc9RequestJSON
} from '$lib/state/request-fixtures';
import {
	RequestImageUploadError,
	RequestProjectSessionError,
	RequestReorderError,
	request,
	RequestState,
	type RenderResult
} from '$lib/state/request.svelte';

beforeEach(() => {
	request.reset();
	// Most tests don't care about project/session assignment at all — pre-set
	// one so every toXRequest() call's ensureProjectSession() resolves from
	// state instead of hitting the network. Tests that actually exercise
	// ensureProjectSession()'s own lazy-creation behavior clear it explicitly.
	request.setProjectSession(AC9_PROJECT_ID, AC9_SESSION_ID);
});

afterEach(() => {
	vi.unstubAllGlobals();
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
		delete snapshot.editPrompt;
		delete snapshot.styleReferenceImage;
		delete snapshot.styleTransferPrompt;
		delete snapshot.styleTransferStrength;
		delete snapshot.styleNegativePrompt;
		delete snapshot.styleSourceMode;
		delete snapshot.objectReferenceImage;
		delete snapshot.objectReplacementObject;
		delete snapshot.objectReplacementSourceMode;
		delete snapshot.textureReferenceImage;
		delete snapshot.textureMaskImage;
		delete snapshot.textureMaskSourceUrl;
		delete snapshot.textureReplacementSurface;
		delete snapshot.textureReplacementSourceMode;
		delete snapshot.textureReplacementMasked;

		request.fromJSON(snapshot);

		expect(request.toJSON()).toEqual({
			...snapshot,
			editPrompt: '',
			styleReferenceImage: undefined,
			objectReferenceImage: undefined,
			textureReferenceImage: undefined,
			textureMaskImage: undefined,
			textureMaskSourceUrl: undefined,
			styleTransferPrompt: '',
			styleTransferStrength: 0.7,
			styleNegativePrompt: '',
			styleSourceMode: 'current-result',
			objectReplacementObject: '',
			objectReplacementSourceMode: 'current-result',
			textureReplacementSurface: '',
			textureReplacementSourceMode: 'current-result',
			textureReplacementMasked: false,
			currentRender: undefined
		});
	});

	it('does not serialize or restore an active object replacement job', () => {
		applyAc9Fixture();
		request.setActiveObjectReplacementJobId('123e4567-e89b-42d3-a456-426614174000');
		const snapshot = request.toJSON();
		expect(snapshot).not.toHaveProperty('activeObjectReplacementJobId');

		request.fromJSON(snapshot);

		expect(request.activeObjectReplacementJobId).toBeUndefined();
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

describe('copyFrom', () => {
	it('copies every field, including ones toJSON/fromJSON deliberately omit', () => {
		applyAc9Fixture();
		request.setProjectSession(AC9_PROJECT_ID, AC9_SESSION_ID);
		request.setActiveObjectReplacementJobId('123e4567-e89b-42d3-a456-426614174000');
		request.setStatus('rendering');
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

		const other = new RequestState();
		other.copyFrom(request);

		expect(other.toJSON()).toEqual(request.toJSON());
		expect(other.id).toBe(request.id);
		expect(other.projectId).toBe(request.projectId);
		expect(other.sessionId).toBe(request.sessionId);
		expect(other.status).toBe('rendering');
		expect(other.activeObjectReplacementJobId).toBe(request.activeObjectReplacementJobId);
		expect(other.canUndoEdit).toBe(true);
		expect(other.currentRender).toEqual(request.currentRender);
	});

	it('copies a pending, not-yet-uploaded image via its own File reference', () => {
		const file = new File(['bytes'], 'room.jpg', { type: 'image/jpeg' });
		request.setPendingImage(file);

		const other = new RequestState();
		other.copyFrom(request);

		expect(other.pendingImageFile).toBe(file);
		expect(other.pendingImagePreviewUrl).toBeDefined();
		expect(other.image).toBeUndefined();
	});

	it('does not share mutable object references with the source', () => {
		applyAc9Fixture();
		const other = new RequestState();
		other.copyFrom(request);

		expect(other.promptFragments).not.toBe(request.promptFragments);
		expect(other.image).not.toBe(request.image);

		request.setEditPrompt('mutated after copy');
		expect(other.editPrompt).not.toBe(request.editPrompt);
	});

	it('leaves the source instance untouched', () => {
		applyAc9Fixture();
		const snapshotBefore = request.toJSON();

		const other = new RequestState();
		other.copyFrom(request);

		expect(request.toJSON()).toEqual(snapshotBefore);
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

	it('distinguishes current-result source mode by the actual render selected', () => {
		// objectReplacementSourceMode defaults to 'current-result', so the
		// effective source is currentRender.outputUrls[0], not `image` — two
		// states with the same `image` but different current renders submit
		// different request bodies and must not normalize as equal.
		request.setCurrentRender({
			id: 'gen-1',
			outputUrls: ['https://example.test/gen-1.jpg'],
			cost: 1,
			balance: 24,
			ts: 0
		});
		const first = request.normalizeForComparison();

		request.setCurrentRender({
			id: 'gen-2',
			outputUrls: ['https://example.test/gen-2.jpg'],
			cost: 1,
			balance: 24,
			ts: 1
		});
		const second = request.normalizeForComparison();

		expect(first.objectReplacementSourceUrl).toBe('https://example.test/gen-1.jpg');
		expect(second.objectReplacementSourceUrl).toBe('https://example.test/gen-2.jpg');
		expect(second).not.toEqual(first);
	});

	it('normalizes texture replacement by active mode independently of prior mode history', async () => {
		const textureReference = { url: 'https://example.test/reference-fabric.webp' };
		const textureMask = { url: 'https://example.test/sofa-mask.webp' };

		request.setImage(AC9_IMAGE);
		request.setTextureReferenceImage(textureReference);
		request.setTextureMaskImage(textureMask);
		request.setTextureReplacementSourceMode('room-photo');
		request.setTextureReplacementSurface('sofa upholstery');
		const automaticNormalization = request.normalizeForComparison();
		const automaticPayload = await request.toTextureReplacementRequest();

		request.reset();
		request.setProjectSession(AC9_PROJECT_ID, AC9_SESSION_ID);
		request.setImage(AC9_IMAGE);
		request.setTextureReferenceImage(textureReference);
		request.setTextureReplacementSourceMode('room-photo');
		request.setTextureReplacementSurface('sofa upholstery');
		expect(request.normalizeForComparison()).toEqual(automaticNormalization);
		expect(await request.toTextureReplacementRequest()).toEqual(automaticPayload);
		expect(automaticNormalization.textureMaskImage).toBeUndefined();

		request.setTextureReplacementMasked(true);
		request.setTextureMaskImage(textureMask);
		request.setTextureReplacementSurface('stale surface');
		const maskedNormalization = request.normalizeForComparison();
		const maskedPayload = await request.toTextureReplacementRequest();

		request.reset();
		request.setProjectSession(AC9_PROJECT_ID, AC9_SESSION_ID);
		request.setImage(AC9_IMAGE);
		request.setTextureReferenceImage(textureReference);
		request.setTextureReplacementSourceMode('room-photo');
		request.setTextureReplacementMasked(true);
		request.setTextureMaskImage(textureMask);
		expect(request.normalizeForComparison()).toEqual(maskedNormalization);
		expect(await request.toTextureReplacementRequest()).toEqual(maskedPayload);
		expect(maskedNormalization.textureReplacementSurface).toBe('');
	});
});

describe('sceneType', () => {
	it('defaults to interior', () => {
		expect(request.sceneType).toBe('interior');
	});

	it('setSceneType updates the UI routing value without changing the render body', async () => {
		applyAc9Fixture();
		request.setSceneType('exterior');
		expect(request.sceneType).toBe('exterior');
		expect(await request.toRenderRequest()).toEqual(AC9_RENDER_REQUEST);
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

describe('textureReplacementResultReady (session UI state)', () => {
	it('reset() clears a result-ready flag left over from a prior masked replacement', () => {
		request.setTextureReplacementResultReady(true);
		request.reset();
		expect(request.textureReplacementResultReady).toBe(false);
	});

	it('fromJSON() clears a result-ready flag so a loaded request starts on the mask-drawing surface', () => {
		request.setTextureReplacementResultReady(true);
		const snapshot = request.toJSON();
		request.fromJSON(snapshot);
		expect(request.textureReplacementResultReady).toBe(false);
	});
});

describe('toRenderRequest', () => {
	it('returns the wire body for a valid AC-9 fixture', async () => {
		applyAc9Fixture();
		expect(await request.toRenderRequest()).toEqual(AC9_RENDER_REQUEST);
		expect(request.prompt).toBe(AC9_PROMPT);
	});

	it('returns null when invalid', async () => {
		expect(await request.toRenderRequest()).toBeNull();
	});

	it('uploads a pending file lazily on submit and caches the result on image', async () => {
		const file = new File(['bytes'], 'room.jpg', { type: 'image/jpeg' });
		request.setPendingImage(file);
		const uploadResult = {
			url: 'https://example.test/uploaded-room.webp',
			mime: 'image/webp',
			size: 1234,
			hash: 'deadbeef'
		};
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			json: () => Promise.resolve(uploadResult)
		});
		vi.stubGlobal('fetch', fetchMock);

		const body = await request.toRenderRequest();

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(body?.image).toBe(uploadResult.url);
		expect(body?.imageHash).toBe(uploadResult.hash);
		expect(request.image?.url).toBe(uploadResult.url);
		expect(request.pendingImageFile).toBeUndefined();
	});

	it('throws RequestImageUploadError when the deferred upload fails', async () => {
		const file = new File(['bytes'], 'room.jpg', { type: 'image/jpeg' });
		request.setPendingImage(file);
		const fetchMock = vi.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve(null) });
		vi.stubGlobal('fetch', fetchMock);

		await expect(request.toRenderRequest()).rejects.toThrow(RequestImageUploadError);
	});
});

describe('ensureProjectSession', () => {
	it('reuses an already-set session without any network call', async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);

		const result = await request.ensureProjectSession();

		expect(result).toEqual({ projectId: AC9_PROJECT_ID, sessionId: AC9_SESSION_ID });
		expect(fetchMock).not.toHaveBeenCalled();
	});

	const NEW_PROJECT_ID = '00000000-0000-4000-8000-000000000201';
	const NEW_SESSION_ID = '00000000-0000-4000-8000-000000000202';

	it('lazily creates and caches an Untitled project+session when none is set', async () => {
		request.clearProjectSession();
		const fetchMock = vi.fn(async (url: string) => {
			if (url === '/api/projects') {
				return {
					ok: true,
					json: () =>
						Promise.resolve({
							id: NEW_PROJECT_ID,
							title: 'Untitled',
							createdAt: 0,
							updatedAt: 0
						})
				};
			}
			if (url === `/api/projects/${NEW_PROJECT_ID}/sessions`) {
				return {
					ok: true,
					json: () => Promise.resolve({ id: NEW_SESSION_ID, title: '', createdAt: 0, updatedAt: 0 })
				};
			}
			throw new Error(`unexpected fetch: ${url}`);
		});
		vi.stubGlobal('fetch', fetchMock);

		const first = await request.ensureProjectSession();
		expect(first).toEqual({ projectId: NEW_PROJECT_ID, sessionId: NEW_SESSION_ID });
		expect(request.projectId).toBe(NEW_PROJECT_ID);
		expect(request.sessionId).toBe(NEW_SESSION_ID);
		expect(fetchMock).toHaveBeenCalledTimes(2);

		const second = await request.ensureProjectSession();
		expect(second).toEqual(first);
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it('dedupes two concurrent calls into a single project+session provisioning', async () => {
		request.clearProjectSession();
		let resolveProject!: (value: unknown) => void;
		let resolveSession!: (value: unknown) => void;
		const projectResponse = new Promise((resolve) => {
			resolveProject = resolve;
		});
		const sessionResponse = new Promise((resolve) => {
			resolveSession = resolve;
		});
		const fetchMock = vi.fn(async (url: string) => {
			if (url === '/api/projects') return { ok: true, json: () => projectResponse };
			if (url === `/api/projects/${NEW_PROJECT_ID}/sessions`) {
				return { ok: true, json: () => sessionResponse };
			}
			throw new Error(`unexpected fetch: ${url}`);
		});
		vi.stubGlobal('fetch', fetchMock);

		// Both calls start before either provisioning response resolves — the
		// second must reuse the first's in-flight promise (#pendingProjectSession)
		// instead of firing its own duplicate POSTs.
		const firstCall = request.ensureProjectSession();
		const secondCall = request.ensureProjectSession();

		resolveProject({ id: NEW_PROJECT_ID, title: 'Untitled', createdAt: 0, updatedAt: 0 });
		resolveSession({ id: NEW_SESSION_ID, title: '', createdAt: 0, updatedAt: 0 });

		const [first, second] = await Promise.all([firstCall, secondCall]);
		expect(first).toEqual({ projectId: NEW_PROJECT_ID, sessionId: NEW_SESSION_ID });
		expect(second).toEqual(first);
		expect(fetchMock.mock.calls.filter(([url]) => url === '/api/projects')).toHaveLength(1);
		expect(
			fetchMock.mock.calls.filter(([url]) => url === `/api/projects/${NEW_PROJECT_ID}/sessions`)
		).toHaveLength(1);
	});

	it('throws RequestProjectSessionError when project creation fails', async () => {
		request.clearProjectSession();
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));

		await expect(request.ensureProjectSession()).rejects.toThrow(RequestProjectSessionError);
	});

	it('throws RequestProjectSessionError when the project creation response is malformed', async () => {
		request.clearProjectSession();
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ id: 'not-a-uuid' }) })
		);

		await expect(request.ensureProjectSession()).rejects.toThrow(RequestProjectSessionError);
	});

	it('throws RequestProjectSessionError when session creation fails', async () => {
		request.clearProjectSession();
		const fetchMock = vi.fn(async (url: string) => {
			if (url === '/api/projects') {
				return {
					ok: true,
					json: () =>
						Promise.resolve({
							id: NEW_PROJECT_ID,
							title: 'Untitled',
							createdAt: 0,
							updatedAt: 0
						})
				};
			}
			return { ok: false };
		});
		vi.stubGlobal('fetch', fetchMock);

		await expect(request.ensureProjectSession()).rejects.toThrow(RequestProjectSessionError);
	});

	it('reuses the already-created project when retrying after a session-creation failure', async () => {
		request.clearProjectSession();
		let projectPosts = 0;
		let sessionAttempts = 0;
		const fetchMock = vi.fn(async (url: string) => {
			if (url === '/api/projects') {
				projectPosts += 1;
				return {
					ok: true,
					json: () =>
						Promise.resolve({
							id: NEW_PROJECT_ID,
							title: 'Untitled',
							createdAt: 0,
							updatedAt: 0
						})
				};
			}
			if (url === `/api/projects/${NEW_PROJECT_ID}/sessions`) {
				sessionAttempts += 1;
				if (sessionAttempts === 1) return { ok: false };
				return {
					ok: true,
					json: () => Promise.resolve({ id: NEW_SESSION_ID, title: '', createdAt: 0, updatedAt: 0 })
				};
			}
			throw new Error(`unexpected fetch: ${url}`);
		});
		vi.stubGlobal('fetch', fetchMock);

		await expect(request.ensureProjectSession()).rejects.toThrow(RequestProjectSessionError);

		const result = await request.ensureProjectSession();
		expect(result).toEqual({ projectId: NEW_PROJECT_ID, sessionId: NEW_SESSION_ID });
		// The retry must not create a second "Untitled" project — only the
		// session POST is retried, reusing the project the first attempt
		// already created.
		expect(projectPosts).toBe(1);
		expect(sessionAttempts).toBe(2);
	});

	it('ignores a session-creation response that resolves after reset() has already run', async () => {
		request.clearProjectSession();
		let resolveSession!: (response: unknown) => void;
		const sessionPromise = new Promise((resolve) => {
			resolveSession = resolve;
		});
		const fetchMock = vi.fn(async (url: string) => {
			if (url === '/api/projects') {
				return {
					ok: true,
					json: () =>
						Promise.resolve({
							id: NEW_PROJECT_ID,
							title: 'Untitled',
							createdAt: 0,
							updatedAt: 0
						})
				};
			}
			if (url === `/api/projects/${NEW_PROJECT_ID}/sessions`) {
				return sessionPromise as Promise<{ ok: boolean; json: () => Promise<unknown> }>;
			}
			throw new Error(`unexpected fetch: ${url}`);
		});
		vi.stubGlobal('fetch', fetchMock);

		const promise = request.ensureProjectSession();

		// The user resets the request (e.g. starting fresh work) before the
		// still-in-flight session POST above resolves.
		request.reset();

		resolveSession({
			ok: true,
			json: () => Promise.resolve({ id: NEW_SESSION_ID, title: '', createdAt: 0, updatedAt: 0 })
		});
		await expect(promise).rejects.toThrow(RequestProjectSessionError);

		// The now-superseded response must not repopulate projectId/sessionId
		// on what's supposed to be a freshly reset request.
		expect(request.projectId).toBeUndefined();
		expect(request.sessionId).toBeUndefined();

		// A retry must not reuse the abandoned, pre-reset project — reset()
		// invalidated it, so this has to POST a brand new one.
		const projectPostsBeforeRetry = fetchMock.mock.calls.filter(
			([url]) => url === '/api/projects'
		).length;
		await request.ensureProjectSession();
		const projectPostsAfterRetry = fetchMock.mock.calls.filter(
			([url]) => url === '/api/projects'
		).length;
		expect(projectPostsAfterRetry).toBe(projectPostsBeforeRetry + 1);
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

	it('builds the wire body from the room photo and reference image', async () => {
		applyAc9Fixture();
		request.setStyleSourceMode('room-photo');
		expect(await request.toStyleTransferRequest()).toEqual(AC9_STYLE_TRANSFER_REQUEST);
	});

	it('uses the current result as the source when selected and available', async () => {
		applyAc9Fixture();
		request.setCurrentRender({
			id: 'render-1',
			outputUrls: ['https://example.test/current-result.webp'],
			cost: 2,
			balance: 18,
			ts: 0
		});

		expect(await request.toStyleTransferRequest()).toEqual({
			...AC9_STYLE_TRANSFER_REQUEST,
			image: 'https://example.test/current-result.webp'
		});
	});

	it('falls back to the room photo when current-result is selected before a result exists', async () => {
		applyAc9Fixture();
		expect((await request.toStyleTransferRequest())?.image).toBe(AC9_IMAGE.url);
	});

	it('omits optional prompt fields when they are empty', async () => {
		request.setImage(AC9_IMAGE);
		request.setStyleReferenceImage(AC9_REFERENCE_IMAGE);
		request.setStyleTransferPrompt('   ');
		request.setStyleNegativePrompt('   ');

		expect(await request.toStyleTransferRequest()).toEqual({
			image: AC9_IMAGE.url,
			referenceImage: AC9_REFERENCE_IMAGE.url,
			outputFormat: 'webp',
			styleTransferStrength: 0.7,
			sessionId: AC9_SESSION_ID
		});
	});

	it('includes a trimmed negative prompt when set', async () => {
		applyAc9Fixture();
		request.setStyleNegativePrompt('  no people  ');

		expect(await request.toStyleTransferRequest()).toEqual({
			...AC9_STYLE_TRANSFER_REQUEST,
			negativePrompt: 'no people'
		});
	});

	it('uses explicit style guidance instead of the render prompt', async () => {
		applyAc9Fixture();
		request.setPromptOverride('render prompt that must stay isolated');
		request.setStyleTransferPrompt('  style transfer guidance  ');

		expect(await request.toStyleTransferRequest()).toEqual({
			...AC9_STYLE_TRANSFER_REQUEST,
			prompt: 'style transfer guidance'
		});
	});

	it('rejects strength values outside the provider range', () => {
		expect(() => request.setStyleTransferStrength(-0.1)).toThrow();
		expect(() => request.setStyleTransferStrength(1.1)).toThrow();
	});

	it('round-trips style transfer settings through JSON', async () => {
		applyAc9Fixture();
		request.setStyleTransferStrength(0.35);
		request.setStyleTransferPrompt('style guidance');
		request.setStyleNegativePrompt('no people');
		request.setStyleSourceMode('room-photo');
		const snapshot = request.toJSON();

		request.reset();
		request.setProjectSession(AC9_PROJECT_ID, AC9_SESSION_ID);
		request.fromJSON(snapshot);

		expect(request.toJSON()).toEqual(snapshot);
		expect(await request.toStyleTransferRequest()).toEqual({
			...AC9_STYLE_TRANSFER_REQUEST,
			prompt: 'style guidance',
			styleTransferStrength: 0.35,
			negativePrompt: 'no people'
		});
	});
});

describe('toObjectReplacementRequest', () => {
	const objectReference = {
		url: 'https://example.test/reference-chair.webp',
		mime: 'image/webp'
	};

	it('reports every required field when the form is empty', async () => {
		expect(request.validateObjectReplacement()).toEqual({
			valid: false,
			missing: ['image', 'referenceImage', 'replacementObject']
		});
		expect(await request.toObjectReplacementRequest()).toBeNull();
	});

	it('builds the exact request with trimmed scene-object text', async () => {
		request.setImage(AC9_IMAGE);
		request.setObjectReferenceImage(objectReference);
		request.setObjectReplacementSourceMode('room-photo');
		request.setObjectReplacementObject('  gray sofa by the window  ');

		expect(await request.toObjectReplacementRequest()).toEqual({
			image: AC9_IMAGE.url,
			referenceImage: objectReference.url,
			replacementObject: 'gray sofa by the window',
			sessionId: AC9_SESSION_ID
		});
	});

	it('uses the current result when selected and falls back to the room photo', async () => {
		request.setImage(AC9_IMAGE);
		request.setObjectReferenceImage(objectReference);
		request.setObjectReplacementObject('sofa');
		expect((await request.toObjectReplacementRequest())?.image).toBe(AC9_IMAGE.url);

		request.setCurrentRender({
			id: 'render-1',
			outputUrls: ['https://example.test/current-result.webp'],
			cost: 2,
			balance: 18,
			ts: 0
		});

		expect((await request.toObjectReplacementRequest())?.image).toBe(
			'https://example.test/current-result.webp'
		);
	});

	it('enforces the endpoint text limit and job-id shape', () => {
		expect(() => request.setObjectReplacementObject('x'.repeat(201))).toThrow();
		expect(() => request.setActiveObjectReplacementJobId('not-a-job-id')).toThrow();
		request.setObjectReplacementObject('x'.repeat(200));
		request.setActiveObjectReplacementJobId('123e4567-e89b-42d3-a456-426614174000');
		expect(request.objectReplacementObject).toHaveLength(200);
		expect(request.activeObjectReplacementJobId).toBe('123e4567-e89b-42d3-a456-426614174000');
	});

	it('retains an immutable source snapshot and instruction for the accepted job', () => {
		const source: RenderResult = {
			id: 'source-render',
			outputUrls: ['https://example.test/source.webp'],
			cost: 1,
			balance: 19,
			ts: 1
		};
		request.setActiveObjectReplacementJob(
			'123e4567-e89b-42d3-a456-426614174000',
			source,
			'gray sofa'
		);
		source.outputUrls[0] = 'https://example.test/mutated.webp';
		request.setObjectReplacementObject('changed after submission');

		expect(request.activeObjectReplacementJob).toEqual({
			id: '123e4567-e89b-42d3-a456-426614174000',
			instruction: 'gray sofa',
			sourceRender: {
				id: 'source-render',
				outputUrls: ['https://example.test/source.webp'],
				cost: 1,
				balance: 19,
				ts: 1
			}
		});
	});
});

describe('toTextureReplacementRequest', () => {
	const textureReference = { url: 'https://example.test/reference-fabric.webp' };
	const textureMask = { url: 'https://example.test/sofa-mask.webp' };

	it('requires a surface for automatic replacement', () => {
		expect(request.validateTextureReplacement()).toEqual({
			valid: false,
			missing: ['image', 'referenceImage', 'replacementSurface']
		});
	});

	it('builds the existing automatic replacement payload unchanged', async () => {
		request.setImage(AC9_IMAGE);
		request.setTextureReferenceImage(textureReference);
		request.setTextureReplacementSourceMode('room-photo');
		request.setTextureReplacementSurface('  sofa upholstery  ');

		expect(await request.toTextureReplacementRequest()).toEqual({
			image: AC9_IMAGE.url,
			referenceImage: textureReference.url,
			replacementSurface: 'sofa upholstery',
			sessionId: AC9_SESSION_ID
		});
	});

	it('requires a mask instead of a surface in masked mode', () => {
		request.setTextureReplacementMasked(true);

		expect(request.validateTextureReplacement()).toEqual({
			valid: false,
			missing: ['image', 'referenceImage', 'mask']
		});
	});

	it('builds a masked reference-image payload without the hidden surface', async () => {
		request.setImage(AC9_IMAGE);
		request.setTextureReferenceImage(textureReference);
		request.setTextureReplacementSourceMode('room-photo');
		request.setTextureMaskImage(textureMask);
		request.setTextureReplacementSurface('sofa upholstery');
		request.setTextureReplacementMasked(true);

		expect(await request.toTextureReplacementRequest()).toEqual({
			image: AC9_IMAGE.url,
			referenceImage: textureReference.url,
			mask: textureMask.url,
			sessionId: AC9_SESSION_ID
		});
	});

	it('round-trips and resets masked replacement state', () => {
		request.setImage(AC9_IMAGE);
		request.setTextureReplacementSourceMode('room-photo');
		request.setTextureMaskImage(textureMask);
		request.setTextureReplacementMasked(true);
		const snapshot = request.toJSON();

		request.reset();
		request.fromJSON(snapshot);
		expect(request.textureMaskImage).toEqual(textureMask);
		expect(request.textureMaskSourceUrl).toBe(AC9_IMAGE.url);
		expect(request.textureReplacementMasked).toBe(true);

		request.reset();
		expect(request.textureMaskImage).toBeUndefined();
		expect(request.textureMaskSourceUrl).toBeUndefined();
		expect(request.textureReplacementMasked).toBe(false);
	});

	it('rejects a stale mask after the effective source changes', async () => {
		request.setImage(AC9_IMAGE);
		request.setTextureReferenceImage(textureReference);
		request.setTextureReplacementSourceMode('room-photo');
		request.setTextureReplacementMasked(true);
		request.setTextureMaskImage(textureMask);

		request.setImage({ url: 'https://example.test/another-room.webp' });

		expect(request.textureMaskMatchesSource()).toBe(false);
		expect(request.validateTextureReplacement()).toEqual({ valid: false, missing: ['mask'] });
		expect(await request.toTextureReplacementRequest()).toBeNull();
	});

	it('ignores a mask upload that finishes after the source changes', () => {
		request.setImage(AC9_IMAGE);
		request.setTextureReplacementSourceMode('room-photo');
		request.setTextureReplacementMasked(true);
		const operation = request.beginTextureMaskUpload();
		if (!operation) throw new Error('Expected a texture mask upload operation');
		request.setImage({ url: 'https://example.test/another-room.webp' });

		expect(request.commitTextureMaskUpload(textureMask, operation)).toBe(false);

		expect(request.textureMaskImage).toBeUndefined();
		expect(request.textureMaskSourceUrl).toBeUndefined();
	});

	it('allows only the latest mask upload to commit for the same source', () => {
		request.setImage(AC9_IMAGE);
		request.setTextureReplacementSourceMode('room-photo');
		request.setTextureReplacementMasked(true);
		const first = request.beginTextureMaskUpload();
		const second = request.beginTextureMaskUpload();
		if (!first || !second) throw new Error('Expected texture mask upload operations');
		expect(request.textureMaskUploading).toBe(true);

		expect(request.commitTextureMaskUpload(textureMask, second)).toBe(true);
		expect(request.textureMaskUploading).toBe(false);
		expect(
			request.commitTextureMaskUpload({ url: 'https://example.test/stale-mask.webp' }, first)
		).toBe(false);
		expect(request.textureMaskImage).toEqual(textureMask);
	});

	it('invalidates an upload when masked mode is toggled off', () => {
		request.setImage(AC9_IMAGE);
		request.setTextureReplacementSourceMode('room-photo');
		request.setTextureReplacementMasked(true);
		const operation = request.beginTextureMaskUpload();
		if (!operation) throw new Error('Expected a texture mask upload operation');

		request.setTextureReplacementMasked(false);
		expect(request.textureMaskUploading).toBe(false);
		request.setTextureReplacementMasked(true);

		expect(request.commitTextureMaskUpload(textureMask, operation)).toBe(false);
		expect(request.textureMaskImage).toBeUndefined();
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

	it('every edit is its own undoable step — undo walks back through all of them', () => {
		request.setCurrentRender(render('gen-1'));
		request.applyEditResult(render('edit-1'));
		request.applyEditResult(render('edit-2'));

		request.undoLastEdit();
		expect(request.currentRender?.id).toBe('edit-1');
		expect(request.canUndoEdit).toBe(true);

		request.undoLastEdit();
		expect(request.currentRender?.id).toBe('gen-1');
		expect(request.canUndoEdit).toBe(false);
	});

	it('a fresh generation is a new step onto the same chain, not a reset', () => {
		request.setCurrentRender(render('gen-1'));
		request.applyEditResult(render('edit-1'));

		request.setCurrentRender(render('gen-2'));

		expect(request.currentRender?.id).toBe('gen-2');
		expect(request.canUndoEdit).toBe(true);

		request.undoLastEdit();
		expect(request.currentRender?.id).toBe('edit-1');
	});

	it('undoing a second generation restores the render from before it', () => {
		request.setCurrentRender(render('gen-1'));
		request.setCurrentRender(render('gen-2'));

		request.undoLastEdit();

		expect(request.currentRender?.id).toBe('gen-1');
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

describe('redo (multi-step history navigation, FR-К6)', () => {
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

	it('a fresh generation after undo discards the abandoned redo branch, not the whole history', () => {
		request.setCurrentRender(render('gen-1'));
		request.applyEditResult(render('edit-1'));
		request.undoLastEdit();

		request.setCurrentRender(render('gen-2'));

		expect(request.currentRender?.id).toBe('gen-2');
		expect(request.canRedoEdit).toBe(false);
		expect(request.canUndoEdit).toBe(true);

		request.undoLastEdit();
		expect(request.currentRender?.id).toBe('gen-1');
	});

	it('navigates back and forth across a long mixed chain of generations and edits', () => {
		request.setCurrentRender(render('gen-1'));
		request.setCurrentRender(render('gen-2'));
		request.applyEditResult(render('edit-1'));
		request.applyEditResult(render('edit-2'));

		expect(request.currentRender?.id).toBe('edit-2');

		request.undoLastEdit();
		request.undoLastEdit();
		request.undoLastEdit();
		expect(request.currentRender?.id).toBe('gen-1');
		expect(request.canUndoEdit).toBe(false);

		request.redoEdit();
		request.redoEdit();
		request.redoEdit();
		expect(request.currentRender?.id).toBe('edit-2');
		expect(request.canRedoEdit).toBe(false);
	});

	it('an edit anchored at an older step truncates the branch after it, matching the async lineage-priority flow', () => {
		request.setCurrentRender(render('gen-1'));
		const sourceRender = render('gen-1');
		request.setCurrentRender(render('gen-2'));

		request.applyEditResult(render('edit-1'), sourceRender);

		expect(request.currentRender?.id).toBe('edit-1');
		request.undoLastEdit();
		expect(request.currentRender?.id).toBe('gen-1');
		expect(request.canUndoEdit).toBe(false);
	});

	it('reset() clears the redo target too', () => {
		request.setCurrentRender(render('gen-1'));
		request.applyEditResult(render('edit-1'));
		request.undoLastEdit();

		request.reset();

		expect(request.canRedoEdit).toBe(false);
	});
});

describe('the originally uploaded photo as the root history step (FR-К6)', () => {
	function render(id: string, cost = 5, balance = 95): RenderResult {
		return { id, outputUrls: [`https://example.test/${id}.jpg`], cost, balance, ts: 0 };
	}

	it('undoing the first generation restores the originally uploaded photo', () => {
		request.setImage({ url: 'https://example.test/uploaded.jpg' });
		request.setCurrentRender(render('gen-1', 5, 95));

		expect(request.canUndoEdit).toBe(true);
		request.undoLastEdit();

		expect(request.currentRender?.outputUrls[0]).toBe('https://example.test/uploaded.jpg');
		expect(request.currentRender?.cost).toBe(0);
		expect(request.currentRender?.balance).toBe(100);
		expect(request.canUndoEdit).toBe(false);

		request.redoEdit();
		expect(request.currentRender?.id).toBe('gen-1');
	});

	it('there is no root step, and undo stays disabled, without an uploaded photo', () => {
		request.setCurrentRender(render('gen-1'));

		expect(request.canUndoEdit).toBe(false);
	});

	it('an edit applied directly to an uploaded photo (no prior render) still gets a root step', () => {
		request.setImage({ url: 'https://example.test/uploaded.jpg' });
		request.applyEditResult(render('edit-1', 3, 97));

		expect(request.canUndoEdit).toBe(true);
		request.undoLastEdit();
		expect(request.currentRender?.outputUrls[0]).toBe('https://example.test/uploaded.jpg');
		expect(request.currentRender?.balance).toBe(100);
	});

	it('a late-arriving edit whose anchor fell out of history lands on the current tip instead of discarding it', () => {
		request.setImage({ url: 'https://example.test/uploaded.jpg' });
		request.setCurrentRender(render('gen-1', 5, 90));
		request.applyEditResult(render('edit-1', 3, 87));
		// Snapshot of the render an async job was requested against, taken
		// before the branch it lives on gets abandoned below.
		const staleAnchor = render('edit-1', 3, 87);

		request.undoLastEdit();
		request.setCurrentRender(render('gen-2', 5, 82));

		request.applyEditResult(render('late-edit', 2, 80), staleAnchor);

		expect(request.currentRender?.id).toBe('late-edit');
		request.undoLastEdit();
		expect(request.currentRender?.id).toBe('gen-2');
		request.undoLastEdit();
		expect(request.currentRender?.id).toBe('gen-1');
		request.undoLastEdit();
		expect(request.currentRender?.outputUrls[0]).toBe('https://example.test/uploaded.jpg');
		expect(request.canUndoEdit).toBe(false);
	});
});
