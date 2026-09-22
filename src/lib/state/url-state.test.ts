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

import { describe, expect, it } from 'vitest';
import { RequestState, type RenderResult } from '$lib/state/request.svelte';
import {
	applyShareParams,
	buildShareUrl,
	destinationForGenerationKind,
	generationIdFromSearch,
	isEditToolRoute,
	isWorkspaceRoute,
	renderOrigin,
	slugToTool,
	subTabFromSearch,
	withProjectSession
} from '$lib/state/url-state';

const JOB_ID = '123e4567-e89b-42d3-a456-426614174000';

function render(overrides: Partial<RenderResult> = {}): RenderResult {
	return { id: 'r1', outputKey: 'a/b.webp', cost: 1, balance: 99, ts: 0, ...overrides };
}

describe('renderOrigin (keeps mode/tool in sync with undo/redo)', () => {
	it('has no known origin for a render with neither sourceMode nor editOp', () => {
		expect(renderOrigin(undefined)).toBeUndefined();
		expect(renderOrigin(render())).toBeUndefined();
	});

	it('maps sourceMode to render/styleTransfer directly, ignoring any editOp', () => {
		expect(renderOrigin(render({ sourceMode: 'render' }))).toEqual({ mode: 'render' });
		expect(renderOrigin(render({ sourceMode: 'styleTransfer' }))).toEqual({
			mode: 'styleTransfer'
		});
	});

	it('maps every edit-panel tool editOp.type to its own tab', () => {
		expect(renderOrigin(render({ editOp: { type: 'freeform', instruction: '' } }))).toEqual({
			mode: 'edit',
			tool: 'freeform'
		});
		expect(renderOrigin(render({ editOp: { type: 'add-object', instruction: '' } }))).toEqual({
			mode: 'edit',
			tool: 'add-object'
		});
		expect(renderOrigin(render({ editOp: { type: 'remove-object', instruction: '' } }))).toEqual({
			mode: 'edit',
			tool: 'remove-object'
		});
		expect(renderOrigin(render({ editOp: { type: 'light-settings', instruction: '' } }))).toEqual({
			mode: 'edit',
			tool: 'light-settings'
		});
		expect(renderOrigin(render({ editOp: { type: 'replace-object', instruction: '' } }))).toEqual({
			mode: 'edit',
			tool: 'object-replacement'
		});
		expect(
			renderOrigin(render({ editOp: { type: 'change-surface-color', instruction: '' } }))
		).toEqual({ mode: 'edit', tool: 'texture-replacement' });
	});

	it('has no known origin for an upscale — applied from a toolbar shared by every mode', () => {
		expect(renderOrigin(render({ editOp: { type: 'upscale', instruction: '' } }))).toBeUndefined();
	});
});

describe('generation history destinations', () => {
	it('restores the processing mode represented by each generation kind', () => {
		expect(destinationForGenerationKind('render')).toEqual({
			mode: 'render',
			subTab: { view: 'chat' }
		});
		expect(destinationForGenerationKind('edit')).toEqual({
			mode: 'edit',
			subTab: { tool: 'freeform' }
		});
		expect(destinationForGenerationKind('style-transfer')).toEqual({
			mode: 'styleTransfer',
			subTab: { reference: 'photorealistic' }
		});
		expect(destinationForGenerationKind('upscale')).toEqual({
			mode: 'edit',
			subTab: { tool: 'freeform' }
		});
		expect(destinationForGenerationKind('object-replacement')).toEqual({
			mode: 'edit',
			subTab: { tool: 'object-replacement' }
		});
		expect(destinationForGenerationKind('texture-replacement')).toEqual({
			mode: 'edit',
			subTab: { tool: 'texture-replacement' }
		});
	});

	it('picks the edit-panel tool an editOperationType names, for a kind shared by several tools', () => {
		expect(destinationForGenerationKind('edit', 'add-object')).toEqual({
			mode: 'edit',
			subTab: { tool: 'add-object' }
		});
		expect(destinationForGenerationKind('edit', 'remove-object')).toEqual({
			mode: 'edit',
			subTab: { tool: 'remove-object' }
		});
		// null/undefined (no snapshot, or one recorded before this field
		// existed) falls back to the same 'freeform' default as before.
		expect(destinationForGenerationKind('edit', null)).toEqual({
			mode: 'edit',
			subTab: { tool: 'freeform' }
		});
		expect(destinationForGenerationKind('edit', undefined)).toEqual({
			mode: 'edit',
			subTab: { tool: 'freeform' }
		});
	});
});

