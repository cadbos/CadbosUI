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
import {
	EDIT_OPERATION_TYPES,
	OUTPUT_FORMATS,
	SCENE_TYPES,
	type EditOperationType,
	type ImageInput,
	type LightSettingsRequest,
	type ManagedImageInput,
	type ObjectReplacementRequest,
	type OutputFormat,
	type PromptFragment,
	type RenderRequest,
	type RenderResponse,
	type RequestFormSnapshot,
	type SceneType,
	type StylePresetImageInput,
	type StyleTransferRequest,
	type TextureReplacementRequest,
	uploadResultSchema
} from '$lib/api/contract';
import { ADD_OBJECT_PRESETS } from '$lib/add-object-presets';
import { t, type TranslationKey } from '$lib/i18n/index.svelte';
import { LIGHT_SETTINGS_FIXTURES, LIGHT_SETTINGS_PRESETS } from '$lib/light-settings-presets';
import type { ModeHintTarget } from '$lib/mode-hints';
import { mediaAccess } from '$lib/state/media-access.svelte';

export {
	EDIT_OPERATION_TYPES,
	SCENE_TYPES,
	type EditOperationType,
	type ImageInput,
	type ManagedImageInput,
	type OutputFormat,
	type PromptFragment,
	type RequestFormSnapshot,
	type SceneType,
	type StylePresetImageInput
};

export interface EditOperation {
	type: EditOperationType;
	instruction: string;
}

// Which top-level mode produced a render that has no `editOp` of its own —
// a plain "Создание" generation or a style-transfer result. Every other
// mode/tool already has a unique `editOp.type` (see EDIT_OPERATION_TYPES),
// so this only needs to cover the two that don't. Consumed by url-state.ts's
// renderOrigin() to keep the active mode/tool in sync with whichever render
// undo/redo is currently showing (see Workspace.svelte).
export const RENDER_SOURCE_MODES = ['render', 'styleTransfer'] as const;
export type RenderSourceMode = (typeof RENDER_SOURCE_MODES)[number];

// RequestFormSnapshot itself lives in $lib/api/contract.ts (re-exported
// above) so the server can validate it without depending on Svelte-only
// modules — see that file for the field list and rationale. Captured at the
// moment a generation or edit is pushed onto render history (see
// RequestState#pushRender) so undo/redo (FR-К6) can restore the exact
// settings that produced a given step — not just its image — instead of
// leaving whatever the form happens to hold right now. Deliberately the same
// shape reset()/copyFrom()/fromJSON() already assign field-by-field, minus
// image/session identity, which undo/redo has no business touching.

export interface RenderResult {
	id: string;
	outputKey: string;
	cost: number;
	balance: number;
	parentId?: string;
	editOp?: EditOperation;
	sourceMode?: RenderSourceMode;
	formSnapshot?: RequestFormSnapshot;
	ts: number;
}

// formSnapshot is only ever set by the submit-time constructor
// (setActiveObjectReplacementJob), captured before the request goes out — not
// by the id-only restore path (setActiveObjectReplacementJobId, used after a
// page reload), which has no original submission left to snapshot and relies
// on #pushRender's own fallback capture once the job completes.
export interface ActiveObjectReplacementJob {
	id: string;
	instruction: string;
	sourceRender?: RenderResult;
	formSnapshot?: RequestFormSnapshot;
}

export interface ActiveTextureReplacementJob {
	id: string;
	instruction: string;
	sourceRender?: RenderResult;
	formSnapshot?: RequestFormSnapshot;
}

export interface ActiveLightSettingsJob {
	id: string;
	instruction: string;
	sourceRender?: RenderResult;
	formSnapshot?: RequestFormSnapshot;
}

// The one Flux Kontext ComfyUI job backing all three edit-panel tools
// (freeform/add-object/remove-object share one endpoint) — unlike the three
// single-purpose jobs above, it needs `type` to rebuild RenderResult.editOp
// once the job completes.
export interface ActiveFluxKontextEditJob {
	id: string;
	type: EditOperationType;
	instruction: string;
	sourceRender?: RenderResult;
	formSnapshot?: RequestFormSnapshot;
}

export interface TextureMaskUploadOperation {
	epoch: number;
	sourceKey: string;
}

export type RequestStatus = 'idle' | 'rendering' | 'error';

export type ValidationField =
	| 'prompt'
	| 'image'
	| 'referenceImage'
	| 'mask'
	| 'replacementObject'
	| 'replacementSurface'
	| 'instruction';

export interface ValidationResult {
	valid: boolean;
	missing: ValidationField[];
}

export interface RequestJSON {
	id: string;
	image?: ImageInput;
	styleReferenceImage?: ImageInput;
	objectReferenceImage?: ImageInput;
	textureReferenceImage?: ImageInput;
	textureMaskImage?: ImageInput;
	textureMaskSourceKey?: string;
	promptFragments: PromptFragment[];
	editPrompt: string;
	addObjectPresetId?: string | null;
	removeObjectText?: string;
	outputFormat: OutputFormat;
	sceneType: SceneType;
	styleTransferPrompt: string;
	styleTransferStrength: number;
	styleNegativePrompt: string;
	objectReplacementObject?: string;
	objectReplacementScale?: number;
	textureReplacementSurface?: string;
	textureReplacementMasked?: boolean;
	lightSettingsPresetIds?: string[];
	lightSettingsInstruction?: string;
	promptOverride: string | null;
	currentRender?: RenderResult;
	status: RequestStatus;
}

export interface NormalizedRequest {
	image?: ImageInput;
	styleReferenceImage?: ImageInput;
	objectReferenceImage?: ImageInput;
	textureReferenceImage?: ImageInput;
	textureMaskImage?: ImageInput;
	promptFragments: PromptFragment[];
	outputFormat: OutputFormat;
	sceneType: SceneType;
	styleTransferStrength: number;
	styleNegativePrompt: string;
	// The media identity request builders actually send (see
	// workingImageKey()). Comparing raw `image` alone can't tell two states
	// with different current renders apart, even though they'd submit
	// different request bodies.
	workingImageKey: string | undefined;
	objectReplacementObject: string;
	objectReplacementScale: number;
	textureReplacementSurface: string;
	textureReplacementMasked: boolean;
	lightSettingsPresetIds: string[];
	lightSettingsInstruction: string;
	lightSettingsPrompt: string;
	editPrompt: string;
	addObjectPresetId: string | null;
	removeObjectText: string;
	styleTransferPrompt: string;
	prompt: string;
}

const outputFormatSchema = z.enum(OUTPUT_FORMATS);
const sceneTypeSchema = z.enum(SCENE_TYPES);
const styleTransferStrengthSchema = z.number().min(0).max(1);
const objectReplacementScaleSchema = z.number().min(0.5).max(2);
// Bucketed, not continuous — text is the only lever that actually moves the
// model's sense of size (a same-scale image reframing trick tested against
// production had zero effect), and only a handful of tested phrasings exist,
// not one per slider step.
function objectReplacementSizeClauseKey(scale: number): TranslationKey | null {
	if (scale <= 0.65) return 'objectReplacement.sizeExtremeSmall';
	if (scale < 0.9) return 'objectReplacement.sizeModerateSmall';
	if (scale <= 1.1) return null;
	if (scale < 1.5) return 'objectReplacement.sizeModerateLarge';
	return 'objectReplacement.sizeExtremeLarge';
}
const replacementObjectSchema = z.string().max(200);
export const objectReplacementJobIdSchema = z.uuid();
const replacementSurfaceSchema = z.string().max(200);
const textureReplacementJobIdSchema = z.uuid();
const lightSettingsInstructionSchema = z.string().max(500);
export const lightSettingsJobIdSchema = z.uuid();
const fluxKontextEditJobIdSchema = z.uuid();
const fluxKontextEditInstructionSchema = z.string();
// A fixture's on/off ids are mutually exclusive (setLightSettingsFixtureState
// enforces that in the UI), but ids arriving here — from a shared URL or a
// persisted session — aren't guaranteed to respect that. Collapse each
// fixture pair to its last-mentioned id, and drop exact duplicates, while
// keeping every surviving id at its original position in the list.
const lightSettingsPresetGroupKey = (id: string): string => {
	const fixture = LIGHT_SETTINGS_FIXTURES.find(
		(candidate) => candidate.onId === id || candidate.offId === id
	);
	return fixture?.id ?? id;
};
const addObjectPresetIdSchema = z
	.string()
	.nullable()
	.transform((id) =>
		id !== null && ADD_OBJECT_PRESETS.some((preset) => preset.id === id) ? id : null
	);
const lightSettingsPresetIdsSchema = z.array(z.string()).transform((ids) => {
	const validIds = ids.filter((id) => LIGHT_SETTINGS_PRESETS.some((preset) => preset.id === id));
	const lastIndexByGroup: Record<string, number> = {};
	validIds.forEach((id, index) => {
		lastIndexByGroup[lightSettingsPresetGroupKey(id)] = index;
	});
	return validIds.filter(
		(id, index) => lastIndexByGroup[lightSettingsPresetGroupKey(id)] === index
	);
});

const imageInputSchema = z.union([
	z.object({
		mediaKey: z.string().min(1),
		mime: z.string().min(1).optional(),
		size: z.number().nonnegative().optional(),
		dimensions: z.tuple([z.number().positive(), z.number().positive()]).optional()
	}),
	z.object({
		stylePresetId: z.string().min(1),
		url: z.string().trim().url(),
		mime: z.string().min(1).optional()
	})
]);
const optionalImageInputSchema = imageInputSchema.optional();

const promptFragmentSchema = z.object({
	id: z.string().min(1),
	label: z.string().optional(),
	text: z.string(),
	order: z.number().int().nonnegative()
});

const editOperationSchema = z.object({
	type: z.enum(EDIT_OPERATION_TYPES),
	instruction: z.string()
});

