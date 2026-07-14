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

import { OUTPUT_FORMATS, type OutputFormat } from '$lib/api/contract';
import {
	SCENE_TYPES,
	STYLE_SOURCE_MODES,
	type RequestState,
	type SceneType,
	type StyleSourceMode
} from '$lib/state/request.svelte';
import { STYLE_PRESETS } from '$lib/style-presets';

export type Mode = 'render' | 'edit' | 'styleTransfer';
export type ViewId = 'chat' | 'keyValue' | 'graph';
export type ToolId = 'freeform' | 'add-object' | 'remove-object' | 'atmosphere';
export type ReferenceTab = 'photorealistic' | 'conceptual' | 'custom';

// The sub-tab shown within the current mode — at most one of these applies,
// depending on `mode`. Unlike scene type (a real RequestState field, so it
// belongs in the path, see buildShareUrl), none of these have a backing store
// field: they're pure UI navigation state that only ever lives in the query
// string.
export interface SubTab {
	view?: ViewId;
	tool?: ToolId;
	reference?: ReferenceTab;
}

const MODE_PATHS: Record<Mode, string> = {
	render: '/render',
	edit: '/edit',
	styleTransfer: '/style-transfer'
};

const VIEW_SLUGS: Record<ViewId, string> = {
	chat: 'chat',
	keyValue: 'key-value',
	graph: 'graph'
};

const SLUG_VIEWS: Record<string, ViewId> = {
	chat: 'chat',
	'key-value': 'keyValue',
	graph: 'graph'
};

const TOOL_IDS: readonly ToolId[] = ['freeform', 'add-object', 'remove-object', 'atmosphere'];
const REFERENCE_TABS: readonly ReferenceTab[] = ['photorealistic', 'conceptual', 'custom'];

export function viewToSlug(view: ViewId): string {
	return VIEW_SLUGS[view];
}

export function slugToView(param: string | undefined): ViewId {
	return (param !== undefined ? SLUG_VIEWS[param] : undefined) ?? 'chat';
}

// Tool/reference ids double as their own query values (already kebab-case).
export function slugToTool(param: string | undefined): ToolId {
	return (TOOL_IDS as readonly string[]).includes(param ?? '') ? (param as ToolId) : 'freeform';
}

export function slugToReference(param: string | undefined): ReferenceTab {
	return (REFERENCE_TABS as readonly string[]).includes(param ?? '')
		? (param as ReferenceTab)
		: 'photorealistic';
}

function slugToScene(param: string | undefined): SceneType {
	return (SCENE_TYPES as readonly string[]).includes(param ?? '')
		? (param as SceneType)
		: 'interior';
}

// SvelteKit route ids for our leaf pages are '/render/[scene]', '/edit' and
// '/style-transfer/[scene]' — anything else (including the transient '/'
// before its redirect resolves) falls back to the default mode.
export function routeIdToMode(routeId: string | null): Mode {
	if (routeId?.startsWith('/edit')) return 'edit';
	if (routeId?.startsWith('/style-transfer')) return 'styleTransfer';
	return 'render';
}

// The sub-tab currently selected, read straight off the *current* query string
// (there's no backing store for it — see SubTab above). Used by the write-sync
// effect so rebuilding the URL for an unrelated request change doesn't drop
// whichever sub-tab is showing.
export function subTabFromSearch(mode: Mode, searchParams: URLSearchParams): SubTab {
	if (mode === 'render') return { view: slugToView(searchParams.get('view') ?? undefined) };
	if (mode === 'edit') return { tool: slugToTool(searchParams.get('tool') ?? undefined) };
	return { reference: slugToReference(searchParams.get('reference') ?? undefined) };
}

interface ParsedFragment {
	label?: string;
	text: string;
}

function isParsedFragment(value: unknown): value is ParsedFragment {
	if (typeof value !== 'object' || value === null) return false;
	const candidate = value as Record<string, unknown>;
	if (typeof candidate.text !== 'string') return false;
	return candidate.label === undefined || typeof candidate.label === 'string';
}

function parseFragments(raw: string): ParsedFragment[] {
	try {
		const parsed: unknown = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		return parsed.filter(isParsedFragment);
	} catch {
		// Malformed/tampered URL — untrusted boundary input, not a bug to log.
		return [];
	}
}