describe('edit tool route matching', () => {
	it('requires both an edit route and the requested normalized tool', () => {
		const params = new URLSearchParams({ tool: 'object-replacement' });

		expect(isEditToolRoute('/edit', params, 'object-replacement')).toBe(true);
		expect(isEditToolRoute('/create/interior', params, 'object-replacement')).toBe(false);
		expect(isEditToolRoute('/edit', params, 'texture-replacement')).toBe(false);
	});
});

describe('object replacement edit URL state', () => {
	it('serializes replacement fields under the edit tool without edit prompt leakage', () => {
		const state = new RequestState();
		state.setEditPrompt('brighten the room');
		state.setObjectReplacementSourceMode('room-photo');
		state.setObjectReplacementObject('gray sofa');
		state.setActiveObjectReplacementJobId(JOB_ID);

		expect(buildShareUrl('edit', state, { tool: 'object-replacement' })).toBe(
			`/edit?tool=object-replacement&source=room-photo&object=gray+sofa&job=${JOB_ID}`
		);
	});

	it('hydrates replacement fields and ignores image URLs', () => {
		const state = new RequestState();
		const params = new URLSearchParams({
			tool: 'object-replacement',
			source: 'room-photo',
			object: 'gray sofa',
			job: JOB_ID,
			image: 'https://evil.example.com/scene.jpg',
			referenceImage: 'https://evil.example.com/chair.jpg'
		});

		applyShareParams('edit', undefined, params, state);

		expect(state.objectReplacementSourceMode).toBe('room-photo');
		expect(state.objectReplacementObject).toBe('gray sofa');
		expect(state.activeObjectReplacementJobId).toBe(JOB_ID);
		expect(state.image).toBeUndefined();
		expect(state.objectReferenceImage).toBeUndefined();
	});

	it('keeps only validated job ids on the replacement sub-tab', () => {
		expect(
			subTabFromSearch('edit', new URLSearchParams({ tool: 'object-replacement', job: JOB_ID }))
		).toEqual({ tool: 'object-replacement', job: JOB_ID });
		expect(
			subTabFromSearch('edit', new URLSearchParams({ tool: 'object-replacement', job: 'invalid' }))
		).toEqual({ tool: 'object-replacement' });
	});

	it('recognizes the nested tool and removes the standalone workspace route', () => {
		expect(slugToTool('object-replacement')).toBe('object-replacement');
		expect(isWorkspaceRoute('/object-replacement')).toBe(false);
	});
});