// Exported for callers that receive a snapshot from outside this session
// (ScenesDrawer.svelte's restore flow, GET /api/generated-images/[id]) and
// need to validate it — including catalog membership (ADD_OBJECT_PRESETS,
// LIGHT_SETTINGS_PRESETS) — before handing it to restoreFormSnapshot().
export const requestFormSnapshotSchema = z.object({
	promptFragments: z.array(promptFragmentSchema),
	promptOverride: z.string().nullable(),
	editPrompt: z.string(),
	addObjectPresetId: addObjectPresetIdSchema,
	removeObjectText: z.string(),
	// Absent/null for a snapshot recorded before this field existed — restore
	// degrades to the 'freeform' default tool the same way it always did.
	editOperationType: z.enum(EDIT_OPERATION_TYPES).nullable().default(null),
	outputFormat: outputFormatSchema,
	sceneType: sceneTypeSchema,
	styleTransferPrompt: z.string(),
	styleTransferStrength: styleTransferStrengthSchema,
	styleNegativePrompt: z.string(),
	styleReferenceImage: optionalImageInputSchema,
	objectReplacementObject: replacementObjectSchema,
	objectReplacementScale: objectReplacementScaleSchema,
	objectReferenceImage: optionalImageInputSchema,
	textureReplacementSurface: replacementSurfaceSchema,
	textureReplacementMasked: z.boolean(),
	textureReferenceImage: optionalImageInputSchema,
	textureMaskImage: optionalImageInputSchema,
	textureMaskSourceKey: z.string().min(1).optional(),
	lightSettingsPresetIds: lightSettingsPresetIdsSchema,
	lightSettingsInstruction: lightSettingsInstructionSchema
});

const renderResultSchema = z.object({
	id: z.string().min(1),
	outputKey: z.string().min(1),
	cost: z.number(),
	balance: z.number(),
	parentId: z.string().optional(),
	editOp: editOperationSchema.optional(),
	sourceMode: z.enum(RENDER_SOURCE_MODES).optional(),
	formSnapshot: requestFormSnapshotSchema.optional(),
	ts: z.number()
});

const requestJsonSchema = z
	.object({
		id: z.string().min(1),
		image: optionalImageInputSchema,
		styleReferenceImage: optionalImageInputSchema,
		objectReferenceImage: optionalImageInputSchema,
		textureReferenceImage: optionalImageInputSchema,
		textureMaskImage: optionalImageInputSchema,
		textureMaskSourceKey: z.string().min(1).optional(),
		promptFragments: z.array(promptFragmentSchema),
		editPrompt: z.string().default(''),
		addObjectPresetId: addObjectPresetIdSchema.default(null),
		removeObjectText: z.string().default(''),
		outputFormat: outputFormatSchema,
		// Defaults to interior for persisted requests saved before this field existed.
		sceneType: sceneTypeSchema.default('interior'),
		styleTransferPrompt: z.string().default(''),
		styleTransferStrength: styleTransferStrengthSchema.default(0.7),
		styleNegativePrompt: z.string().default(''),
		objectReplacementObject: replacementObjectSchema.default(''),
		objectReplacementScale: objectReplacementScaleSchema.default(1),
		textureReplacementSurface: replacementSurfaceSchema.default(''),
		textureReplacementMasked: z.boolean().default(false),
		lightSettingsPresetIds: lightSettingsPresetIdsSchema.default([]),
		lightSettingsInstruction: lightSettingsInstructionSchema.default(''),
		promptOverride: z.string().nullable(),
		currentRender: renderResultSchema.optional(),
		status: z.enum(['idle', 'rendering', 'error'])
	})
	.superRefine((data, ctx) => {
		const ids: string[] = [];
		const orders: number[] = [];

		data.promptFragments.forEach((fragment, index) => {
			if (ids.includes(fragment.id)) {
				ctx.addIssue({
					code: 'custom',
					message: 'fragment ids must be unique',
					path: ['promptFragments', index, 'id']
				});
			}
			ids.push(fragment.id);

			if (orders.includes(fragment.order)) {
				ctx.addIssue({
					code: 'custom',
					message: 'fragment orders must be unique',
					path: ['promptFragments', index, 'order']
				});
			}
			orders.push(fragment.order);
		});
	});

export interface AddFragmentInput {
	label?: string;
	text: string;
	order?: number;
}

export interface UpdateFragmentPatch {
	label?: string | null;
	text?: string;
	order?: number;
}

export interface RenderResultFromResponseOptions {
	parentId?: string;
	editOp?: EditOperation;
	sourceMode?: RenderSourceMode;
	formSnapshot?: RequestFormSnapshot;
}

export class RequestReorderError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'RequestReorderError';
	}
}

export class RequestImageUploadError extends Error {
	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = 'RequestImageUploadError';
	}
}

export class RequestProjectSessionError extends Error {
	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = 'RequestProjectSessionError';
	}
}

function formatPromptFragment(fragment: PromptFragment): string {
	const label = fragment.label?.trim();
	if (!label) return fragment.text;
	const text = fragment.text.trim();
	return text ? `${label}: ${text}` : `${label}:`;
}

function derivePrompt(promptOverride: string | null, promptFragments: PromptFragment[]): string {
	if (promptOverride !== null) return promptOverride;
	const sortedFragments = [...promptFragments].sort((a, b) => a.order - b.order);
	const separator = sortedFragments.some((fragment) => fragment.label?.trim()) ? '\n' : '';
	return sortedFragments.map(formatPromptFragment).join(separator);
}

function sortFragments(fragments: PromptFragment[]): PromptFragment[] {
	return [...fragments].sort((a, b) => a.order - b.order);
}

function renumberFragments(fragments: PromptFragment[]): PromptFragment[] {
	return sortFragments(fragments).map((fragment, index) => ({ ...fragment, order: index }));
}

function cloneImage(image: ImageInput | undefined): ImageInput | undefined {
	if (!image) return undefined;
	if ('stylePresetId' in image) {
		return {
			stylePresetId: image.stylePresetId,
			url: image.url,
			...(image.mime !== undefined ? { mime: image.mime } : {})
		};
	}
	return {
		mediaKey: image.mediaKey,
		...(image.mime !== undefined ? { mime: image.mime } : {}),
		...(image.size !== undefined ? { size: image.size } : {}),
		...(image.dimensions ? { dimensions: [...image.dimensions] } : {})
	};
}

export function imageUrl(image: ImageInput | undefined): string | undefined {
	if (!image) return undefined;
	return 'stylePresetId' in image ? image.url : mediaAccess.get(image.mediaKey)?.url;
}

function managedImageKey(image: ImageInput | undefined): string | undefined {
	return image && 'mediaKey' in image ? image.mediaKey : undefined;
}

function cloneFragment(fragment: PromptFragment): PromptFragment {
	return {
		id: fragment.id,
		...(fragment.label !== undefined ? { label: fragment.label } : {}),
		text: fragment.text,
		order: fragment.order
	};
}

function cloneFragments(fragments: PromptFragment[]): PromptFragment[] {
	return sortFragments(fragments).map(cloneFragment);
}

function cloneEditOperation(editOp: EditOperation | undefined): EditOperation | undefined {
	if (!editOp) return undefined;
	return { type: editOp.type, instruction: editOp.instruction };
}

function cloneFormSnapshot(
	snapshot: RequestFormSnapshot | undefined
): RequestFormSnapshot | undefined {
	if (!snapshot) return undefined;
	return {
		promptFragments: cloneFragments(snapshot.promptFragments),
		promptOverride: snapshot.promptOverride,
		editPrompt: snapshot.editPrompt,
		addObjectPresetId: snapshot.addObjectPresetId,
		removeObjectText: snapshot.removeObjectText,
		editOperationType: snapshot.editOperationType,
		outputFormat: snapshot.outputFormat,
		sceneType: snapshot.sceneType,
		styleTransferPrompt: snapshot.styleTransferPrompt,
		styleTransferStrength: snapshot.styleTransferStrength,
		styleNegativePrompt: snapshot.styleNegativePrompt,
		...(snapshot.styleReferenceImage
			? { styleReferenceImage: cloneImage(snapshot.styleReferenceImage) }
			: {}),
		objectReplacementObject: snapshot.objectReplacementObject,
		objectReplacementScale: snapshot.objectReplacementScale,
		...(snapshot.objectReferenceImage
			? { objectReferenceImage: cloneImage(snapshot.objectReferenceImage) }
			: {}),
		textureReplacementSurface: snapshot.textureReplacementSurface,
		textureReplacementMasked: snapshot.textureReplacementMasked,
		...(snapshot.textureReferenceImage
			? { textureReferenceImage: cloneImage(snapshot.textureReferenceImage) }
			: {}),
		...(snapshot.textureMaskImage
			? { textureMaskImage: cloneImage(snapshot.textureMaskImage) }
			: {}),
		...(snapshot.textureMaskSourceKey !== undefined
			? { textureMaskSourceKey: snapshot.textureMaskSourceKey }
			: {}),
		lightSettingsPresetIds: [...snapshot.lightSettingsPresetIds],
		lightSettingsInstruction: snapshot.lightSettingsInstruction
	};
}

function cloneRenderResult(render: RenderResult): RenderResult;
function cloneRenderResult(render: RenderResult | undefined): RenderResult | undefined;
function cloneRenderResult(render: RenderResult | undefined): RenderResult | undefined {
	if (!render) return undefined;
	return {
		id: render.id,
		outputKey: render.outputKey,
		cost: render.cost,
		balance: render.balance,
		...(render.parentId !== undefined ? { parentId: render.parentId } : {}),
		...(render.editOp ? { editOp: cloneEditOperation(render.editOp) } : {}),
		...(render.sourceMode !== undefined ? { sourceMode: render.sourceMode } : {}),
		...(render.formSnapshot ? { formSnapshot: cloneFormSnapshot(render.formSnapshot) } : {}),
		ts: render.ts
	};
}

