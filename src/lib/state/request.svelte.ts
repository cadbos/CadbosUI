import { createContext } from 'svelte';
import { z } from 'zod';
import {
	OUTPUT_FORMATS,
	type OutputFormat,
	type RenderRequest,
	type RenderResponse,
	type UploadResult
} from '$lib/api/contract';

export type { OutputFormat };

export type ImageInput = UploadResult;

export interface PromptFragment {
	id: string;
	label?: string;
	text: string;
	order: number;
}

export type EditOperation = string;

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

export type ValidationField = 'prompt' | 'image';

export interface ValidationResult {
	valid: boolean;
	missing: ValidationField[];
}

export interface RequestJSON {
	id: string;
	image?: ImageInput;
	promptFragments: PromptFragment[];
	outputFormat: OutputFormat;
	promptOverride: string | null;
	currentRender?: RenderResult;
	status: RequestStatus;
}

export interface NormalizedRequest {
	image?: ImageInput;
	promptFragments: PromptFragment[];
	outputFormat: OutputFormat;
	prompt: string;
}

const outputFormatSchema = z.enum(OUTPUT_FORMATS);

const imageInputSchema = z.object({
	url: z.string().trim().url(),
	mime: z.string().min(1),
	size: z.number().nonnegative(),
	dimensions: z.tuple([z.number().positive(), z.number().positive()]).optional()
});
const optionalImageInputSchema = imageInputSchema.optional();

const promptFragmentSchema = z.object({
	id: z.string().min(1),
	label: z.string().optional(),
	text: z.string(),
	order: z.number().int().nonnegative()
});

const renderResultSchema = z.object({
	id: z.string().min(1),
	outputUrls: z.array(z.string().min(1)).min(1),
	cost: z.number(),
	balance: z.number(),
	parentId: z.string().optional(),
	editOp: z.string().optional(),
	ts: z.number()
});

const requestJsonSchema = z
	.object({
		id: z.string().min(1),
		image: optionalImageInputSchema,
		promptFragments: z.array(promptFragmentSchema),
		outputFormat: outputFormatSchema,
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
		mime: image.mime,
		size: image.size,
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
	return editOp;
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

export class RequestState {
	id = $state<string>(crypto.randomUUID());
	image = $state<ImageInput | undefined>(undefined);
	promptFragments = $state<PromptFragment[]>([]);
	outputFormat = $state<OutputFormat>('webp');
	promptOverride = $state<string | null>(null);
	currentRender = $state<RenderResult | undefined>(undefined);
	status = $state<RequestStatus>('idle');

	prompt = $derived.by(() => derivePrompt(this.promptOverride, this.promptFragments));

	get canSubmit(): boolean {
		return this.validate().valid && this.status === 'idle';
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
		if (orderedIds.some((id) => !this.promptFragments.some((fragment) => fragment.id === id))) {
			throw new RequestReorderError('orderedIds contains unknown fragment id');
		}
		this.promptFragments = orderedIds.map((id, order) => {
			const fragment = this.promptFragments.find((item) => item.id === id);
			if (!fragment) throw new RequestReorderError('orderedIds contains unknown fragment id');
			return { ...fragment, order };
		});
	}

	setImage(image: ImageInput | undefined): void {
		this.image = cloneImage(optionalImageInputSchema.parse(image));
	}

	setOutputFormat(format: OutputFormat): void {
		this.outputFormat = format;
	}

	setPromptOverride(text: string): void {
		this.promptOverride = text;
	}

	clearPromptOverride(): void {
		this.promptOverride = null;
	}

	setCurrentRender(render: RenderResult | undefined): void {
		this.currentRender = cloneRenderResult(render);
	}

	setStatus(status: RequestStatus): void {
		this.status = status;
	}

	validate(): ValidationResult {
		const missing: ValidationField[] = [];
		if (!this.prompt.trim()) missing.push('prompt');
		if (!this.image?.url) missing.push('image');
		return { valid: missing.length === 0, missing };
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

	toJSON(): RequestJSON {
		return {
			id: this.id,
			image: cloneImage(this.image),
			promptFragments: cloneFragments(this.promptFragments),
			outputFormat: this.outputFormat,
			promptOverride: this.promptOverride,
			currentRender: cloneRenderResult(this.currentRender),
			status: this.status
		};
	}

	fromJSON(data: unknown): void {
		const parsed = requestJsonSchema.parse(data);
		this.id = parsed.id;
		this.image = cloneImage(parsed.image);
		this.promptFragments = cloneFragments(parsed.promptFragments);
		this.outputFormat = parsed.outputFormat;
		this.promptOverride = parsed.promptOverride;
		this.currentRender = cloneRenderResult(parsed.currentRender);
		this.status = parsed.status;
	}

	normalizeForComparison(): NormalizedRequest {
		return {
			image: cloneImage(this.image),
			promptFragments: cloneFragments(this.promptFragments),
			outputFormat: this.outputFormat,
			prompt: this.prompt
		};
	}

	reset(): void {
		this.id = crypto.randomUUID();
		this.image = undefined;
		this.promptFragments = [];
		this.outputFormat = 'webp';
		this.promptOverride = null;
		this.currentRender = undefined;
		this.status = 'idle';
	}
}

export function createRequestState(): RequestState {
	return new RequestState();
}

export const [getRequestState, setRequestState] = createContext<RequestState>();
