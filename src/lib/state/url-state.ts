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

import { z } from 'zod';
import { OUTPUT_FORMATS, type GenerationKind, type OutputFormat } from '$lib/api/contract';
import { LIGHT_SETTINGS_PRESETS } from '$lib/light-settings-presets';
import {
	SCENE_TYPES,
	objectReplacementJobIdSchema,
	type EditOperationType,
	type RenderResult,
	type RequestFormSnapshot,
	type RequestState,
	type SceneType
} from '$lib/state/request.svelte';
import { SCRATCH_TAB_ID, workspaceTabs } from '$lib/state/workspace-tabs.svelte';
import { STYLE_PRESETS } from '$lib/style-presets';

export type Mode = 'render' | 'edit' | 'styleTransfer';
export type ViewId = 'chat' | 'keyValue' | 'graph';
export type ToolId =
	| 'freeform'
	| 'add-object'
	| 'remove-object'
	| 'light-settings'
	| 'object-replacement'
	| 'texture-replacement';
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
	job?: string;
}

export interface WorkspaceDestination {
	mode: Mode;
	subTab: SubTab;
}

const MODE_PATHS: Record<Mode, string> = {
	render: '/create',
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

const TOOL_IDS: readonly ToolId[] = [
	'freeform',
	'add-object',
	'remove-object',
	'light-settings',
	'object-replacement',
	'texture-replacement'
];
const REFERENCE_TABS: readonly ReferenceTab[] = ['photorealistic', 'conceptual', 'custom'];

function viewToSlug(view: ViewId): string {
	return VIEW_SLUGS[view];
}

export function slugToView(param: string | undefined): ViewId {
	return (param !== undefined ? SLUG_VIEWS[param] : undefined) ?? 'chat';
}

// Tool/reference ids double as their own query values (already kebab-case).
export function slugToTool(param: string | undefined): ToolId {
	return (TOOL_IDS as readonly string[]).includes(param ?? '') ? (param as ToolId) : 'freeform';
}

export function isEditToolRoute(
	routeId: string | null,
	searchParams: URLSearchParams,
	tool: ToolId
): boolean {
	return (
		routeId?.startsWith('/edit') === true &&
		slugToTool(searchParams.get('tool') ?? undefined) === tool
	);
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

// SvelteKit route ids identify the workspace leaf pages; anything else falls
// back to the default mode.
export function routeIdToMode(routeId: string | null): Mode {
	if (routeId?.startsWith('/edit')) return 'edit';
	if (routeId?.startsWith('/style-transfer')) return 'styleTransfer';
	return 'render';
}

// Every edit-panel tool tags its renders with a unique editOp.type (see
// EDIT_OPERATION_TYPES) except 'upscale' — applied from RenderResult.svelte's
// toolbar, which is shared by every mode, so it has no tool tab of its own
// and is deliberately left out here.
const EDIT_OP_TOOL: Partial<Record<EditOperationType, ToolId>> = {
	freeform: 'freeform',
	'add-object': 'add-object',
	'remove-object': 'remove-object',
	'light-settings': 'light-settings',
	'replace-object': 'object-replacement',
	'change-surface-color': 'texture-replacement'
};

export interface RenderOrigin {
	mode: Mode;
	tool?: ToolId;
}

// Which mode/tool actually produced a render step — the counterpart to
// routeIdToMode, but derived from the render itself rather than the URL.
// Undo/redo (request.svelte.ts) walks a single history shared across every
// mode and tool, and each step's restored form fields (RequestFormSnapshot)
// only make sense under whichever mode/tool actually created that step — so
// Workspace.svelte uses this to keep the active mode/tool in lockstep with
// whichever step is on screen, rather than leaving the user looking at a
// tool tab whose fields have nothing to do with what they're seeing.
// Returns undefined for a step with no known origin (the synthetic
// uploaded-photo root, an upscale, or a generation loaded from project
// history before this field existed) — the caller leaves the current
// mode/tool alone rather than guessing.
export function renderOrigin(render: RenderResult | undefined): RenderOrigin | undefined {
	if (!render) return undefined;
	if (render.sourceMode === 'render') return { mode: 'render' };
	if (render.sourceMode === 'styleTransfer') return { mode: 'styleTransfer' };
	const tool = render.editOp ? EDIT_OP_TOOL[render.editOp.type] : undefined;
	return tool ? { mode: 'edit', tool } : undefined;
}

// Which reference tab a style-transfer snapshot's own reference image belongs
// under — a built-in preset lives under whichever category it was defined
// with (StyleTransferPanel.svelte's `stylePresetsFor` only lists presets from
// the active tab, so landing on the wrong one leaves the restored preset
// selected in the store but absent from the grid, showing nothing selected),
// an uploaded reference is always 'custom', and no reference at all falls
// back to the default 'photorealistic' tab.
function styleReferenceTab(image: RequestFormSnapshot['styleReferenceImage']): ReferenceTab {
	if (!image) return 'photorealistic';
	if (!('stylePresetId' in image)) return 'custom';
	return (
		STYLE_PRESETS.find((preset) => preset.id === image.stylePresetId)?.category ?? 'photorealistic'
	);
}

// `formSnapshot` (absent when there's no snapshot to restore — e.g. the
// Scenes drawer's plain "use this image") disambiguates two kinds that share
// one GenerationKind across several distinct UI destinations:
// - `edit`: freeform/add-object/remove-object all share it, told apart by
//   `formSnapshot.editOperationType` — without it, every 'edit' generation
//   would restore onto the freeform tab regardless of which tool produced it.
// - `style-transfer`: its reference image may be a preset from either the
//   photorealistic or conceptual tab, or a custom upload — see
//   styleReferenceTab() above.
export function destinationForGenerationKind(
	kind: GenerationKind,
	formSnapshot?: RequestFormSnapshot | null
): WorkspaceDestination {
	switch (kind) {
		case 'render':
			return { mode: 'render', subTab: { view: 'chat' } };
		case 'style-transfer':
			return {
				mode: 'styleTransfer',
				subTab: { reference: styleReferenceTab(formSnapshot?.styleReferenceImage) }
			};
		case 'object-replacement':
			return { mode: 'edit', subTab: { tool: 'object-replacement' } };
		case 'texture-replacement':
			return { mode: 'edit', subTab: { tool: 'texture-replacement' } };
		case 'light-settings':
			return { mode: 'edit', subTab: { tool: 'light-settings' } };
		case 'edit':
		case 'upscale': {
			const editOperationType = formSnapshot?.editOperationType;
			const tool = editOperationType ? EDIT_OP_TOOL[editOperationType] : undefined;
			return { mode: 'edit', subTab: { tool: tool ?? 'freeform' } };
		}
	}
}

// Whether the given route id belongs to the workspace at all (as
// opposed to a standalone page, e.g. '/usage', that sits outside it). Callers
// use this to decide whether the workspace shell — and its URL-sync effect,
// which otherwise treats any unrecognized route as the default render mode
// and rewrites the address bar to it — should be mounted for the current
// route.
export function isWorkspaceRoute(routeId: string | null): boolean {
	return (
		routeId?.startsWith('/create') === true ||
		routeId?.startsWith('/edit') === true ||
		routeId?.startsWith('/style-transfer') === true
	);
}

// The sub-tab currently selected, read straight off the *current* query string
// (there's no backing store for it — see SubTab above). Used by the write-sync
// effect so rebuilding the URL for an unrelated request change doesn't drop
// whichever sub-tab is showing.
export function subTabFromSearch(mode: Mode, searchParams: URLSearchParams): SubTab {
	if (mode === 'render') return { view: slugToView(searchParams.get('view') ?? undefined) };
	if (mode === 'edit') {
		const tool = slugToTool(searchParams.get('tool') ?? undefined);
		const job = searchParams.get('job');
		// Every edit-mode tool is job-backed now (freeform/add-object/remove-object
		// share the Flux Kontext job, the other three each have their own).
		return isJobId(job) ? { tool, job } : { tool };
	}
	if (mode === 'styleTransfer') {
		return { reference: slugToReference(searchParams.get('reference') ?? undefined) };
	}
	return {};
}

// A plain UUID check — shared by every async-job tool that carries its job id
// in the `job` query param.
export function isJobId(value: unknown): value is string {
	return objectReplacementJobIdSchema.safeParse(value).success;
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
// controls — so the URL never silently hides the current default. Free-form
// content (style preset, negative prompt, mode prompts/fragments) is left out
// of the query string when empty, since there's nothing to show for those. The
// uploaded room photo and a custom (non-preset) style reference are never
// included at all — see applyShareParams for why.
//
// request.projectId/sessionId are deliberately never part of *this* URL
// (Module 11): they're the caller's own private session, not something this
// "share what's on screen" link should hand to whoever opens it — a
// recipient who isn't the same account can't own that session, so restoring
// it would just fail their next generation call. Real project sharing goes
// through the dedicated, revocable /share/[token] link instead (see
// projects.ts's issueShareToken/getProjectDetailByShareToken). Continuing a
// session from the project page sets projectId/sessionId on `request`
// in-memory just before navigating — that survives the `goto()` this
// triggers, since only 'enter'/'popstate'/'link' navigations re-parse the
// URL (see Workspace.svelte's afterNavigate).
//
// Separately, Workspace.svelte's own address-bar sync layers `project`/
// `session` query params on top of this function's output via
// withProjectSession() below — an authenticated deep link back into the
// *browser's own address bar* (bookmark it, reload, hand it to your other
// device), gated by the same ownership check /projects/[id] already
// enforces. That's a different guarantee than this "copy what's on screen"
// link makes, so it stays a separate mechanism rather than changing what
// buildShareUrl itself produces.
export function buildShareUrl(mode: Mode, request: RequestState, subTab: SubTab = {}): string {
	const path =
		mode === 'render'
			? `${MODE_PATHS.render}/${request.sceneType}`
			: mode === 'edit'
				? MODE_PATHS.edit
				: `${MODE_PATHS.styleTransfer}/${request.sceneType}`;

	const params = new URLSearchParams();

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
		const tool = subTab.tool ?? 'freeform';
		params.set('tool', tool);
		if (tool === 'object-replacement') {
			if (request.objectReplacementObject.trim() !== '') {
				params.set('object', request.objectReplacementObject);
			}
			const job = subTab.job ?? request.activeObjectReplacementJobId;
			if (isJobId(job)) params.set('job', job);
		} else if (tool === 'texture-replacement') {
			if (request.textureReplacementMasked) {
				params.set('masked', '1');
			} else if (request.textureReplacementSurface.trim() !== '') {
				params.set('surface', request.textureReplacementSurface);
			}
			const job = subTab.job ?? request.activeTextureReplacementJobId;
			if (isJobId(job)) params.set('job', job);
		} else if (tool === 'light-settings') {
			if (request.lightSettingsPresetIds.length > 0) {
				params.set('presets', request.lightSettingsPresetIds.join(','));
			}
			if (request.lightSettingsInstruction.trim() !== '') {
				params.set('instruction', request.lightSettingsInstruction);
			}
			const job = subTab.job ?? request.activeLightSettingsJobId;
			if (isJobId(job)) params.set('job', job);
		} else if (tool === 'freeform' || tool === 'add-object' || tool === 'remove-object') {
			if (tool === 'freeform' && request.editPrompt.trim() !== '') {
				params.set('prompt', request.editPrompt);
			}
			const job = subTab.job ?? request.activeFluxKontextEditJobId;
			if (isJobId(job)) {
				params.set('job', job);
				// The job's own type, not the currently-selected tab — they can
				// diverge if the user switches tabs while it's still polling (the
				// job is shared across all three tools), and restoring from the
				// wrong one would mislabel the eventual edit history entry.
				const jobType = request.activeFluxKontextEditJob?.type;
				if (jobType) params.set('jobType', jobType);
			}
		}
	}

	if (mode === 'styleTransfer') {
		params.set('reference', subTab.reference ?? 'photorealistic');
		params.set('format', request.outputFormat);
		params.set('strength', String(request.styleTransferStrength));

		// Only a known, safe preset id is shareable — it's just a lookup into our
		// own static preset list. A custom-uploaded reference image is never
		// included (its raw URL isn't in the query string at all).
		const presetId =
			request.styleReferenceImage && 'stylePresetId' in request.styleReferenceImage
				? request.styleReferenceImage.stylePresetId
				: undefined;
		const preset = STYLE_PRESETS.find((candidate) => candidate.id === presetId);
		if (preset) params.set('preset', preset.id);

		if (request.styleNegativePrompt.trim() !== '') {
			params.set('negative', request.styleNegativePrompt);
		}
		if (request.styleTransferPrompt.trim() !== '') {
			params.set('prompt', request.styleTransferPrompt);
		}
	}

	const query = params.toString();
	return query ? `${path}?${query}` : path;
}

// buildShareUrl + withProjectSession in one call, reading the project/
// session/generation anchor straight off workspaceTabs/request — for every
// in-workspace navigation that switches sub-tab/tool/reference within a mode
// that's already open (edit tool tabs, style-transfer reference tabs, an
// async job's own URL refresh, …). Using plain buildShareUrl for one of these
// and navigating to its bare result first — relying on the debounced
// URL-sync effect in Workspace.svelte to patch project/session/generation
// back in a moment later — is exactly the bug this exists to prevent: the
// address bar would go through a real, visible instant with none of them.
// Not appropriate for a navigation that's meant to leave the current project
// behind on purpose (e.g. picking a Resources photo opens a fresh scratch
// tab) or the very first navigation into a just-opened project/session
// (that one's project/session aren't in `workspaceTabs` yet at call time).
export function buildWorkspaceUrl(mode: Mode, request: RequestState, subTab: SubTab = {}): string {
	const activeProjectId =
		workspaceTabs.activeTabId !== SCRATCH_TAB_ID ? workspaceTabs.activeTabId : undefined;
	const activeSessionId = workspaceTabs.activeTab.activeSessionTabId ?? undefined;
	return withProjectSession(
		buildShareUrl(mode, request, subTab),
		activeProjectId,
		activeSessionId,
		request.viewingGenerationId
	);
}

// Appends the authenticated deep-link pair described above onto an already-
// built buildShareUrl() result — omitted entirely on the scratch tab (no
// project/session to point at). Kept as a separate append step, rather than
// a buildShareUrl parameter, so it can never accidentally leak into the
// public "copy what's on screen" link this same builder also produces.
export function withProjectSession(
	url: string,
	projectId: string | undefined,
	sessionId: string | undefined,
	generationId?: string
): string {
	if (!projectId || !sessionId) return url;
	const [path, query = ''] = url.split('?');
	const params = new URLSearchParams(query);
	params.set('project', projectId);
	params.set('session', sessionId);
	if (generationId) params.set('generation', generationId);
	else params.delete('generation');
	return `${path}?${params.toString()}`;
}

// Reverse of withProjectSession — read off the *current* query string (see
// subTabFromSearch for why there's no backing store field to apply this to
// directly). Ownership of the referenced project is enforced server-side,
// the same way a direct visit to /projects/[id] already is; an id that
// doesn't parse as a UUID is treated as absent rather than trusted verbatim.
const projectSessionIdSchema = z.uuid();

export function projectSessionFromSearch(
	searchParams: URLSearchParams
): { projectId: string; sessionId: string } | null {
	const projectId = searchParams.get('project');
	const sessionId = searchParams.get('session');
	if (
		!projectId ||
		!sessionId ||
		!projectSessionIdSchema.safeParse(projectId).success ||
		!projectSessionIdSchema.safeParse(sessionId).success
	) {
		return null;
	}
	return { projectId, sessionId };
}

// The generation-preview anchor (see workspace-tabs.svelte.ts's
// initializeGenerationPreview) — only meaningful alongside a valid
// project/session pair, but read independently since a caller may want to
// resolve it only once it already has both. Same "not a UUID → treat as
// absent" rule as projectSessionFromSearch.
export function generationIdFromSearch(searchParams: URLSearchParams): string | null {
	const generationId = searchParams.get('generation');
	return generationId && projectSessionIdSchema.safeParse(generationId).success
		? generationId
		: null;
}

// Reverse of buildShareUrl: applies every field explicitly (falling back to
// defaults when a param/path segment is absent) so a given URL always maps to
// the same request state. `sceneParam` is `page.params.scene` (present only
// for render/style transfer routes); the sub-tab (view/tool/reference) has no
// backing store field, so it isn't applied here — components read it straight
// off `page.params`/`page.url.searchParams` themselves.
//
// The room photo and a custom (non-preset) style reference are deliberately
// left untouched here — they're never read from `searchParams` at all. Every
// other way to populate `request.image`/`styleReferenceImage` (drag-drop, file
// picker, "import from URL") goes through the server-side `/api/uploads`
// pipeline, which validates (https, content-type, size) and re-hosts the file
// before the client ever sees a URL. Trusting a raw `image`/`styleImage` query
// param would skip all of that: a crafted link could silently swap in an
// unvalidated URL ahead of a paid render/style-transfer call. A preset id is
// safe to restore since it's just a lookup into our own static preset list,
// never an arbitrary URL. request.projectId/sessionId are left untouched for
// the same reason they're never written by buildShareUrl — see there.
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

	if (mode === 'render') {
		const prompt = searchParams.get('prompt');
		if (prompt !== null) {
			request.setPromptOverride(prompt);
			return;
		}

		request.clearPromptOverride();
		const fragmentsRaw = searchParams.get('fragments');
		request.setFragments(fragmentsRaw ? parseFragments(fragmentsRaw) : []);
	} else if (mode === 'edit') {
		const tool = slugToTool(searchParams.get('tool') ?? undefined);
		if (tool === 'object-replacement') {
			request.setObjectReplacementObject((searchParams.get('object') ?? '').slice(0, 200));
			const job = searchParams.get('job');
			request.setActiveObjectReplacementJobId(isJobId(job) ? job : undefined);
		} else if (tool === 'texture-replacement') {
			const masked = searchParams.get('masked') === '1';
			request.setTextureReplacementMasked(masked);
			request.setTextureReplacementSurface(
				masked ? '' : (searchParams.get('surface') ?? '').slice(0, 200)
			);
			const job = searchParams.get('job');
			request.setActiveTextureReplacementJobId(isJobId(job) ? job : undefined);
		} else if (tool === 'light-settings') {
			const presetsRaw = searchParams.get('presets');
			const knownIds = new Set(LIGHT_SETTINGS_PRESETS.map((preset) => preset.id));
			request.setLightSettingsPresetIds(
				presetsRaw ? presetsRaw.split(',').filter((id) => knownIds.has(id)) : []
			);
			request.setLightSettingsInstruction((searchParams.get('instruction') ?? '').slice(0, 500));
			const job = searchParams.get('job');
			request.setActiveLightSettingsJobId(isJobId(job) ? job : undefined);
		} else if (tool === 'freeform' || tool === 'add-object' || tool === 'remove-object') {
			if (tool === 'freeform') {
				request.setEditPrompt(searchParams.get('prompt') ?? '');
			}
			const job = searchParams.get('job');
			// The job's own type (see buildShareUrl), not the currently-selected
			// tab — a reload can land on a different tab than the one that
			// actually submitted the still-polling job.
			const jobTypeParam = searchParams.get('jobType');
			const jobType: EditOperationType =
				jobTypeParam === 'freeform' ||
				jobTypeParam === 'add-object' ||
				jobTypeParam === 'remove-object'
					? jobTypeParam
					: 'freeform';
			request.setActiveFluxKontextEditJobId(isJobId(job) ? job : undefined, jobType);
		}
	} else if (mode === 'styleTransfer') {
		const presetId = searchParams.get('preset');
		if (presetId !== null) {
			const preset = STYLE_PRESETS.find((candidate) => candidate.id === presetId);
			request.setStyleReferenceImage(
				preset ? { stylePresetId: preset.id, url: preset.src, mime: preset.mime } : undefined
			);
		}

		const strengthParam = searchParams.get('strength');
		const strength = strengthParam !== null ? Number(strengthParam) : NaN;
		request.setStyleTransferStrength(
			Number.isFinite(strength) && strength >= 0 && strength <= 1 ? strength : 0.7
		);
		request.setStyleNegativePrompt(searchParams.get('negative') ?? '');
		request.setStyleTransferPrompt(searchParams.get('prompt') ?? '');
	}
}