function cloneActiveObjectReplacementJob(
	job: ActiveObjectReplacementJob | undefined
): ActiveObjectReplacementJob | undefined {
	if (!job) return undefined;
	return {
		id: job.id,
		instruction: job.instruction,
		sourceRender: cloneRenderResult(job.sourceRender),
		formSnapshot: cloneFormSnapshot(job.formSnapshot)
	};
}

function cloneActiveTextureReplacementJob(
	job: ActiveTextureReplacementJob | undefined
): ActiveTextureReplacementJob | undefined {
	if (!job) return undefined;
	return {
		id: job.id,
		instruction: job.instruction,
		sourceRender: cloneRenderResult(job.sourceRender),
		formSnapshot: cloneFormSnapshot(job.formSnapshot)
	};
}

function cloneActiveLightSettingsJob(
	job: ActiveLightSettingsJob | undefined
): ActiveLightSettingsJob | undefined {
	if (!job) return undefined;
	return {
		id: job.id,
		instruction: job.instruction,
		sourceRender: cloneRenderResult(job.sourceRender),
		formSnapshot: cloneFormSnapshot(job.formSnapshot)
	};
}

function cloneActiveFluxKontextEditJob(
	job: ActiveFluxKontextEditJob | undefined
): ActiveFluxKontextEditJob | undefined {
	if (!job) return undefined;
	return {
		id: job.id,
		type: job.type,
		instruction: job.instruction,
		sourceRender: cloneRenderResult(job.sourceRender),
		formSnapshot: cloneFormSnapshot(job.formSnapshot)
	};
}

function insertFragment(
	fragments: PromptFragment[],
	fragment: PromptFragment,
	order: number
): PromptFragment[] {
	const ordered = sortFragments(fragments);
	const insertAt = Math.max(0, Math.min(order, ordered.length));
	return [
		...ordered.slice(0, insertAt),
		{ ...fragment, order: insertAt },
		...ordered.slice(insertAt)
	].map((item, index) => ({ ...item, order: index }));
}

function moveFragment(fragments: PromptFragment[], id: string, order: number): PromptFragment[] {
	const ordered = sortFragments(fragments);
	const fragment = ordered.find((item) => item.id === id);
	if (!fragment) return ordered;
	return insertFragment(
		ordered.filter((item) => item.id !== id),
		fragment,
		order
	);
}

export function renderResultFromResponse(
	response: RenderResponse,
	opts?: RenderResultFromResponseOptions
): RenderResult {
	return {
		// The stored generation's id whenever the server recorded one, so this
		// step can be referred back to server-side. Only an unrecorded result
		// (see RenderResponse.id) gets a local id, used for history alone.
		id: response.id ?? crypto.randomUUID(),
		outputKey: mediaAccess.normalize(response.output).key,
		cost: response.cost,
		balance: response.balance,
		parentId: opts?.parentId,
		editOp: opts?.editOp,
		sourceMode: opts?.sourceMode,
		formSnapshot: opts?.formSnapshot,
		ts: Date.now()
	};
}

const apiErrorSchema = z.object({ error: z.object({ code: z.string(), message: z.string() }) });

// Narrow schemas for #createProjectSession's two responses — only the id is
// ever read, so that's all that's validated (same principle as the rest of
// this file's response schemas: assert only what's actually consumed).
const projectCreationResponseSchema = z.object({ id: z.uuid() });
const sessionCreationResponseSchema = z.object({ id: z.uuid() });

// Shared by the render/edit call sites: a non-ok response's body is untrusted
// input, so validate it at the boundary instead of reading `error.code` off an
// implicit `any`. Falls back to `fallbackCode` for a malformed/missing body.
export async function extractApiErrorCode(
	response: Response,
	fallbackCode: string
): Promise<string> {
	const body: unknown = await response.json().catch(() => null);
	const parsed = apiErrorSchema.safeParse(body);
	return parsed.success ? parsed.data.error.code : fallbackCode;
}

export interface CreditErrorKeys {
	failed: TranslationKey;
	insufficientCredit: TranslationKey;
	generationRestricted: TranslationKey;
}

// Shared by renderErrorKey/editErrorKey (Workspace.svelte/EditPanel.svelte): both
// map the same server error codes to feature-prefixed translation keys.
export function creditErrorKey(keys: CreditErrorKeys, err: unknown): TranslationKey {
	if (!(err instanceof Error)) return keys.failed;
	if (err.message === 'insufficient_credit') return keys.insufficientCredit;
	if (err.message === 'generation_restricted') return keys.generationRestricted;
	return keys.failed;
}

export class RequestState {
	#textureMaskUploadEpoch = 0;
	// In-flight #ensureImageUploaded() upload, keyed to the file it's for — so
	// concurrent callers (e.g. the mask editor's eager upload alongside a
	// submit's own resolution) share one POST /api/uploads instead of each
	// firing a duplicate. Cleared once the upload settles, success or failure.
	#pendingUpload: { file: File; promise: Promise<ImageInput | undefined> } | undefined;
	// Bumped by reset()/copyFrom() — same guard shape as #textureMaskUploadEpoch.
	// Without it, a main-photo upload still in flight when this instance gets
	// frozen/thawed into a *different* session (see workspace-tabs.svelte.ts)
	// would call setImage() after the swap, grafting the old session's photo
	// onto whatever now lives here.
	#imageUploadEpoch = 0;
	// In-flight #ensureProjectSession() call, so concurrent toXRequest() calls
	// (e.g. a fast double-submit) share one pair of POST calls instead of each
	// creating its own project+session.
	#pendingProjectSession: Promise<{ projectId: string; sessionId: string }> | undefined;
	// Set once #createProjectSession's project POST succeeds, cleared once its
	// session POST also succeeds. If the session POST fails (or the whole call
	// throws and the caller retries), this survives so the retry reuses the
	// already-created project instead of leaving it orphaned and creating
	// another "Untitled" one on every failed attempt.
	#pendingProjectId: string | undefined;
	// Bumped by reset() — same guard shape as #textureMaskUploadEpoch. Without
	// it, a #createProjectSession() call still in flight when reset() runs
	// would call setProjectSession() after the reset, repopulating
	// projectId/sessionId on what's supposed to be a freshly blank state.
	#projectSessionEpoch = 0;
	id = $state<string>(crypto.randomUUID());
	// Module 11: which project/session a generation attaches to. Not part of
	// toJSON()/fromJSON() (those have no production caller — see
	// request-fixtures.ts) and not part of normalizeForComparison() (the
	// three-UI identity guarantee is about prompt-building fidelity, not which
	// session a request happens to be attached to). Deliberately never
	// persisted to the URL either — see url-state.ts's buildShareUrl comment —
	// so it only ever lives in this in-memory field, set either lazily by
	// ensureProjectSession() or explicitly when continuing a session from the
	// project page.
	projectId = $state<string | undefined>(undefined);
	sessionId = $state<string | undefined>(undefined);
	// The generation currently being previewed (see
	// workspace-tabs.svelte.ts's initializeGenerationPreview) — url-state.ts's
	// withProjectSession reads this to keep a `?generation=` URL anchor in
	// sync. setCurrentRender() clears it on every *real* render/edit, since
	// that means the on-screen result is no longer the one being anchored to;
	// initializeGenerationPreview re-sets it right after seeding history.
	viewingGenerationId = $state<string | undefined>(undefined);
	image = $state<ImageInput | undefined>(undefined);
	// The main photo, picked but not yet uploaded — set by ImageUpload.svelte
	// (target 'room' only) instead of calling /api/uploads immediately, so a
	// photo the user picks but never generates from never lands in the
	// bucket. Session UI state only: never part of toJSON()/fromJSON(), same
	// as textureMaskUploading/previousRender elsewhere in this class.
	pendingImageFile = $state<File | undefined>(undefined);
	// Local (blob:) preview of pendingImageFile, kept here rather than as
	// component-local state so it survives Render/Edit swapping between
	// separate <ImageUpload target="room"> instances (Workspace.svelte
	// mounts a fresh one per mode) and so workingImageUrl() can offer it to
	// preview-only consumers (e.g. the mask editor) before the real upload
	// happens. Session UI state only, same as pendingImageFile above.
	pendingImagePreviewUrl = $state<string | undefined>(undefined);
	styleReferenceImage = $state<ImageInput | undefined>(undefined);
	objectReferenceImage = $state<ImageInput | undefined>(undefined);
	textureReferenceImage = $state<ImageInput | undefined>(undefined);
	textureMaskImage = $state<ImageInput | undefined>(undefined);
	textureMaskSourceKey = $state<string | undefined>(undefined);
	promptFragments = $state<PromptFragment[]>([]);
	editPrompt = $state('');
	// The Add object/Remove object edit-panel tools' own selections — kept
	// here (like every other edit tool's fields) rather than as component-
	// local state, so they survive a panel remount and stay visible as "the
	// settings used for this generation" instead of silently resetting.
	addObjectPresetId = $state<string | null>(null);
	removeObjectText = $state('');
	activeFluxKontextEditJob = $state<ActiveFluxKontextEditJob | undefined>(undefined);
	outputFormat = $state<OutputFormat>('webp');
	sceneType = $state<SceneType>('interior');
	styleTransferPrompt = $state('');
	styleTransferStrength = $state(0.7);
	styleNegativePrompt = $state('');
	objectReplacementObject = $state('');
	objectReplacementScale = $state(1);
	activeObjectReplacementJob = $state<ActiveObjectReplacementJob | undefined>(undefined);
	textureReplacementSurface = $state('');
	textureReplacementMasked = $state(false);
	textureMaskUploading = $state(false);
	activeTextureReplacementJob = $state<ActiveTextureReplacementJob | undefined>(undefined);
	// Ordered (click-order) selection of light-settings preset ids (see
	// $lib/light-settings-presets) — the store of *selections*, not resolved
	// text; lightSettingsPrompt below derives the actual instruction from this
	// plus the free-text supplement, so there is exactly one source of truth.
	lightSettingsPresetIds = $state<string[]>([]);
	lightSettingsInstruction = $state('');
	activeLightSettingsJob = $state<ActiveLightSettingsJob | undefined>(undefined);
	// Whether the currently displayed render is already the resolved result of a
	// masked texture-replacement submission — Workspace.svelte reads this to know
	// when to swap the canvas from the mask-drawing surface back to the render
	// result. Session UI state (not part of toJSON()/fromJSON()), same as
	// textureMaskUploading above.
	textureReplacementResultReady = $state(false);
	promptOverride = $state<string | null>(null);
	// In-session render history (FR-К6): every generation and edit result produced
	// this session is a step, navigable back/forth via undo/redo. Deliberately not
	// part of toJSON()/fromJSON() — it's session UI state, not the request model.
	#renderHistory = $state<RenderResult[]>([]);
	#historyIndex = $state(-1);
	status = $state<RequestStatus>('idle');

