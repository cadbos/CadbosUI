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
import { RequestState } from '$lib/state/request.svelte';
import {
	applyShareParams,
	buildShareUrl,
	isEditToolRoute,
	isWorkspaceRoute,
	slugToTool,
	subTabFromSearch
} from '$lib/state/url-state';

const JOB_ID = '123e4567-e89b-42d3-a456-426614174000';

describe('edit tool route matching', () => {
	it('requires both an edit route and the requested normalized tool', () => {
		const params = new URLSearchParams({ tool: 'object-replacement' });

		expect(isEditToolRoute('/edit', params, 'object-replacement')).toBe(true);
		expect(isEditToolRoute('/create/interior', params, 'object-replacement')).toBe(false);
		expect(isEditToolRoute('/edit', params, 'texture-replacement')).toBe(false);
	});

	it('preserves project scene and format while hydrating an edit deep-link', () => {
		const state = new RequestState();
		state.setSceneType('exterior');
		state.setOutputFormat('png');

		applyShareParams(
			'edit',
			undefined,
			new URLSearchParams({ tool: 'freeform', prompt: 'add evening light' }),
			state
		);

		expect(state.sceneType).toBe('exterior');
		expect(state.outputFormat).toBe('png');
		expect(state.editPrompt).toBe('add evening light');
	});

	it('carries a requested edit tool through the gated create URL', () => {
		const state = new RequestState();
		const params = new URLSearchParams({ tool: 'add-object' });
		const subTab = subTabFromSearch('render', params);

		expect(subTab).toEqual({ view: 'chat', tool: 'add-object' });
		expect(buildShareUrl('render', state, subTab)).toBe(
			'/create/interior?view=chat&tool=add-object&format=webp'
		);
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
		state.setImage({ url: 'https://example.test/scene.jpg' });
		state.setTextureReferenceImage({ url: 'https://example.test/fabric.jpg' });
		state.setTextureMaskImage({ url: 'https://example.test/mask.png' });

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
