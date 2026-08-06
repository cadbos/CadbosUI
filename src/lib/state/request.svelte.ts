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
	OUTPUT_FORMATS,
	type ObjectReplacementRequest,
	type OutputFormat,
	type RenderRequest,
	type RenderResponse,
	type StyleTransferRequest,
	type TextureReplacementRequest,
	uploadResultSchema
} from '$lib/api/contract';
import type { TranslationKey } from '$lib/i18n/index.svelte';

export type { OutputFormat };

export const SCENE_TYPES = ['interior', 'exterior'] as const;

export type SceneType = (typeof SCENE_TYPES)[number];

export interface ImageInput {
	url: string;
	mime?: string;
	size?: number;
	hash?: string;
	dimensions?: [number, number];
}

export interface PromptFragment {
	id: string;
	label?: string;
	text: string;
	order: number;
}

export const EDIT_OPERATION_TYPES = [
	'replace-object',
	'change-surface-color',
	'freeform',
	'add-object',
	'remove-object',
	'atmosphere',
	'upscale'
] as const;

export type EditOperationType = (typeof EDIT_OPERATION_TYPES)[number];

export interface EditOperation {
	type: EditOperationType;
	instruction: string;
}

export interface RenderResult {
	id: string;
	outputUrls: string[];
	cost: number;
	balance: number;
	parentId?: string;
	editOp?: EditOperation;
	ts: number;
}

export interface ActiveObjectReplacementJob {
	id: string;
	instruction: string;
	sourceRender?: RenderResult;
}

export interface ActiveTextureReplacementJob {
	id: string;
	instruction: string;
	sourceRender?: RenderResult;
}

export interface TextureMaskUploadOperation {
	epoch: number;
	sourceUrl: string;
}

export type RequestStatus = 'idle' | 'rendering' | 'error';

export const IMAGE_SOURCE_MODES = ['room-photo', 'current-result'] as const;
export type ImageSourceMode = (typeof IMAGE_SOURCE_MODES)[number];

export type ValidationField =
	| 'prompt'
	| 'image'
	| 'referenceImage'
	| 'mask'
	| 'replacementObject'
	| 'replacementSurface';

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
	textureMaskSourceUrl?: string;
	promptFragments: PromptFragment[];
	editPrompt: string;
	outputFormat: OutputFormat;
	sceneType: SceneType;
	styleTransferPrompt: string;
	styleTransferStrength: number;
	styleNegativePrompt: string;
	styleSourceMode: ImageSourceMode;
	objectReplacementObject?: string;
	objectReplacementSourceMode?: ImageSourceMode;
	textureReplacementSurface?: string;
	textureReplacementSourceMode?: ImageSourceMode;
	textureReplacementMasked?: boolean;
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
	styleSourceMode: ImageSourceMode;
	// The URL request builders actually send (image?.url, or — in
	// current-result mode — currentRender's own output). Comparing raw
	// `image` alone can't tell two states with different current renders
	// apart when both use current-result mode, even though they'd submit
	// different request bodies.
	styleTransferSourceUrl: string | undefined;
	objectReplacementObject: string;
	objectReplacementSourceMode: ImageSourceMode;
	objectReplacementSourceUrl: string | undefined;
	textureReplacementSurface: string;
	textureReplacementSourceMode: ImageSourceMode;
	textureReplacementSourceUrl: string | undefined;
	textureReplacementMasked: boolean;
	editPrompt: string;
	styleTransferPrompt: string;
	prompt: string;
}

const outputFormatSchema = z.enum(OUTPUT_FORMATS);
const sceneTypeSchema = z.enum(SCENE_TYPES);
const imageSourceModeSchema = z.enum(IMAGE_SOURCE_MODES);
const styleTransferStrengthSchema = z.number().min(0).max(1);
const replacementObjectSchema = z.string().max(200);
export const objectReplacementJobIdSchema = z.uuid();
const replacementSurfaceSchema = z.string().max(200);
const textureReplacementJobIdSchema = z.uuid();

const imageInputSchema = z.object({
	url: z.string().trim().url(),
	mime: z.string().min(1).optional(),
	size: z.number().nonnegative().optional(),
	hash: z.string().min(1).optional(),
	dimensions: z.tuple([z.number().positive(), z.number().positive()]).optional()
});
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