describe('texture replacement edit URL state', () => {
	it('serializes replacement fields under the edit tool without edit prompt leakage', () => {
		const state = new RequestState();
		state.setEditPrompt('brighten the room');
		state.setTextureReplacementSourceMode('room-photo');
		state.setTextureReplacementSurface('sofa upholstery');
		state.setActiveTextureReplacementJobId(JOB_ID);

		expect(buildShareUrl('edit', state, { tool: 'texture-replacement' })).toBe(
			`/edit?tool=texture-replacement&source=room-photo&surface=sofa+upholstery&job=${JOB_ID}`
		);
	});

	it('hydrates replacement fields and ignores image URLs', () => {
		const state = new RequestState();
		const params = new URLSearchParams({
			tool: 'texture-replacement',
			source: 'room-photo',
			surface: 'sofa upholstery',
			job: JOB_ID,
			image: 'https://evil.example.com/scene.jpg',
			referenceImage: 'https://evil.example.com/fabric.jpg'
		});

		applyShareParams('edit', undefined, params, state);

		expect(state.textureReplacementSourceMode).toBe('room-photo');
		expect(state.textureReplacementSurface).toBe('sofa upholstery');
		expect(state.activeTextureReplacementJobId).toBe(JOB_ID);
		expect(state.image).toBeUndefined();
		expect(state.textureReferenceImage).toBeUndefined();
	});

	it('round-trips masked mode without image URLs or the hidden surface', () => {
		const state = new RequestState();
		state.setTextureReplacementSourceMode('room-photo');
		state.setTextureReplacementSurface('sofa upholstery');
		state.setTextureReplacementMasked(true);
		state.setImage({ mediaKey: '1' });
		state.setTextureReferenceImage({ mediaKey: '2' });
		state.setTextureMaskImage({ mediaKey: '3' });

		const url = buildShareUrl('edit', state, { tool: 'texture-replacement' });
		expect(url).toBe('/edit?tool=texture-replacement&source=room-photo&masked=1');

		const restored = new RequestState();
		applyShareParams(
			'edit',
			undefined,
			new URL(url, 'https://example.test').searchParams,
			restored
		);
		expect(restored.textureReplacementMasked).toBe(true);
		expect(restored.textureReplacementSurface).toBe('');
		expect(restored.image).toBeUndefined();
		expect(restored.textureReferenceImage).toBeUndefined();
		expect(restored.textureMaskImage).toBeUndefined();
	});

	it('defaults masked mode to off unless masked is exactly 1', () => {
		const state = new RequestState();
		state.setTextureReplacementMasked(true);

		applyShareParams(
			'edit',
			undefined,
			new URLSearchParams({ tool: 'texture-replacement', masked: 'true' }),
			state
		);

		expect(state.textureReplacementMasked).toBe(false);
	});

	it('keeps only validated job ids on the replacement sub-tab', () => {
		expect(
			subTabFromSearch('edit', new URLSearchParams({ tool: 'texture-replacement', job: JOB_ID }))
		).toEqual({ tool: 'texture-replacement', job: JOB_ID });
		expect(
			subTabFromSearch('edit', new URLSearchParams({ tool: 'texture-replacement', job: 'invalid' }))
		).toEqual({ tool: 'texture-replacement' });
	});

	it('recognizes the nested tool and removes the standalone workspace route', () => {
		expect(slugToTool('texture-replacement')).toBe('texture-replacement');
		expect(isWorkspaceRoute('/texture-replacement')).toBe(false);
	});
});

describe('flux kontext edit URL state (freeform/add-object/remove-object)', () => {
	it('serializes the job under whichever tab is active, tagged with the job’s own type', () => {
		const state = new RequestState();
		state.setActiveFluxKontextEditJob(JOB_ID, undefined, 'add a mirror', 'add-object');

		// The user can switch tabs while the shared job is still polling — the
		// URL must keep tagging it with the type that actually submitted it,
		// not whichever tab happens to be showing right now.
		expect(buildShareUrl('edit', state, { tool: 'freeform' })).toBe(
			`/edit?tool=freeform&job=${JOB_ID}&jobType=add-object`
		);
	});

	it('restores the job’s type from jobType, not from the current tab', () => {
		const state = new RequestState();
		const params = new URLSearchParams({ tool: 'freeform', job: JOB_ID, jobType: 'remove-object' });

		applyShareParams('edit', undefined, params, state);

		expect(state.activeFluxKontextEditJobId).toBe(JOB_ID);
		expect(state.activeFluxKontextEditJob?.type).toBe('remove-object');
	});

	it('falls back to freeform when jobType is missing or not a recognized edit type', () => {
		const state = new RequestState();
		applyShareParams(
			'edit',
			undefined,
			new URLSearchParams({ tool: 'add-object', job: JOB_ID }),
			state
		);
		expect(state.activeFluxKontextEditJob?.type).toBe('freeform');

		const otherState = new RequestState();
		applyShareParams(
			'edit',
			undefined,
			new URLSearchParams({ tool: 'add-object', job: JOB_ID, jobType: 'object-replacement' }),
			otherState
		);
		expect(otherState.activeFluxKontextEditJob?.type).toBe('freeform');
	});

	it('keeps only validated job ids on the sub-tab, regardless of which of the three tools is active', () => {
		expect(
			subTabFromSearch('edit', new URLSearchParams({ tool: 'add-object', job: JOB_ID }))
		).toEqual({ tool: 'add-object', job: JOB_ID });
		expect(
			subTabFromSearch('edit', new URLSearchParams({ tool: 'remove-object', job: 'invalid' }))
		).toEqual({ tool: 'remove-object' });
	});
});