// Builds the canonical, shareable URL for the given mode/request: the path
// encodes the mode and — for render/style transfer — the scene type (a real
// RequestState field, always one of two values, so it's part of the address
// rather than a query param). The query string encodes the current sub-tab
// (always present — it's always showing *something*) plus every other setting
// that's visibly selected on screen right now — format, style transfer
// controls — so the URL never silently hides the current default. Only
// free-form/optional content (uploaded photo, style preset, negative prompt,
// prompt/fragments) is left out of the query string when empty, since there's
// nothing to show for those.
export function buildShareUrl(mode: Mode, request: RequestState, subTab: SubTab = {}): string {
	const path =
		mode === 'render'
			? `${MODE_PATHS.render}/${request.sceneType}`
			: mode === 'edit'
				? MODE_PATHS.edit
				: `${MODE_PATHS.styleTransfer}/${request.sceneType}`;

	const params = new URLSearchParams();

	// The uploaded room photo is the one piece of state every screen shares —
	// render and edit always work off it, and style transfer's "room photo"
	// source option is the same image.
	if (request.image?.url) params.set('image', request.image.url);

	if (mode === 'render') {
		params.set('view', viewToSlug(subTab.view ?? 'chat'));
		params.set('format', request.outputFormat);

		if (request.promptOverride !== null) {
			params.set('prompt', request.promptOverride);
		} else if (request.promptFragments.length > 0) {
			const fragments: ParsedFragment[] = [...request.promptFragments]
				.sort((a, b) => a.order - b.order)
				.map((fragment) => ({
					...(fragment.label !== undefined ? { label: fragment.label } : {}),
					text: fragment.text
				}));
			params.set('fragments', JSON.stringify(fragments));
		}
	}

	if (mode === 'edit') {
		params.set('tool', subTab.tool ?? 'freeform');
	}

	if (mode === 'styleTransfer') {
		params.set('reference', subTab.reference ?? 'photorealistic');
		params.set('format', request.outputFormat);
		params.set('source', request.styleSourceMode);
		params.set('strength', String(request.styleTransferStrength));

		const styleImageUrl = request.styleReferenceImage?.url;
		if (styleImageUrl) {
			const preset = STYLE_PRESETS.find((candidate) => candidate.src === styleImageUrl);
			if (preset) params.set('preset', preset.id);
			else params.set('styleImage', styleImageUrl);
		}
		if (request.styleNegativePrompt.trim() !== '') {
			params.set('negative', request.styleNegativePrompt);
		}
	}

	const query = params.toString();
	return query ? `${path}?${query}` : path;
}

// Reverse of buildShareUrl: applies every field explicitly (falling back to
// defaults when a param/path segment is absent) so a given URL always maps to
// the same request state. `sceneParam` is `page.params.scene` (present only
// for render/style transfer routes); the sub-tab (view/tool/reference) has no
// backing store field, so it isn't applied here — components read it straight
// off `page.params`/`page.url.searchParams` themselves.
export function applyShareParams(
	mode: Mode,
	sceneParam: string | undefined,
	searchParams: URLSearchParams,
	request: RequestState
): void {
	request.setSceneType(mode === 'edit' ? 'interior' : slugToScene(sceneParam));

	const format = searchParams.get('format');
	request.setOutputFormat(
		(OUTPUT_FORMATS as readonly string[]).includes(format ?? '') ? (format as OutputFormat) : 'webp'
	);

	const image = searchParams.get('image');
	try {
		request.setImage(image ? { url: image } : undefined);
	} catch {
		request.setImage(undefined);
	}

	const presetId = searchParams.get('preset');
	const styleImage = searchParams.get('styleImage');
	try {
		if (presetId) {
			const preset = STYLE_PRESETS.find((candidate) => candidate.id === presetId);
			request.setStyleReferenceImage(preset ? { url: preset.src, mime: preset.mime } : undefined);
		} else {
			request.setStyleReferenceImage(styleImage ? { url: styleImage } : undefined);
		}
	} catch {
		request.setStyleReferenceImage(undefined);
	}

	const strengthParam = searchParams.get('strength');
	const strength = strengthParam !== null ? Number(strengthParam) : NaN;
	request.setStyleTransferStrength(
		Number.isFinite(strength) && strength >= 0 && strength <= 1 ? strength : 0.7
	);

	request.setStyleNegativePrompt(searchParams.get('negative') ?? '');

	const source = searchParams.get('source');
	request.setStyleSourceMode(
		(STYLE_SOURCE_MODES as readonly string[]).includes(source ?? '')
			? (source as StyleSourceMode)
			: 'current-result'
	);

	const prompt = searchParams.get('prompt');
	if (prompt !== null) {
		request.setPromptOverride(prompt);
		return;
	}

	request.clearPromptOverride();
	const fragmentsRaw = searchParams.get('fragments');
	request.setFragments(fragmentsRaw ? parseFragments(fragmentsRaw) : []);
}