	prompt = $derived.by(() => derivePrompt(this.promptOverride, this.promptFragments));

	// The single source of truth for what gets sent to /api/light-settings:
	// each selected preset's phrase (in click order), then the free-text
	// supplement, comma-joined. Never written back into lightSettingsInstruction
	// — components read this to preview/submit, never the other way around.
	lightSettingsPrompt = $derived.by(() => {
		const phrases = this.lightSettingsPresetIds
			.map((id) => LIGHT_SETTINGS_PRESETS.find((preset) => preset.id === id))
			.filter((preset) => preset !== undefined)
			.map((preset) => t(preset.phrase));
		const custom = this.lightSettingsInstruction.trim();
		return [...phrases, ...(custom ? [custom] : [])].join(', ');
	});

	// What actually gets sent as replacementObject: the located-object
	// description plus a translated size clause when the scale slider has
	// moved off its 1 (as-shown) default — same comma-joined shape as
	// lightSettingsPrompt above.
	objectReplacementInstruction = $derived.by(() => {
		const object = this.objectReplacementObject.trim();
		const sizeClauseKey = objectReplacementSizeClauseKey(this.objectReplacementScale);
		return sizeClauseKey ? `${object}, ${t(sizeClauseKey)}` : object;
	});

	get currentRender(): RenderResult | undefined {
		return this.#historyIndex >= 0 ? this.#renderHistory[this.#historyIndex] : undefined;
	}

	// The step right before the current one, if any — the "before" side of the
	// compare slider and the render an undo would restore.
	get previousRender(): RenderResult | undefined {
		return this.#historyIndex > 0 ? this.#renderHistory[this.#historyIndex - 1] : undefined;
	}

	get canSubmit(): boolean {
		return this.validate().valid && this.status === 'idle';
	}

	get canUndoEdit(): boolean {
		return this.#historyIndex > 0;
	}

	get canRedoEdit(): boolean {
		return this.#historyIndex >= 0 && this.#historyIndex < this.#renderHistory.length - 1;
	}

	get activeObjectReplacementJobId(): string | undefined {
		return this.activeObjectReplacementJob?.id;
	}

	get activeTextureReplacementJobId(): string | undefined {
		return this.activeTextureReplacementJob?.id;
	}

	get activeLightSettingsJobId(): string | undefined {
		return this.activeLightSettingsJob?.id;
	}

	get activeFluxKontextEditJobId(): string | undefined {
		return this.activeFluxKontextEditJob?.id;
	}

	addFragment(input: AddFragmentInput): string {
		const id = crypto.randomUUID();
		const order =
			input.order ??
			(this.promptFragments.length === 0
				? 0
				: Math.max(...this.promptFragments.map((fragment) => fragment.order)) + 1);
		this.promptFragments = insertFragment(
			this.promptFragments,
			{
				id,
				...(input.label !== undefined ? { label: input.label } : {}),
				text: input.text,
				order
			},
			order
		);
		return id;
	}

	updateFragment(id: string, patch: UpdateFragmentPatch): void {
		const index = this.promptFragments.findIndex((fragment) => fragment.id === id);
		if (index === -1) return;
		const current = this.promptFragments[index];
		const next: PromptFragment = { ...current };
		if (patch.label !== undefined) {
			if (patch.label === null) delete next.label;
			else next.label = patch.label;
		}
		if (patch.text !== undefined) next.text = patch.text;
		if (patch.order !== undefined) next.order = patch.order;
		this.promptFragments = this.promptFragments.with(index, next);
		if (patch.order !== undefined) {
			this.promptFragments = moveFragment(this.promptFragments, id, patch.order);
		}
	}

	removeFragment(id: string): void {
		this.promptFragments = renumberFragments(
			this.promptFragments.filter((fragment) => fragment.id !== id)
		);
	}

	// Wholesale replacement of the fragment list — used when restoring a shared
	// request from a URL, where the caller only has label/text pairs, not ids.
	setFragments(fragments: { label?: string; text: string }[]): void {
		this.promptFragments = fragments.map((fragment, order) => ({
			id: crypto.randomUUID(),
			...(fragment.label !== undefined ? { label: fragment.label } : {}),
			text: fragment.text,
			order
		}));
	}

	setEditPrompt(prompt: string): void {
		this.editPrompt = prompt;
	}

	setAddObjectPresetId(id: string | null): void {
		this.addObjectPresetId =
			id !== null && ADD_OBJECT_PRESETS.some((preset) => preset.id === id) ? id : null;
	}

	setRemoveObjectText(text: string): void {
		this.removeObjectText = text;
	}

	reorder(orderedIds: string[]): void {
		if (orderedIds.length !== this.promptFragments.length) {
			throw new RequestReorderError('orderedIds must include every fragment exactly once');
		}
		if (orderedIds.some((id, index) => orderedIds.indexOf(id) !== index)) {
			throw new RequestReorderError('orderedIds must include every fragment exactly once');
		}
		const byId: Record<string, PromptFragment> = {};
		for (const fragment of this.promptFragments) byId[fragment.id] = fragment;
		if (orderedIds.some((id) => !(id in byId))) {
			throw new RequestReorderError('orderedIds contains unknown fragment id');
		}
		this.promptFragments = orderedIds.map((id, order) => ({ ...byId[id], order }));
	}

	setImage(image: ImageInput | undefined): void {
		this.image = cloneImage(optionalImageInputSchema.parse(image));
		this.pendingImageFile = undefined;
		this.#clearPendingImagePreview();
	}

	// Puts an existing image on the canvas as a fresh starting point: it
	// becomes the working image (see workingImageUrl()) every tool continues
	// from. The one entry point for every "open this image" action (scenes
	// drawer, resources, continuing a session, previewing a past generation),
	// so none of them can leave a stale piece of the previous image behind.
	startFromImage(image: ImageInput): void {
		this.setImage(image);
		this.clearCanvasWork();
	}

	// Drops everything attached to what's currently on the canvas — render
	// history, in-flight jobs, a mask drawn over the old image — while
	// keeping the photo itself and the form settings.
	clearCanvasWork(): void {
		this.setCurrentRender(undefined);
		this.setTextureMaskImage(undefined);
		this.setActiveObjectReplacementJobId(undefined);
		this.setActiveTextureReplacementJobId(undefined);
		this.setActiveLightSettingsJobId(undefined);
		this.setActiveFluxKontextEditJobId(undefined);
		this.setStatus('idle');
	}

	setProjectSession(projectId: string, sessionId: string): void {
		this.projectId = projectId;
		this.sessionId = sessionId;
	}

	clearProjectSession(): void {
		this.projectId = undefined;
		this.sessionId = undefined;
	}

	setViewingGenerationId(id: string | undefined): void {
		this.viewingGenerationId = id;
	}

	// Called by ImageUpload.svelte (target 'room') when the user picks a
	// file: stores it locally without uploading. The actual /api/uploads call
	// happens lazily, only when a generate call needs the resolved URL — see
	// #ensureImageUploaded().
	setPendingImage(file: File | undefined): void {
		this.#clearPendingImagePreview();
		this.pendingImageFile = file;
		this.pendingImagePreviewUrl = file ? URL.createObjectURL(file) : undefined;
		this.image = undefined;
	}