const PROJECT_ID = '223e4567-e89b-42d3-a456-426614174001';
const SESSION_ID = '323e4567-e89b-42d3-a456-426614174002';

// Module 11: project/session are a caller's own private session, never part
// of the "shareable workspace URL" — see url-state.ts's buildShareUrl comment
// for why (a recipient who isn't the same account can't own that session).
describe('project/session are excluded from the shareable workspace URL', () => {
	it('never includes project/session params, even when a session is attached', () => {
		const state = new RequestState();
		state.setProjectSession(PROJECT_ID, SESSION_ID);

		const url = buildShareUrl('render', state, { view: 'chat' });
		expect(url).toBe('/create/interior?view=chat&format=webp');
		expect(url).not.toContain('project=');
		expect(url).not.toContain('session=');
	});

	it('leaves an existing projectId/sessionId on request untouched, regardless of URL contents', () => {
		const state = new RequestState();
		state.setProjectSession(PROJECT_ID, SESSION_ID);

		applyShareParams(
			'render',
			'interior',
			new URLSearchParams({
				view: 'chat',
				format: 'webp',
				project: '00000000-0000-4000-8000-000000000099',
				session: '00000000-0000-4000-8000-000000000098'
			}),
			state
		);

		expect(state.projectId).toBe(PROJECT_ID);
		expect(state.sessionId).toBe(SESSION_ID);
	});
});

const GENERATION_ID = '423e4567-e89b-42d3-a456-426614174003';

describe('withProjectSession/generationIdFromSearch (the address-bar-only generation anchor)', () => {
	it('appends project/session/generation on top of a share URL', () => {
		const url = withProjectSession(
			'/create/interior?view=chat',
			PROJECT_ID,
			SESSION_ID,
			GENERATION_ID
		);
		const params = new URL(url, 'https://example.test').searchParams;
		expect(params.get('project')).toBe(PROJECT_ID);
		expect(params.get('session')).toBe(SESSION_ID);
		expect(params.get('generation')).toBe(GENERATION_ID);
	});

	it('omits generation when not given, and drops one already on the URL', () => {
		const withGeneration = withProjectSession(
			'/create/interior?view=chat&generation=stale',
			PROJECT_ID,
			SESSION_ID
		);
		expect(withGeneration).not.toContain('generation=');
	});

	it('no-ops (generation included) when project or session is missing', () => {
		const url = '/create/interior?view=chat';
		expect(withProjectSession(url, undefined, SESSION_ID, GENERATION_ID)).toBe(url);
		expect(withProjectSession(url, PROJECT_ID, undefined, GENERATION_ID)).toBe(url);
	});

	it('reads a valid generation id back off the query string', () => {
		expect(generationIdFromSearch(new URLSearchParams({ generation: GENERATION_ID }))).toBe(
			GENERATION_ID
		);
	});

	it('treats a missing or non-UUID generation param as absent', () => {
		expect(generationIdFromSearch(new URLSearchParams())).toBeNull();
		expect(generationIdFromSearch(new URLSearchParams({ generation: 'not-a-uuid' }))).toBeNull();
	});
});