const renderResultSchema = z.object({
	id: z.string().min(1),
	outputUrls: z.array(z.string().min(1)).min(1),
	cost: z.number(),
	balance: z.number(),
	parentId: z.string().optional(),
	editOp: editOperationSchema.optional(),
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
		textureMaskSourceUrl: z.string().min(1).optional(),
		promptFragments: z.array(promptFragmentSchema),
		editPrompt: z.string().default(''),
		outputFormat: outputFormatSchema,
		// Defaults to interior for persisted requests saved before this field existed.
		sceneType: sceneTypeSchema.default('interior'),
		styleTransferPrompt: z.string().default(''),
		styleTransferStrength: styleTransferStrengthSchema.default(0.7),
		styleNegativePrompt: z.string().default(''),
		styleSourceMode: imageSourceModeSchema.default('current-result'),
		objectReplacementObject: replacementObjectSchema.default(''),
		objectReplacementSourceMode: imageSourceModeSchema.default('current-result'),
		textureReplacementSurface: replacementSurfaceSchema.default(''),
		textureReplacementSourceMode: imageSourceModeSchema.default('current-result'),
		textureReplacementMasked: z.boolean().default(false),
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
	return {
		url: image.url,
		...(image.mime !== undefined ? { mime: image.mime } : {}),
		...(image.size !== undefined ? { size: image.size } : {}),
		...(image.hash !== undefined ? { hash: image.hash } : {}),
		...(image.dimensions ? { dimensions: [...image.dimensions] } : {})
	};
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

function cloneRenderResult(render: RenderResult | undefined): RenderResult | undefined {
	if (!render) return undefined;
	return {
		id: render.id,
		outputUrls: [...render.outputUrls],
		cost: render.cost,
		balance: render.balance,
		...(render.parentId !== undefined ? { parentId: render.parentId } : {}),
		...(render.editOp ? { editOp: cloneEditOperation(render.editOp) } : {}),
		ts: render.ts
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
		id: crypto.randomUUID(),
		outputUrls: [response.outputUrl],
		cost: response.cost,
		balance: response.balance,
		parentId: opts?.parentId,
		editOp: opts?.editOp,
		ts: Date.now()
	};
}

const apiErrorSchema = z.object({ error: z.object({ code: z.string(), message: z.string() }) });

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
	id = $state<string>(crypto.randomUUID());
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
	// mounts a fresh one per mode) and so #sourceUrlFor can offer it to
	// preview-only consumers (e.g. the mask editor) before the real upload
	// happens. Session UI state only, same as pendingImageFile above.
	pendingImagePreviewUrl = $state<string | undefined>(undefined);
	styleReferenceImage = $state<ImageInput | undefined>(undefined);
	objectReferenceImage = $state<ImageInput | undefined>(undefined);
	textureReferenceImage = $state<ImageInput | undefined>(undefined);
	textureMaskImage = $state<ImageInput | undefined>(undefined);
	textureMaskSourceUrl = $state<string | undefined>(undefined);
	promptFragments = $state<PromptFragment[]>([]);
	editPrompt = $state('');
	outputFormat = $state<OutputFormat>('webp');
	sceneType = $state<SceneType>('interior');
	styleTransferPrompt = $state('');
	styleTransferStrength = $state(0.7);
	styleNegativePrompt = $state('');
	styleSourceMode = $state<ImageSourceMode>('current-result');
	objectReplacementObject = $state('');
	objectReplacementSourceMode = $state<ImageSourceMode>('current-result');
	activeObjectReplacementJob = $state<ActiveObjectReplacementJob | undefined>(undefined);
	textureReplacementSurface = $state('');
	textureReplacementSourceMode = $state<ImageSourceMode>('current-result');
	textureReplacementMasked = $state(false);
	textureMaskUploading = $state(false);
	activeTextureReplacementJob = $state<ActiveTextureReplacementJob | undefined>(undefined);
	// Whether the currently displayed render is already the resolved result of a
	// masked texture-replacement submission — Workspace.svelte reads this to know
	// when to swap the canvas from the mask-drawing surface back to the render
	// result. Session UI state (not part of toJSON()/fromJSON()), same as
	// textureMaskUploading above.
	textureReplacementResultReady = $state(false);
	promptOverride = $state<string | null>(null);
	currentRender = $state<RenderResult | undefined>(undefined);
	// Single-step undo/redo for the last edit (FR-К6) — in-session only, deliberately
	// not part of toJSON()/fromJSON(): it's session UI state, not the request model.
	// A symmetric one-step pair, not a full revision history/tree (still out of MVP
	// scope per Д-16) — undoneRender only ever holds the one render undo just left.
	previousRender = $state<RenderResult | undefined>(undefined);
	undoneRender = $state<RenderResult | undefined>(undefined);
	status = $state<RequestStatus>('idle');

	prompt = $derived.by(() => derivePrompt(this.promptOverride, this.promptFragments));

	get canSubmit(): boolean {
		return this.validate().valid && this.status === 'idle';
	}

	get canUndoEdit(): boolean {
		return this.previousRender !== undefined;
	}

	get canRedoEdit(): boolean {
		return this.undoneRender !== undefined;
	}

	get activeObjectReplacementJobId(): string | undefined {
		return this.activeObjectReplacementJob?.id;
	}

	get activeTextureReplacementJobId(): string | undefined {
		return this.activeTextureReplacementJob?.id;
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
			this.textureMaskSourceUrl = undefined;
			return;
		}
		const sourceUrl = this.textureReplacementSourceUrl();
		if (!sourceUrl) return;
		this.textureMaskImage = cloneImage(optionalImageInputSchema.parse(image));
		this.textureMaskSourceUrl = sourceUrl;
	}

	beginTextureMaskUpload(): TextureMaskUploadOperation | null {
		const sourceUrl = this.textureReplacementSourceUrl();
		if (!sourceUrl || !this.textureReplacementMasked) return null;
		this.#textureMaskUploadEpoch += 1;
		this.textureMaskUploading = true;
		return { epoch: this.#textureMaskUploadEpoch, sourceUrl };
	}

	commitTextureMaskUpload(image: ImageInput, operation: TextureMaskUploadOperation): boolean {
		if (
			!this.textureReplacementMasked ||
			operation.epoch !== this.#textureMaskUploadEpoch ||
			operation.sourceUrl !== this.textureReplacementSourceUrl()
		) {
			return false;
		}
		this.textureMaskImage = cloneImage(optionalImageInputSchema.parse(image));
		this.textureMaskSourceUrl = operation.sourceUrl;
		this.textureMaskUploading = false;
		return true;
	}

	finishTextureMaskUpload(operation: TextureMaskUploadOperation): void {
		if (operation.epoch === this.#textureMaskUploadEpoch) this.textureMaskUploading = false;
	}

	textureMaskMatchesSource(): boolean {
		return (
			this.textureMaskImage?.url !== undefined &&
			this.textureMaskSourceUrl === this.textureReplacementSourceUrl()
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

	setStyleSourceMode(mode: ImageSourceMode): void {
		this.styleSourceMode = imageSourceModeSchema.parse(mode);
	}

	setObjectReplacementObject(object: string): void {
		this.objectReplacementObject = replacementObjectSchema.parse(object);
	}

	setObjectReplacementSourceMode(mode: ImageSourceMode): void {
		this.objectReplacementSourceMode = imageSourceModeSchema.parse(mode);
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
			sourceRender: cloneRenderResult(sourceRender)
		};
	}

	setTextureReplacementSurface(surface: string): void {
		this.textureReplacementSurface = replacementSurfaceSchema.parse(surface);
	}

	setTextureReplacementSourceMode(mode: ImageSourceMode): void {
		this.textureReplacementSourceMode = imageSourceModeSchema.parse(mode);
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
			sourceRender: cloneRenderResult(sourceRender)
		};
	}

	setPromptOverride(text: string): void {
		this.promptOverride = text;
	}

	clearPromptOverride(): void {
		this.promptOverride = null;
	}

	// A fresh generation (not an edit) starts a new edit chain — any pending
	// undo/redo from a previous chain no longer applies.
	setCurrentRender(render: RenderResult | undefined): void {
		this.currentRender = cloneRenderResult(render);
		this.previousRender = undefined;
		this.undoneRender = undefined;
	}

	// Applies the result of an edit (FR-К4): the prior currentRender becomes the
	// one-step undo target (FR-К6), and the edit result becomes current. A new
	// edit invalidates any pending redo — it's a new branch, not a continuation
	// of whatever was just undone.
	applyEditResult(
		render: RenderResult,
		sourceRender: RenderResult | undefined = this.currentRender
	): void {
		this.previousRender = cloneRenderResult(sourceRender);
		this.currentRender = cloneRenderResult(render);
		this.undoneRender = undefined;
	}

	// Rolls back to the render before the last edit (FR-К6). No-op if there's
	// nothing to undo. Keeps the render it left as the one-step redo target.
	undoLastEdit(): void {
		if (this.previousRender === undefined) return;
		this.undoneRender = cloneRenderResult(this.currentRender);
		this.currentRender = cloneRenderResult(this.previousRender);
		this.previousRender = undefined;
	}

	// Re-applies the edit that undoLastEdit() just reverted. No-op if there's
	// nothing to redo.
	redoEdit(): void {
		if (this.undoneRender === undefined) return;
		this.previousRender = cloneRenderResult(this.currentRender);
		this.currentRender = cloneRenderResult(this.undoneRender);
		this.undoneRender = undefined;
	}

	setStatus(status: RequestStatus): void {
		this.status = status;
	}

	validate(): ValidationResult {
		const missing: ValidationField[] = [];
		if (!this.image?.url && !this.pendingImageFile) missing.push('image');
		return { valid: missing.length === 0, missing };
	}

	validateStyleTransfer(): ValidationResult {
		const missing: ValidationField[] = [];
		if (!this.hasStyleTransferSource()) missing.push('image');
		if (!this.styleReferenceImage?.url) missing.push('referenceImage');
		return { valid: missing.length === 0, missing };
	}

	validateObjectReplacement(): ValidationResult {
		const missing: ValidationField[] = [];
		if (!this.hasObjectReplacementSource()) missing.push('image');
		if (!this.objectReferenceImage?.url) missing.push('referenceImage');
		if (!this.objectReplacementObject.trim()) missing.push('replacementObject');
		return { valid: missing.length === 0, missing };
	}

	validateTextureReplacement(): ValidationResult {
		const missing: ValidationField[] = [];
		if (!this.hasTextureReplacementSource()) missing.push('image');
		if (!this.textureReferenceImage?.url) missing.push('referenceImage');
		if (this.textureReplacementMasked) {
			if (!this.textureMaskMatchesSource()) missing.push('mask');
		} else if (!this.textureReplacementSurface.trim()) {
			missing.push('replacementSurface');
		}
		return { valid: missing.length === 0, missing };
	}

	#sourceUrlFor(mode: ImageSourceMode): string | undefined {
		if (mode === 'current-result') {
			return this.currentRender?.outputUrls[0] ?? this.image?.url ?? this.pendingImagePreviewUrl;
		}
		return this.image?.url ?? this.pendingImagePreviewUrl;
	}

	// Sync "is there something to submit" check for button-enabled validation —
	// a pending, not-yet-uploaded file already counts (the actual upload is
	// deferred, not skipped: #ensureImageUploaded() guarantees it runs before
	// the request is sent). Used by validateStyleTransfer()/etc.; do not use
	// this for building request bodies — see #resolveSourceFor.
	#hasSourceFor(mode: ImageSourceMode): boolean {
		if (mode === 'current-result') {
			return (
				this.currentRender !== undefined ||
				this.image !== undefined ||
				this.pendingImageFile !== undefined
			);
		}
		return this.image !== undefined || this.pendingImageFile !== undefined;
	}

	// Resolves the actual URL (and, when it came from a fresh upload, its
	// content hash) for the outgoing request body. Triggers the deferred main-
	// photo upload the first time it's needed — see #ensureImageUploaded().
	async #resolveSourceFor(
		mode: ImageSourceMode
	): Promise<{ url: string; hash?: string } | undefined> {
		if (mode === 'current-result' && this.currentRender) {
			return { url: this.currentRender.outputUrls[0] };
		}
		const image = await this.#ensureImageUploaded();
		return image ? { url: image.url, hash: image.hash } : undefined;
	}

	// Uploads the pending main photo the first time a generate call actually
	// needs its resolved URL, then caches the result on `image` (via
	// setImage) so a second generate call in the same session — e.g.
	// re-generating with a tweaked prompt — reuses it instead of re-uploading.
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
		let uploaded: ImageInput;
		try {
			const formData = new FormData();
			formData.append('file', file);
			const response = await fetch('/api/uploads', { method: 'POST', body: formData });
			if (!response.ok) throw new RequestImageUploadError('upload request failed');
			const parsed = uploadResultSchema.safeParse(await response.json().catch(() => null));
			if (!parsed.success) throw new RequestImageUploadError('upload response invalid');
			uploaded = {
				url: parsed.data.url,
				mime: parsed.data.mime,
				size: parsed.data.size,
				hash: parsed.data.hash,
				...(parsed.data.dimensions ? { dimensions: parsed.data.dimensions } : {})
			};
		} catch (error) {
			if (error instanceof RequestImageUploadError) throw error;
			throw new RequestImageUploadError('upload failed', { cause: error });
		}

		this.setImage(uploaded);
		return this.image;
	}

	hasStyleTransferSource(): boolean {
		return this.#hasSourceFor(this.styleSourceMode);
	}

	hasObjectReplacementSource(): boolean {
		return this.#hasSourceFor(this.objectReplacementSourceMode);
	}

	hasTextureReplacementSource(): boolean {
		return this.#hasSourceFor(this.textureReplacementSourceMode);
	}

	// The mask editor draws on, and later validates the finished mask against
	// (textureMaskMatchesSource()), a stable server URL — a local blob:
	// preview isn't enough for that. Workspace.svelte calls this eagerly the
	// moment masked mode is entered, so the deferred main-photo upload
	// resolves before the user starts drawing instead of waiting for submit.
	async ensureTextureReplacementSourceUploaded(): Promise<void> {
		await this.#resolveSourceFor(this.textureReplacementSourceMode);
	}

	// Sync "best guess" URL for preview/display purposes only (e.g. the mask
	// editor's canvas source) — falls back to the pending file's local blob:
	// preview when nothing has actually been uploaded yet (same origin, so
	// it's safe to draw into a canvas). Do not use these for building request
	// bodies — that's what #resolveSourceFor is for, since a blob: URL isn't
	// resolvable by the server.
	styleTransferSourceUrl(): string | undefined {
		return this.#sourceUrlFor(this.styleSourceMode);
	}

	objectReplacementSourceUrl(): string | undefined {
		return this.#sourceUrlFor(this.objectReplacementSourceMode);
	}

	textureReplacementSourceUrl(): string | undefined {
		return this.#sourceUrlFor(this.textureReplacementSourceMode);
	}

	// Edit tools (EditPanel.svelte: freeform/add-object/remove-object/
	// atmosphere) target the latest render/edit result once one exists;
	// before that, they fall back to the room photo — same 'current-result'
	// semantics as the other tools' source mode, just without a toggle since
	// Edit has no separate room-photo/current-result choice to make.
	hasEditSource(): boolean {
		return this.#hasSourceFor('current-result');
	}

	async resolveEditSource(): Promise<{ url: string; hash?: string } | undefined> {
		return this.#resolveSourceFor('current-result');
	}

	async toRenderRequest(): Promise<RenderRequest | null> {
		const validation = this.validate();
		if (!validation.valid) return null;
		const image = await this.#ensureImageUploaded();
		if (!image) return null;
		return {
			image: image.url,
			...(image.hash ? { imageHash: image.hash } : {}),
			prompt: this.prompt,
			outputFormat: this.outputFormat
		};
	}

	async toStyleTransferRequest(): Promise<StyleTransferRequest | null> {
		const validation = this.validateStyleTransfer();
		if (!validation.valid) return null;
		const source = await this.#resolveSourceFor(this.styleSourceMode);
		if (!source || !this.styleReferenceImage) return null;
		const prompt = this.styleTransferPrompt.trim();
		const negativePrompt = this.styleNegativePrompt.trim();
		return {
			image: source.url,
			...(source.hash ? { imageHash: source.hash } : {}),
			referenceImage: this.styleReferenceImage.url,
			outputFormat: this.outputFormat,
			...(prompt ? { prompt } : {}),
			...(negativePrompt ? { negativePrompt } : {}),
			styleTransferStrength: this.styleTransferStrength
		};
	}

	async toObjectReplacementRequest(): Promise<ObjectReplacementRequest | null> {
		const validation = this.validateObjectReplacement();
		if (!validation.valid) return null;
		const source = await this.#resolveSourceFor(this.objectReplacementSourceMode);
		if (!source || !this.objectReferenceImage) return null;
		return {
			image: source.url,
			...(source.hash ? { imageHash: source.hash } : {}),
			referenceImage: this.objectReferenceImage.url,
			replacementObject: this.objectReplacementObject.trim()
		};
	}

	async toTextureReplacementRequest(): Promise<TextureReplacementRequest | null> {
		const validation = this.validateTextureReplacement();
		if (!validation.valid) return null;
		const source = await this.#resolveSourceFor(this.textureReplacementSourceMode);
		if (!source || !this.textureReferenceImage) return null;
		if (this.textureReplacementMasked) {
			if (!this.textureMaskImage || !this.textureMaskMatchesSource()) return null;
			return {
				image: source.url,
				...(source.hash ? { imageHash: source.hash } : {}),
				referenceImage: this.textureReferenceImage.url,
				mask: this.textureMaskImage.url
			};
		}
		return {
			image: source.url,
			...(source.hash ? { imageHash: source.hash } : {}),
			referenceImage: this.textureReferenceImage.url,
			replacementSurface: this.textureReplacementSurface.trim()
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
			textureMaskSourceUrl: this.textureMaskSourceUrl,
			promptFragments: cloneFragments(this.promptFragments),
			editPrompt: this.editPrompt,
			outputFormat: this.outputFormat,
			sceneType: this.sceneType,
			styleTransferPrompt: this.styleTransferPrompt,
			styleTransferStrength: this.styleTransferStrength,
			styleNegativePrompt: this.styleNegativePrompt,
			styleSourceMode: this.styleSourceMode,
			objectReplacementObject: this.objectReplacementObject,
			objectReplacementSourceMode: this.objectReplacementSourceMode,
			textureReplacementSurface: this.textureReplacementSurface,
			textureReplacementSourceMode: this.textureReplacementSourceMode,
			textureReplacementMasked: this.textureReplacementMasked,
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
		this.textureMaskSourceUrl = parsed.textureMaskImage ? parsed.textureMaskSourceUrl : undefined;
		this.promptFragments = cloneFragments(parsed.promptFragments);
		this.editPrompt = parsed.editPrompt;
		this.outputFormat = parsed.outputFormat;
		this.sceneType = parsed.sceneType;
		this.styleTransferPrompt = parsed.styleTransferPrompt;
		this.styleTransferStrength = parsed.styleTransferStrength;
		this.styleNegativePrompt = parsed.styleNegativePrompt;
		this.styleSourceMode = parsed.styleSourceMode;
		this.objectReplacementObject = parsed.objectReplacementObject;
		this.objectReplacementSourceMode = parsed.objectReplacementSourceMode;
		this.activeObjectReplacementJob = undefined;
		this.textureReplacementSurface = parsed.textureReplacementSurface;
		this.textureReplacementSourceMode = parsed.textureReplacementSourceMode;
		this.textureReplacementMasked = parsed.textureReplacementMasked;
		this.activeTextureReplacementJob = undefined;
		this.promptOverride = parsed.promptOverride;
		this.currentRender = cloneRenderResult(parsed.currentRender);
		this.status = parsed.status;
		this.previousRender = undefined;
		this.undoneRender = undefined;
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
			styleSourceMode: this.styleSourceMode,
			styleTransferSourceUrl: this.styleTransferSourceUrl(),
			objectReplacementObject: this.objectReplacementObject,
			objectReplacementSourceMode: this.objectReplacementSourceMode,
			objectReplacementSourceUrl: this.objectReplacementSourceUrl(),
			textureReplacementSurface: this.textureReplacementMasked
				? ''
				: this.textureReplacementSurface,
			textureReplacementSourceMode: this.textureReplacementSourceMode,
			textureReplacementSourceUrl: this.textureReplacementSourceUrl(),
			textureReplacementMasked: this.textureReplacementMasked,
			editPrompt: this.editPrompt,
			styleTransferPrompt: this.styleTransferPrompt,
			prompt: this.prompt
		};
	}

	reset(): void {
		this.#textureMaskUploadEpoch += 1;
		this.textureMaskUploading = false;
		this.textureReplacementResultReady = false;
		this.id = crypto.randomUUID();
		this.image = undefined;
		this.pendingImageFile = undefined;
		this.#clearPendingImagePreview();
		this.styleReferenceImage = undefined;
		this.objectReferenceImage = undefined;
		this.textureReferenceImage = undefined;
		this.textureMaskImage = undefined;
		this.textureMaskSourceUrl = undefined;
		this.promptFragments = [];
		this.editPrompt = '';
		this.outputFormat = 'webp';
		this.sceneType = 'interior';
		this.styleTransferPrompt = '';
		this.styleTransferStrength = 0.7;
		this.styleNegativePrompt = '';
		this.styleSourceMode = 'current-result';
		this.objectReplacementObject = '';
		this.objectReplacementSourceMode = 'current-result';
		this.activeObjectReplacementJob = undefined;
		this.textureReplacementSurface = '';
		this.textureReplacementSourceMode = 'current-result';
		this.textureReplacementMasked = false;
		this.activeTextureReplacementJob = undefined;
		this.promptOverride = null;
		this.currentRender = undefined;
		this.previousRender = undefined;
		this.undoneRender = undefined;
		this.status = 'idle';
	}
}

export const request = new RequestState();