	#clearPendingImagePreview(): void {
		if (this.pendingImagePreviewUrl) URL.revokeObjectURL(this.pendingImagePreviewUrl);
		this.pendingImagePreviewUrl = undefined;
	}

	setStyleReferenceImage(image: ImageInput | undefined): void {
		this.styleReferenceImage = cloneImage(optionalImageInputSchema.parse(image));
	}

	setObjectReferenceImage(image: ImageInput | undefined): void {
		this.objectReferenceImage = cloneImage(optionalImageInputSchema.parse(image));
	}

	setTextureReferenceImage(image: ImageInput | undefined): void {
		this.textureReferenceImage = cloneImage(optionalImageInputSchema.parse(image));
	}

	setTextureMaskImage(image: ImageInput | undefined): void {
		this.#textureMaskUploadEpoch += 1;
		this.textureMaskUploading = false;
		if (image === undefined) {
			this.textureMaskImage = undefined;
			this.textureMaskSourceKey = undefined;
			return;
		}
		const sourceKey = this.workingImageKey();
		if (!sourceKey) return;
		this.textureMaskImage = cloneImage(optionalImageInputSchema.parse(image));
		this.textureMaskSourceKey = sourceKey;
	}

	beginTextureMaskUpload(): TextureMaskUploadOperation | null {
		const sourceKey = this.workingImageKey();
		if (!sourceKey || !this.textureReplacementMasked) return null;
		this.#textureMaskUploadEpoch += 1;
		this.textureMaskUploading = true;
		return { epoch: this.#textureMaskUploadEpoch, sourceKey };
	}

	commitTextureMaskUpload(image: ImageInput, operation: TextureMaskUploadOperation): boolean {
		if (
			!this.textureReplacementMasked ||
			operation.epoch !== this.#textureMaskUploadEpoch ||
			operation.sourceKey !== this.workingImageKey()
		) {
			return false;
		}
		this.textureMaskImage = cloneImage(optionalImageInputSchema.parse(image));
		this.textureMaskSourceKey = operation.sourceKey;
		this.textureMaskUploading = false;
		return true;
	}

	finishTextureMaskUpload(operation: TextureMaskUploadOperation): void {
		if (operation.epoch === this.#textureMaskUploadEpoch) this.textureMaskUploading = false;
	}

	textureMaskMatchesSource(): boolean {
		return (
			managedImageKey(this.textureMaskImage) !== undefined &&
			this.textureMaskSourceKey === this.workingImageKey()
		);
	}

	setStyleTransferPrompt(prompt: string): void {
		this.styleTransferPrompt = prompt;
	}

	setOutputFormat(format: OutputFormat): void {
		this.outputFormat = format;
	}

	setSceneType(type: SceneType): void {
		this.sceneType = sceneTypeSchema.parse(type);
	}

	setStyleTransferStrength(strength: number): void {
		this.styleTransferStrength = styleTransferStrengthSchema.parse(strength);
	}

	setStyleNegativePrompt(prompt: string): void {
		this.styleNegativePrompt = prompt;
	}

	setObjectReplacementObject(object: string): void {
		this.objectReplacementObject = replacementObjectSchema.parse(object);
	}

	setObjectReplacementScale(scale: number): void {
		this.objectReplacementScale = objectReplacementScaleSchema.parse(scale);
	}

	setActiveObjectReplacementJobId(id: string | undefined): void {
		const parsed = objectReplacementJobIdSchema.optional().parse(id);
		if (parsed === this.activeObjectReplacementJob?.id) return;
		this.activeObjectReplacementJob = parsed
			? { id: parsed, instruction: this.objectReplacementObject.trim() }
			: undefined;
	}

	setActiveObjectReplacementJob(
		id: string,
		sourceRender: RenderResult | undefined,
		instruction: string
	): void {
		this.activeObjectReplacementJob = {
			id: objectReplacementJobIdSchema.parse(id),
			instruction: replacementObjectSchema.parse(instruction).trim(),
			sourceRender: cloneRenderResult(sourceRender),
			formSnapshot: this.captureFormSnapshot('replace-object')
		};
	}

	toggleLightSettingsPreset(id: string): void {
		if (!LIGHT_SETTINGS_PRESETS.some((preset) => preset.id === id)) return;
		this.lightSettingsPresetIds = this.lightSettingsPresetIds.includes(id)
			? this.lightSettingsPresetIds.filter((presetId) => presetId !== id)
			: [...this.lightSettingsPresetIds, id];
	}

	setLightSettingsPresetIds(ids: string[]): void {
		this.lightSettingsPresetIds = lightSettingsPresetIdsSchema.parse(ids);
	}

	// Fixture rows are a single on/off toggle, not two independent buttons —
	// selecting one state clears the other for the same fixture. `state: null`
	// clears both (back to "not mentioned" for that fixture).
	setLightSettingsFixtureState(fixtureId: string, state: 'on' | 'off' | null): void {
		const fixture = LIGHT_SETTINGS_FIXTURES.find((candidate) => candidate.id === fixtureId);
		if (!fixture) return;
		const withoutFixture = this.lightSettingsPresetIds.filter(
			(id) => id !== fixture.onId && id !== fixture.offId
		);
		this.lightSettingsPresetIds =
			state === null
				? withoutFixture
				: [...withoutFixture, state === 'on' ? fixture.onId : fixture.offId];
	}

	setLightSettingsInstruction(instruction: string): void {
		this.lightSettingsInstruction = lightSettingsInstructionSchema.parse(instruction);
	}

	prefillFromModeHint(target: ModeHintTarget, text: string): void {
		const trimmed = text.trim();
		if (target.mode === 'styleTransfer') {
			if (this.styleTransferPrompt.trim() === '') this.styleTransferPrompt = trimmed;
		} else if (target.tool === 'add-object') {
			this.setAddObjectPresetId(target.presetId);
		} else if (target.tool === 'freeform') {
			if (this.editPrompt.trim() === '') this.editPrompt = trimmed;
		} else if (target.tool === 'light-settings') {
			const instruction = lightSettingsInstructionSchema.safeParse(trimmed);
			if (this.lightSettingsInstruction.trim() === '' && instruction.success) {
				this.lightSettingsInstruction = instruction.data;
			}
		}
	}

	setActiveLightSettingsJobId(id: string | undefined): void {
		const parsed = lightSettingsJobIdSchema.optional().parse(id);
		if (parsed === this.activeLightSettingsJob?.id) return;
		this.activeLightSettingsJob = parsed
			? { id: parsed, instruction: this.lightSettingsPrompt.trim() }
			: undefined;
	}

	setActiveLightSettingsJob(
		id: string,
		sourceRender: RenderResult | undefined,
		instruction: string
	): void {
		this.activeLightSettingsJob = {
			id: lightSettingsJobIdSchema.parse(id),
			instruction: lightSettingsInstructionSchema.parse(instruction).trim(),
			sourceRender: cloneRenderResult(sourceRender),
			formSnapshot: this.captureFormSnapshot('light-settings')
		};
	}

	// `type` only matters for the id-only (URL-restore) path — the submit-time
	// path below always has the real type from the tool that just submitted.
	// add-object/remove-object have no persisted instruction field (unlike
	// freeform's `editPrompt`), so a restored job for those two loses its exact
	// wording; the job id itself (what actually resumes polling) is unaffected.
	setActiveFluxKontextEditJobId(
		id: string | undefined,
		type: EditOperationType = 'freeform'
	): void {
		const parsed = fluxKontextEditJobIdSchema.optional().parse(id);
		if (parsed === this.activeFluxKontextEditJob?.id) return;
		this.activeFluxKontextEditJob = parsed
			? { id: parsed, type, instruction: type === 'freeform' ? this.editPrompt.trim() : '' }
			: undefined;
	}

	setActiveFluxKontextEditJob(
		id: string,
		sourceRender: RenderResult | undefined,
		instruction: string,
		type: EditOperationType
	): void {
		this.activeFluxKontextEditJob = {
			id: fluxKontextEditJobIdSchema.parse(id),
			type,
			instruction: fluxKontextEditInstructionSchema.parse(instruction).trim(),
			sourceRender: cloneRenderResult(sourceRender),
			formSnapshot: this.captureFormSnapshot(type)
		};
	}

	setTextureReplacementSurface(surface: string): void {
		this.textureReplacementSurface = replacementSurfaceSchema.parse(surface);
	}

	setTextureReplacementMasked(masked: boolean): void {
		const parsed = z.boolean().parse(masked);
		if (parsed !== this.textureReplacementMasked) {
			this.#textureMaskUploadEpoch += 1;
			this.textureMaskUploading = false;
			if (parsed) this.textureReplacementResultReady = false;
		}
		this.textureReplacementMasked = parsed;
	}

	setTextureReplacementResultReady(ready: boolean): void {
		this.textureReplacementResultReady = z.boolean().parse(ready);
	}

	setActiveTextureReplacementJobId(id: string | undefined): void {
		const parsed = textureReplacementJobIdSchema.optional().parse(id);
		if (parsed === this.activeTextureReplacementJob?.id) return;
		this.activeTextureReplacementJob = parsed
			? { id: parsed, instruction: this.textureReplacementSurface.trim() }
			: undefined;
	}

	setActiveTextureReplacementJob(
		id: string,
		sourceRender: RenderResult | undefined,
		instruction: string
	): void {
		this.activeTextureReplacementJob = {
			id: textureReplacementJobIdSchema.parse(id),
			instruction: replacementSurfaceSchema.parse(instruction).trim(),
			sourceRender: cloneRenderResult(sourceRender),
			formSnapshot: this.captureFormSnapshot('change-surface-color')
		};
	}

	setPromptOverride(text: string): void {
		this.promptOverride = text;
	}

	clearPromptOverride(): void {
		this.promptOverride = null;
	}

	// The originally uploaded photo, synthesized as the root history step so
	// it's reachable via undo alongside every generation/edit (FR-К6). Its
	// balance is derived from the first real render's server-returned
	// cost/balance (balance-after + cost-of-that-render), since no generation
	// call was ever made for the upload itself.
	#syntheticOriginalStep(firstRender: RenderResult): RenderResult | undefined {
		if (!this.image || !('mediaKey' in this.image)) return undefined;
		return {
			id: `${this.id}:original`,
			outputKey: this.image.mediaKey,
			cost: 0,
			balance: firstRender.balance + firstRender.cost,
			ts: 0
		};
	}

	// Starts a brand-new one-or-two-step history with `render` as the tip,
	// rooted at the originally uploaded photo when one is available.
	#seedHistory(render: RenderResult): void {
		const original = this.#syntheticOriginalStep(render);
		this.#renderHistory = original ? [original, render] : [render];
		this.#historyIndex = this.#renderHistory.length - 1;
	}

	// Appends a render onto the history at the given anchor, discarding any
	// steps that came after it (a new step abandons whatever redo branch was
	// pending — it's a new step, not a continuation of what undo just left).
	// An empty history seeds a brand-new one rooted at the uploaded photo. An
	// anchor that's no longer in history (its own branch was since discarded
	// by another push, e.g. a late-arriving async edit whose sourceRender
	// snapshot fell out of the chain) lands on the current tip instead of
	// discarding whatever happened in between.
	// The form fields that produced whichever render is about to be pushed —
	// a fallback for a render that doesn't already carry one. Every submit
	// path that can run for more than an instant (the async job tools, whose
	// own tests confirm the user may switch tabs/modes while one is polling)
	// captures its own snapshot with captureFormSnapshot() up front, at
	// submit time, and attaches it before calling setCurrentRender()/
	// applyEditResult() — "what the form holds right now", captured here,
	// would otherwise reflect whatever the user has since typed elsewhere,
	// not what was actually submitted.
	// `editOperationType` disambiguates a `kind: 'edit'` generation between the
	// three tools that share it (freeform/add-object/remove-object) — pass the
	// one the caller knows it's capturing for; omit for kinds with no such
	// ambiguity (render, style-transfer), where it stays null.
	captureFormSnapshot(editOperationType: EditOperationType | null = null): RequestFormSnapshot {
		return {
			promptFragments: cloneFragments(this.promptFragments),
			promptOverride: this.promptOverride,
			editPrompt: this.editPrompt,
			addObjectPresetId: this.addObjectPresetId,
			removeObjectText: this.removeObjectText,
			editOperationType,
			outputFormat: this.outputFormat,
			sceneType: this.sceneType,
			styleTransferPrompt: this.styleTransferPrompt,
			styleTransferStrength: this.styleTransferStrength,
			styleNegativePrompt: this.styleNegativePrompt,
			...(this.styleReferenceImage
				? { styleReferenceImage: cloneImage(this.styleReferenceImage) }
				: {}),
			objectReplacementObject: this.objectReplacementObject,
			objectReplacementScale: this.objectReplacementScale,
			...(this.objectReferenceImage
				? { objectReferenceImage: cloneImage(this.objectReferenceImage) }
				: {}),
			textureReplacementSurface: this.textureReplacementSurface,
			textureReplacementMasked: this.textureReplacementMasked,
			...(this.textureReferenceImage
				? { textureReferenceImage: cloneImage(this.textureReferenceImage) }
				: {}),
			...(this.textureMaskImage ? { textureMaskImage: cloneImage(this.textureMaskImage) } : {}),
			...(this.textureMaskSourceKey !== undefined
				? { textureMaskSourceKey: this.textureMaskSourceKey }
				: {}),
			lightSettingsPresetIds: [...this.lightSettingsPresetIds],
			lightSettingsInstruction: this.lightSettingsInstruction
		};
	}

	// Restores the form to a past step's settings (FR-К6 undo/redo) — a no-op
	// when the step predates this feature or has none (the synthetic
	// original-photo root step, see #syntheticOriginalStep), leaving whatever
	// the user currently has typed untouched rather than blanking it.
	#applyFormSnapshot(snapshot: RequestFormSnapshot | undefined): void {
		if (!snapshot) return;
		this.promptFragments = cloneFragments(snapshot.promptFragments);
		this.promptOverride = snapshot.promptOverride;
		this.editPrompt = snapshot.editPrompt;
		this.addObjectPresetId = snapshot.addObjectPresetId;
		this.removeObjectText = snapshot.removeObjectText;
		this.outputFormat = snapshot.outputFormat;
		this.sceneType = snapshot.sceneType;
		this.styleTransferPrompt = snapshot.styleTransferPrompt;
		this.styleTransferStrength = snapshot.styleTransferStrength;
		this.styleNegativePrompt = snapshot.styleNegativePrompt;
		this.styleReferenceImage = cloneImage(snapshot.styleReferenceImage);
		this.objectReplacementObject = snapshot.objectReplacementObject;
		this.objectReplacementScale = snapshot.objectReplacementScale;
		this.objectReferenceImage = cloneImage(snapshot.objectReferenceImage);
		this.textureReplacementSurface = snapshot.textureReplacementSurface;
		this.textureReplacementMasked = snapshot.textureReplacementMasked;
		this.textureReferenceImage = cloneImage(snapshot.textureReferenceImage);
		this.textureMaskImage = cloneImage(snapshot.textureMaskImage);
		this.textureMaskSourceKey = snapshot.textureMaskSourceKey;
		this.lightSettingsPresetIds = [...snapshot.lightSettingsPresetIds];
		this.lightSettingsInstruction = snapshot.lightSettingsInstruction;
	}

	// Public entry point for restoring a past generation's exact settings from
	// a snapshot fetched from the server (GET /api/generated-images/[id]) —
	// the DB-backed counterpart to undo/redo's own #applyFormSnapshot, which
	// only replays snapshots already held in this session's render history.
	// Doesn't touch image, session, or render-history identity; the caller
	// sets those around this call the same way it already does for
	// setImage()/setCurrentRender() (see ScenesDrawer.svelte's restore flow).
	restoreFormSnapshot(snapshot: RequestFormSnapshot): void {
		this.#applyFormSnapshot(snapshot);
	}

	#pushRender(render: RenderResult, after: RenderResult | undefined): void {
		const withFormSnapshot: RenderResult = render.formSnapshot
			? render
			: { ...render, formSnapshot: this.captureFormSnapshot() };
		if (this.#renderHistory.length === 0) {
			this.#seedHistory(withFormSnapshot);
			return;
		}
		const afterIndex =
			after !== undefined ? this.#renderHistory.findIndex((entry) => entry.id === after.id) : -1;
		const base =
			afterIndex === -1
				? this.#renderHistory.slice(0, this.#historyIndex + 1)
				: this.#renderHistory.slice(0, afterIndex + 1);
		this.#renderHistory = [...base, withFormSnapshot];
		this.#historyIndex = this.#renderHistory.length - 1;
	}

	// A fresh generation is a new step in the same history as any prior
	// generations/edits (FR-К6), so it stays reachable via undo/redo. Passing
	// `undefined` clears the whole history — switching to a different base
	// photo, or an explicit reset (see reset()).
	setCurrentRender(render: RenderResult | undefined): void {
		this.viewingGenerationId = undefined;
		if (render === undefined) {
			this.#renderHistory = [];
			this.#historyIndex = -1;
			return;
		}
		this.#pushRender(cloneRenderResult(render), this.currentRender);
	}

	// Applies the result of an edit (FR-К4) as a new history step, anchored at
	// `sourceRender` (the render the edit was actually requested against —
	// callers may snapshot this before an async call so a slow response still
	// attaches to the right point even if the user has since navigated on).
	applyEditResult(
		render: RenderResult,
		sourceRender: RenderResult | undefined = this.currentRender
	): void {
		this.viewingGenerationId = undefined;
		this.#pushRender(cloneRenderResult(render), cloneRenderResult(sourceRender));
	}

	// Steps back to the previous render in history (FR-К6), restoring the form
	// to the settings that produced it so the user can see and, if they want,
	// tweak and re-submit them (see #applyFormSnapshot). No-op if already at
	// the first step.
	undoLastEdit(): void {
		if (this.#historyIndex <= 0) return;
		this.viewingGenerationId = undefined;
		this.#historyIndex -= 1;
		this.#applyFormSnapshot(this.currentRender?.formSnapshot);
	}

	// Steps forward to the render that undo just left, restoring its form
	// settings the same way undoLastEdit() does. No-op if already at the most
	// recent step.
	redoEdit(): void {
		if (this.#historyIndex < 0 || this.#historyIndex >= this.#renderHistory.length - 1) return;
		this.#historyIndex += 1;
		this.#applyFormSnapshot(this.currentRender?.formSnapshot);
	}

	setStatus(status: RequestStatus): void {
		this.status = status;
	}

	validate(): ValidationResult {
		const missing: ValidationField[] = [];
		if (!managedImageKey(this.image) && !this.pendingImageFile) missing.push('image');
		return { valid: missing.length === 0, missing };
	}

	validateStyleTransfer(): ValidationResult {
		const missing: ValidationField[] = [];
		if (!this.hasWorkingImage()) missing.push('image');
		if (!this.styleReferenceImage) missing.push('referenceImage');
		return { valid: missing.length === 0, missing };
	}

	validateObjectReplacement(): ValidationResult {
		const missing: ValidationField[] = [];
		if (!this.hasWorkingImage()) missing.push('image');
		if (!managedImageKey(this.objectReferenceImage)) missing.push('referenceImage');
		if (!this.objectReplacementObject.trim()) missing.push('replacementObject');
		return { valid: missing.length === 0, missing };
	}

	validateTextureReplacement(): ValidationResult {
		const missing: ValidationField[] = [];
		if (!this.hasWorkingImage()) missing.push('image');
		if (!managedImageKey(this.textureReferenceImage)) missing.push('referenceImage');
		if (this.textureReplacementMasked) {
			if (!this.textureMaskMatchesSource()) missing.push('mask');
		} else if (!this.textureReplacementSurface.trim()) {
			missing.push('replacementSurface');
		}
		return { valid: missing.length === 0, missing };
	}

	validateLightSettings(): ValidationResult {
		const missing: ValidationField[] = [];
		if (!this.hasWorkingImage()) missing.push('image');
		if (!this.lightSettingsPrompt.trim()) missing.push('instruction');
		return { valid: missing.length === 0, missing };
	}

	// The single image every tool works on: the latest render/edit result
	// once one exists, the room photo before that. There is deliberately no
	// per-tool choice — each generation continues from whatever is currently
	// on the canvas.
	//
	// Sync "best guess" URL for preview/display purposes only (e.g. the mask
	// editor's canvas source) — falls back to the pending file's local blob:
	// preview when nothing has actually been uploaded yet (same origin, so
	// it's safe to draw into a canvas). Do not use this for building request
	// bodies — that's what resolveWorkingImageKey() is for, since a blob: URL
	// isn't accepted by the key-only server contract.
	workingImageUrl(): string | undefined {
		return this.currentRender
			? mediaAccess.get(this.currentRender.outputKey)?.url
			: (imageUrl(this.image) ?? this.pendingImagePreviewUrl);
	}

	workingImageKey(): string | undefined {
		return this.currentRender ? this.currentRender.outputKey : managedImageKey(this.image);
	}

	// Sync "is there something to submit" check for button-enabled validation —
	// a pending, not-yet-uploaded file already counts (the actual upload is
	// deferred, not skipped: #ensureImageUploaded() guarantees it runs before
	// the request is sent). Do not use this for building request bodies — see
	// resolveWorkingImageKey().
	hasWorkingImage(): boolean {
		return (
			this.currentRender !== undefined ||
			this.image !== undefined ||
			this.pendingImageFile !== undefined
		);
	}

	// Resolves the managed media key for the outgoing request body. Triggers the
	// deferred main-photo upload the first time it's needed — see
	// #ensureImageUploaded(). The mask editor also calls this eagerly the moment
	// masked texture mode is entered, so it can draw on (and later validate the
	// finished mask against) a stable server URL instead of a blob: preview.
	async resolveWorkingImageKey(): Promise<string | undefined> {
		if (this.currentRender) return this.currentRender.outputKey;
		const image = await this.#ensureImageUploaded();
		return managedImageKey(image);
	}

	// Uploads the pending main photo the first time a generate call actually
	// needs its media key, then caches the result on `image` (via setImage).
	// Throws RequestImageUploadError on failure so callers can show an
	// upload-specific message instead of a generic "render failed" one.
	async #ensureImageUploaded(): Promise<ImageInput | undefined> {
		if (this.image) return this.image;
		const file = this.pendingImageFile;
		if (!file) return undefined;

		if (this.#pendingUpload?.file === file) return this.#pendingUpload.promise;

		const promise = this.#uploadPendingImage(file);
		this.#pendingUpload = { file, promise };
		promise
			.finally(() => {
				if (this.#pendingUpload?.file === file) this.#pendingUpload = undefined;
			})
			.catch(() => {});
		return promise;
	}

	async #uploadPendingImage(file: File): Promise<ImageInput | undefined> {
		const epoch = this.#imageUploadEpoch;
		let uploaded: ImageInput;
		try {
			const formData = new FormData();
			formData.append('file', file);
			const response = await fetch('/api/uploads', { method: 'POST', body: formData });
			if (!response.ok) throw new RequestImageUploadError('upload request failed');
			const parsed = uploadResultSchema.safeParse(await response.json().catch(() => null));
			if (!parsed.success) throw new RequestImageUploadError('upload response invalid');
			uploaded = {
				mediaKey: mediaAccess.normalize(parsed.data.image).key,
				mime: parsed.data.mime,
				size: parsed.data.size,
				...(parsed.data.dimensions ? { dimensions: parsed.data.dimensions } : {})
			};
		} catch (error) {
			if (error instanceof RequestImageUploadError) throw error;
			throw new RequestImageUploadError('upload failed', { cause: error });
		}

		// This instance was reset or frozen/thawed into a different session
		// (see reset()/copyFrom()) while the upload was in flight — attaching
		// the result now would silently graft it onto whatever now lives here.
		if (this.#imageUploadEpoch !== epoch) {
			throw new RequestImageUploadError('upload superseded');
		}

		this.setImage(uploaded);
		return this.image;
	}

	// Lazily provisions a project+session the first time a generation call needs
	// one — same "resolve on demand, cache the result" shape as
	// #ensureImageUploaded(). A user who never visited a projects UI still gets a
	// working, isolated session (an "Untitled" project) instead of every
	// generation call failing for lack of one.
	async ensureProjectSession(): Promise<{ projectId: string; sessionId: string }> {
		if (this.projectId && this.sessionId) {
			return { projectId: this.projectId, sessionId: this.sessionId };
		}
		if (this.#pendingProjectSession) return this.#pendingProjectSession;

		const promise = this.#createProjectSession();
		this.#pendingProjectSession = promise;
		promise
			.finally(() => {
				if (this.#pendingProjectSession === promise) this.#pendingProjectSession = undefined;
			})
			.catch(() => {});
		return promise;
	}

	async #createProjectSession(): Promise<{ projectId: string; sessionId: string }> {
		const epoch = this.#projectSessionEpoch;
		let projectId = this.#pendingProjectId;
		if (!projectId) {
			const projectResponse = await fetch('/api/projects', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ title: t('workspace.tabs.untitled') })
			});
			if (!projectResponse.ok) {
				throw new RequestProjectSessionError('project creation failed');
			}
			const parsedProject = projectCreationResponseSchema.safeParse(
				await projectResponse.json().catch(() => null)
			);
			if (this.#projectSessionEpoch !== epoch) {
				throw new RequestProjectSessionError('project session request superseded');
			}
			if (!parsedProject.success) {
				throw new RequestProjectSessionError('project creation response invalid');
			}
			projectId = parsedProject.data.id;
			this.#pendingProjectId = projectId;
		}

		const sessionResponse = await fetch(`/api/projects/${projectId}/sessions`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({})
		});
		if (!sessionResponse.ok) {
			throw new RequestProjectSessionError('session creation failed');
		}
		const parsedSession = sessionCreationResponseSchema.safeParse(
			await sessionResponse.json().catch(() => null)
		);
		if (!parsedSession.success) {
			throw new RequestProjectSessionError('session creation response invalid');
		}
		if (this.#projectSessionEpoch !== epoch) {
			throw new RequestProjectSessionError('project session request superseded');
		}

		this.#pendingProjectId = undefined;
		this.setProjectSession(projectId, parsedSession.data.id);
		return { projectId, sessionId: parsedSession.data.id };
	}

	async toRenderRequest(): Promise<RenderRequest | null> {
		const validation = this.validate();
		if (!validation.valid) return null;
		// Captured before the upload/session calls below (both async), so the
		// settings attached to the request are what's on the form right now —
		// not whatever the user has since typed while those were in flight.
		const formSnapshot = this.captureFormSnapshot();
		const prompt = this.prompt;
		const outputFormat = this.outputFormat;
		const imageKey = await this.resolveWorkingImageKey();
		if (!imageKey) return null;
		const { sessionId } = await this.ensureProjectSession();
		return {
			imageKey,
			prompt,
			outputFormat,
			sessionId,
			formSnapshot
		};
	}

	async toStyleTransferRequest(): Promise<StyleTransferRequest | null> {
		const validation = this.validateStyleTransfer();
		if (!validation.valid) return null;
		const formSnapshot = this.captureFormSnapshot();
		const styleReferenceImage = this.styleReferenceImage;
		const outputFormat = this.outputFormat;
		const prompt = this.styleTransferPrompt.trim();
		const negativePrompt = this.styleNegativePrompt.trim();
		const styleTransferStrength = this.styleTransferStrength;
		const imageKey = await this.resolveWorkingImageKey();
		if (!imageKey || !styleReferenceImage) return null;
		const { sessionId } = await this.ensureProjectSession();
		return {
			imageKey,
			...('stylePresetId' in styleReferenceImage
				? { stylePresetId: styleReferenceImage.stylePresetId }
				: { referenceImageKey: styleReferenceImage.mediaKey }),
			outputFormat,
			...(prompt ? { prompt } : {}),
			...(negativePrompt ? { negativePrompt } : {}),
			styleTransferStrength,
			sessionId,
			formSnapshot
		};
	}

	async toObjectReplacementRequest(): Promise<ObjectReplacementRequest | null> {
		const validation = this.validateObjectReplacement();
		if (!validation.valid) return null;
		const formSnapshot = this.captureFormSnapshot('replace-object');
		const referenceImageKey = managedImageKey(this.objectReferenceImage);
		const replacementObject = this.objectReplacementInstruction;
		const imageKey = await this.resolveWorkingImageKey();
		if (!imageKey || !referenceImageKey) return null;
		const { sessionId } = await this.ensureProjectSession();
		return {
			imageKey,
			referenceImageKey,
			replacementObject,
			sessionId,
			formSnapshot
		};
	}

	async toTextureReplacementRequest(): Promise<TextureReplacementRequest | null> {
		const validation = this.validateTextureReplacement();
		if (!validation.valid) return null;
		const formSnapshot = this.captureFormSnapshot('change-surface-color');
		const referenceImageKey = managedImageKey(this.textureReferenceImage);
		const masked = this.textureReplacementMasked;
		const maskImageKey = managedImageKey(this.textureMaskImage);
		const maskMatchesSource = this.textureMaskMatchesSource();
		const replacementSurface = this.textureReplacementSurface.trim();
		const imageKey = await this.resolveWorkingImageKey();
		if (!imageKey || !referenceImageKey) return null;
		const { sessionId } = await this.ensureProjectSession();
		if (masked) {
			if (!maskImageKey || !maskMatchesSource) return null;
			return {
				imageKey,
				referenceImageKey,
				maskImageKey,
				sessionId,
				formSnapshot
			};
		}
		return {
			imageKey,
			referenceImageKey,
			replacementSurface,
			sessionId,
			formSnapshot
		};
	}

	async toLightSettingsRequest(): Promise<LightSettingsRequest | null> {
		const validation = this.validateLightSettings();
		if (!validation.valid) return null;
		const formSnapshot = this.captureFormSnapshot('light-settings');
		const instruction = this.lightSettingsPrompt.trim();
		const imageKey = await this.resolveWorkingImageKey();
		if (!imageKey) return null;
		const { sessionId } = await this.ensureProjectSession();
		return {
			imageKey,
			instruction,
			sessionId,
			formSnapshot
		};
	}

	toJSON(): RequestJSON {
		return {
			id: this.id,
			image: cloneImage(this.image),
			styleReferenceImage: cloneImage(this.styleReferenceImage),
			objectReferenceImage: cloneImage(this.objectReferenceImage),
			textureReferenceImage: cloneImage(this.textureReferenceImage),
			textureMaskImage: cloneImage(this.textureMaskImage),
			textureMaskSourceKey: this.textureMaskSourceKey,
			promptFragments: cloneFragments(this.promptFragments),
			editPrompt: this.editPrompt,
			addObjectPresetId: this.addObjectPresetId,
			removeObjectText: this.removeObjectText,
			outputFormat: this.outputFormat,
			sceneType: this.sceneType,
			styleTransferPrompt: this.styleTransferPrompt,
			styleTransferStrength: this.styleTransferStrength,
			styleNegativePrompt: this.styleNegativePrompt,
			objectReplacementObject: this.objectReplacementObject,
			objectReplacementScale: this.objectReplacementScale,
			textureReplacementSurface: this.textureReplacementSurface,
			textureReplacementMasked: this.textureReplacementMasked,
			lightSettingsPresetIds: [...this.lightSettingsPresetIds],
			lightSettingsInstruction: this.lightSettingsInstruction,
			promptOverride: this.promptOverride,
			currentRender: cloneRenderResult(this.currentRender),
			status: this.status
		};
	}

	fromJSON(data: unknown): void {
		const parsed = requestJsonSchema.parse(data);
		this.#textureMaskUploadEpoch += 1;
		this.textureMaskUploading = false;
		this.textureReplacementResultReady = false;
		this.id = parsed.id;
		this.image = cloneImage(parsed.image);
		this.pendingImageFile = undefined;
		this.#clearPendingImagePreview();
		this.styleReferenceImage = cloneImage(parsed.styleReferenceImage);
		this.objectReferenceImage = cloneImage(parsed.objectReferenceImage);
		this.textureReferenceImage = cloneImage(parsed.textureReferenceImage);
		this.textureMaskImage = cloneImage(parsed.textureMaskImage);
		this.textureMaskSourceKey = parsed.textureMaskImage ? parsed.textureMaskSourceKey : undefined;
		this.promptFragments = cloneFragments(parsed.promptFragments);
		this.editPrompt = parsed.editPrompt;
		this.addObjectPresetId = parsed.addObjectPresetId;
		this.removeObjectText = parsed.removeObjectText;
		this.outputFormat = parsed.outputFormat;
		this.sceneType = parsed.sceneType;
		this.styleTransferPrompt = parsed.styleTransferPrompt;
		this.styleTransferStrength = parsed.styleTransferStrength;
		this.styleNegativePrompt = parsed.styleNegativePrompt;
		this.objectReplacementObject = parsed.objectReplacementObject;
		this.objectReplacementScale = parsed.objectReplacementScale;
		this.activeObjectReplacementJob = undefined;
		this.textureReplacementSurface = parsed.textureReplacementSurface;
		this.textureReplacementMasked = parsed.textureReplacementMasked;
		this.activeTextureReplacementJob = undefined;
		this.lightSettingsPresetIds = [...parsed.lightSettingsPresetIds];
		this.lightSettingsInstruction = parsed.lightSettingsInstruction;
		this.activeLightSettingsJob = undefined;
		this.activeFluxKontextEditJob = undefined;
		this.promptOverride = parsed.promptOverride;
		const restoredRender = cloneRenderResult(parsed.currentRender);
		if (restoredRender) {
			this.#seedHistory(restoredRender);
		} else {
			this.#renderHistory = [];
			this.#historyIndex = -1;
		}
		this.status = parsed.status;
	}

	normalizeForComparison(): NormalizedRequest {
		return {
			image: cloneImage(this.image),
			styleReferenceImage: cloneImage(this.styleReferenceImage),
			objectReferenceImage: cloneImage(this.objectReferenceImage),
			textureReferenceImage: cloneImage(this.textureReferenceImage),
			textureMaskImage:
				this.textureReplacementMasked && this.textureMaskMatchesSource()
					? cloneImage(this.textureMaskImage)
					: undefined,
			promptFragments: cloneFragments(this.promptFragments),
			outputFormat: this.outputFormat,
			sceneType: this.sceneType,
			styleTransferStrength: this.styleTransferStrength,
			styleNegativePrompt: this.styleNegativePrompt,
			workingImageKey: this.workingImageKey(),
			objectReplacementObject: this.objectReplacementObject,
			objectReplacementScale: this.objectReplacementScale,
			textureReplacementSurface: this.textureReplacementMasked
				? ''
				: this.textureReplacementSurface,
			textureReplacementMasked: this.textureReplacementMasked,
			lightSettingsPresetIds: [...this.lightSettingsPresetIds],
			lightSettingsInstruction: this.lightSettingsInstruction,
			lightSettingsPrompt: this.lightSettingsPrompt,
			editPrompt: this.editPrompt,
			addObjectPresetId: this.addObjectPresetId,
			removeObjectText: this.removeObjectText,
			styleTransferPrompt: this.styleTransferPrompt,
			prompt: this.prompt
		};
	}

	reset(): void {
		this.#textureMaskUploadEpoch += 1;
		this.textureMaskUploading = false;
		this.textureReplacementResultReady = false;
		this.id = crypto.randomUUID();
		this.projectId = undefined;
		this.sessionId = undefined;
		this.viewingGenerationId = undefined;
		this.#pendingProjectId = undefined;
		this.#pendingProjectSession = undefined;
		this.#projectSessionEpoch += 1;
		this.#imageUploadEpoch += 1;
		this.#pendingUpload = undefined;
		this.image = undefined;
		this.pendingImageFile = undefined;
		this.#clearPendingImagePreview();
		this.styleReferenceImage = undefined;
		this.objectReferenceImage = undefined;
		this.textureReferenceImage = undefined;
		this.textureMaskImage = undefined;
		this.textureMaskSourceKey = undefined;
		this.promptFragments = [];
		this.editPrompt = '';
		this.addObjectPresetId = null;
		this.removeObjectText = '';
		this.outputFormat = 'webp';
		this.sceneType = 'interior';
		this.styleTransferPrompt = '';
		this.styleTransferStrength = 0.7;
		this.styleNegativePrompt = '';
		this.objectReplacementObject = '';
		this.objectReplacementScale = 1;
		this.activeObjectReplacementJob = undefined;
		this.textureReplacementSurface = '';
		this.textureReplacementMasked = false;
		this.activeTextureReplacementJob = undefined;
		this.lightSettingsPresetIds = [];
		this.lightSettingsInstruction = '';
		this.activeLightSettingsJob = undefined;
		this.activeFluxKontextEditJob = undefined;
		this.promptOverride = null;
		this.#renderHistory = [];
		this.#historyIndex = -1;
		this.status = 'idle';
	}

	// Lossless whole-state copy, used to freeze/thaw a workspace tab's data when
	// switching between open projects (see workspace-tabs.svelte.ts). Unlike
	// toJSON()/fromJSON() — which trim to the shareable-URL request model —
	// this copies every field, including session-UI-only ones, so a tab that
	// becomes inactive and later active again looks exactly as it was left.
	copyFrom(source: RequestState): void {
		// Any project/session creation, main-photo upload, or texture-mask
		// upload still in flight belongs to the pre-copy state — invalidate it
		// so a late resolution can't overwrite the state being copied in now
		// (same guard shape reset() uses).
		this.#pendingProjectId = undefined;
		this.#pendingProjectSession = undefined;
		this.#projectSessionEpoch += 1;
		this.#textureMaskUploadEpoch += 1;
		this.#imageUploadEpoch += 1;
		this.#pendingUpload = undefined;

		this.id = source.id;
		this.projectId = source.projectId;
		this.sessionId = source.sessionId;
		this.viewingGenerationId = source.viewingGenerationId;
		// image/pendingImageFile are mutually exclusive on any well-formed
		// instance (setImage/setPendingImage each clear the other). Routing
		// through setPendingImage() here — rather than copying
		// pendingImagePreviewUrl's blob: URL string verbatim — means each
		// instance owns and revokes its own preview, so one tab's later
		// revoke (from a subsequent copyFrom into it) can't invalidate a blob
		// URL another tab is still holding onto.
		if (source.pendingImageFile) {
			this.setPendingImage(source.pendingImageFile);
		} else {
			this.#clearPendingImagePreview();
			this.pendingImageFile = undefined;
			this.image = cloneImage(source.image);
		}
		this.styleReferenceImage = cloneImage(source.styleReferenceImage);
		this.objectReferenceImage = cloneImage(source.objectReferenceImage);
		this.textureReferenceImage = cloneImage(source.textureReferenceImage);
		this.textureMaskImage = cloneImage(source.textureMaskImage);
		this.textureMaskSourceKey = source.textureMaskSourceKey;
		this.promptFragments = cloneFragments(source.promptFragments);
		this.editPrompt = source.editPrompt;
		this.addObjectPresetId = source.addObjectPresetId;
		this.removeObjectText = source.removeObjectText;
		this.activeFluxKontextEditJob = cloneActiveFluxKontextEditJob(source.activeFluxKontextEditJob);
		this.outputFormat = source.outputFormat;
		this.sceneType = source.sceneType;
		this.styleTransferPrompt = source.styleTransferPrompt;
		this.styleTransferStrength = source.styleTransferStrength;
		this.styleNegativePrompt = source.styleNegativePrompt;
		this.objectReplacementObject = source.objectReplacementObject;
		this.objectReplacementScale = source.objectReplacementScale;
		this.activeObjectReplacementJob = cloneActiveObjectReplacementJob(
			source.activeObjectReplacementJob
		);
		this.textureReplacementSurface = source.textureReplacementSurface;
		this.textureReplacementMasked = source.textureReplacementMasked;
		this.textureMaskUploading = source.textureMaskUploading;
		this.activeTextureReplacementJob = cloneActiveTextureReplacementJob(
			source.activeTextureReplacementJob
		);
		this.textureReplacementResultReady = source.textureReplacementResultReady;
		this.lightSettingsPresetIds = [...source.lightSettingsPresetIds];
		this.lightSettingsInstruction = source.lightSettingsInstruction;
		this.activeLightSettingsJob = cloneActiveLightSettingsJob(source.activeLightSettingsJob);
		this.promptOverride = source.promptOverride;
		// currentRender/previousRender are derived from the history stack, not
		// settable fields — copy the stack itself (deep-cloned, so neither
		// instance's later edits alias the other's) to preserve full undo/redo
		// navigability across the swap, not just the current step.
		this.#renderHistory = source.#renderHistory.map((render) => cloneRenderResult(render));
		this.#historyIndex = source.#historyIndex;
		this.status = source.status;
	}
}

export const request = new RequestState();
