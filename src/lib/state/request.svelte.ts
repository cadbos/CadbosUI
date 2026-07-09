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
	type OutputFormat,
	type RenderRequest,
	type RenderResponse,
	type StyleTransferRequest
} from '$lib/api/contract';
import type { TranslationKey } from '$lib/i18n/index.svelte';

export type { OutputFormat };

export const SCENE_TYPES = ['interior', 'exterior'] as const;

export type SceneType = (typeof SCENE_TYPES)[number];

export interface ImageInput {
	url: string;
	mime?: string;
	size?: number;
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

export type RequestStatus = 'idle' | 'rendering' | 'error';

export const STYLE_SOURCE_MODES = ['room-photo', 'current-result'] as const;
export type StyleSourceMode = (typeof STYLE_SOURCE_MODES)[number];

export type ValidationField = 'prompt' | 'image' | 'referenceImage';

export interface ValidationResult {
	valid: boolean;
	missing: ValidationField[];
}

export interface RequestJSON {
	id: string;
	image?: ImageInput;
	styleReferenceImage?: ImageInput;
	promptFragments: PromptFragment[];
	outputFormat: OutputFormat;
	sceneType: SceneType;
	styleTransferStrength: number;
	styleNegativePrompt: string;
	styleSourceMode: StyleSourceMode;
	promptOverride: string | null;
	currentRender?: RenderResult;
	status: RequestStatus;
}

export interface NormalizedRequest {
	image?: ImageInput;
	styleReferenceImage?: ImageInput;
	promptFragments: PromptFragment[];
	outputFormat: OutputFormat;
	sceneType: SceneType;
	styleTransferStrength: number;
	styleNegativePrompt: string;
	styleSourceMode: StyleSourceMode;
	prompt: string;
}

const outputFormatSchema = z.enum(OUTPUT_FORMATS);
const sceneTypeSchema = z.enum(SCENE_TYPES);
const styleSourceModeSchema = z.enum(STYLE_SOURCE_MODES);
const styleTransferStrengthSchema = z.number().min(0).max(1);

const imageInputSchema = z.object({
	url: z.string().trim().url(),
	mime: z.string().min(1).optional(),
	size: z.number().nonnegative().optional(),
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
		promptFragments: z.array(promptFragmentSchema),
		outputFormat: outputFormatSchema,
		// Defaults to interior for persisted requests saved before this field existed.
		sceneType: sceneTypeSchema.default('interior'),
		styleTransferStrength: styleTransferStrengthSchema.default(0.7),
		styleNegativePrompt: z.string().default(''),
		styleSourceMode: styleSourceModeSchema.default('current-result'),
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

class RequestState {
	id = $state<string>(crypto.randomUUID());
	image = $state<ImageInput | undefined>(undefined);
	styleReferenceImage = $state<ImageInput | undefined>(undefined);
	promptFragments = $state<PromptFragment[]>([]);
	outputFormat = $state<OutputFormat>('webp');
	sceneType = $state<SceneType>('interior');
	styleTransferStrength = $state(0.7);
	styleNegativePrompt = $state('');
	styleSourceMode = $state<StyleSourceMode>('current-result');
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

	reorder(orderedIds: string[]): void {
		if (orderedIds.length !== this.promptFragments.length) {
			throw new RequestReorderError('orderedIds must include every fragment exactly once');
		}
		if (orderedIds.some((id, index) => orderedIds.indexOf(id) !== index)) {
			throw new RequestReorderError('orderedIds must include every fragment exactly once');
		}
		const byId = new Map(this.promptFragments.map((fragment) => [fragment.id, fragment]));
		if (orderedIds.some((id) => !byId.has(id))) {
			throw new RequestReorderError('orderedIds contains unknown fragment id');
		}
		this.promptFragments = orderedIds.map((id, order) => ({ ...byId.get(id)!, order }));
	}

	setImage(image: ImageInput | undefined): void {
		this.image = cloneImage(optionalImageInputSchema.parse(image));
	}

	setStyleReferenceImage(image: ImageInput | undefined): void {
		this.styleReferenceImage = cloneImage(optionalImageInputSchema.parse(image));
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

	setStyleSourceMode(mode: StyleSourceMode): void {
		this.styleSourceMode = styleSourceModeSchema.parse(mode);
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
	applyEditResult(render: RenderResult): void {
		this.previousRender = cloneRenderResult(this.currentRender);
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
		if (!this.image?.url) missing.push('image');
		return { valid: missing.length === 0, missing };
	}

	validateStyleTransfer(): ValidationResult {
		const missing: ValidationField[] = [];
		if (!this.styleTransferSourceUrl()) missing.push('image');
		if (!this.styleReferenceImage?.url) missing.push('referenceImage');
		return { valid: missing.length === 0, missing };
	}

	styleTransferSourceUrl(): string | undefined {
		if (this.styleSourceMode === 'current-result') {
			return this.currentRender?.outputUrls[0] ?? this.image?.url;
		}
		return this.image?.url;
	}

	toRenderRequest(): RenderRequest | null {
		const validation = this.validate();
		if (!validation.valid || !this.image) return null;
		return {
			image: this.image.url,
			prompt: this.prompt,
			outputFormat: this.outputFormat
		};
	}

	toStyleTransferRequest(guidance: string): StyleTransferRequest | null {
		const validation = this.validateStyleTransfer();
		const image = this.styleTransferSourceUrl();
		if (!validation.valid || !image || !this.styleReferenceImage) return null;
		const prompt = guidance.trim();
		const negativePrompt = this.styleNegativePrompt.trim();
		return {
			image,
			referenceImage: this.styleReferenceImage.url,
			outputFormat: this.outputFormat,
			...(prompt ? { prompt } : {}),
			...(negativePrompt ? { negativePrompt } : {}),
			styleTransferStrength: this.styleTransferStrength
		};
	}

	toJSON(): RequestJSON {
		return {
			id: this.id,
			image: cloneImage(this.image),
			styleReferenceImage: cloneImage(this.styleReferenceImage),
			promptFragments: cloneFragments(this.promptFragments),
			outputFormat: this.outputFormat,
			sceneType: this.sceneType,
			styleTransferStrength: this.styleTransferStrength,
			styleNegativePrompt: this.styleNegativePrompt,
			styleSourceMode: this.styleSourceMode,
			promptOverride: this.promptOverride,
			currentRender: cloneRenderResult(this.currentRender),
			status: this.status
		};
	}

	fromJSON(data: unknown): void {
		const parsed = requestJsonSchema.parse(data);
		this.id = parsed.id;
		this.image = cloneImage(parsed.image);
		this.styleReferenceImage = cloneImage(parsed.styleReferenceImage);
		this.promptFragments = cloneFragments(parsed.promptFragments);
		this.outputFormat = parsed.outputFormat;
		this.sceneType = parsed.sceneType;
		this.styleTransferStrength = parsed.styleTransferStrength;
		this.styleNegativePrompt = parsed.styleNegativePrompt;
		this.styleSourceMode = parsed.styleSourceMode;
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
			promptFragments: cloneFragments(this.promptFragments),
			outputFormat: this.outputFormat,
			sceneType: this.sceneType,
			styleTransferStrength: this.styleTransferStrength,
			styleNegativePrompt: this.styleNegativePrompt,
			styleSourceMode: this.styleSourceMode,
			prompt: this.prompt
		};
	}

	reset(): void {
		this.id = crypto.randomUUID();
		this.image = undefined;
		this.styleReferenceImage = undefined;
		this.promptFragments = [];
		this.outputFormat = 'webp';
		this.sceneType = 'interior';
		this.styleTransferStrength = 0.7;
		this.styleNegativePrompt = '';
		this.styleSourceMode = 'current-result';
		this.promptOverride = null;
		this.currentRender = undefined;
		this.previousRender = undefined;
		this.undoneRender = undefined;
		this.status = 'idle';
	}
}

export const request = new RequestState();
