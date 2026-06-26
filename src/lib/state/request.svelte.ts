import type { OutputFormat, ImageInput, PromptFragment, EditOperation, RenderResult } from '$lib/api/contract';

export type { OutputFormat, ImageInput, PromptFragment, EditOperation, RenderResult };

export type RequestStatus = 'idle' | 'submitting' | 'error';

export type ValidationField = 'image' | 'prompt';

export interface ValidationResult {
	valid: boolean;
	missing: ValidationField[];
}

// Serialized form used for JSON export/import (FR-А6) and AC-9 identity checks.
// Excludes runtime-only fields (status, currentRender).
export interface SerializedRequest {
	id: string;
	image?: ImageInput;
	promptFragments: PromptFragment[];
	prompt: string;
	promptOverride?: string;
	outputFormat: OutputFormat;
}

// ── Private state ────────────────────────────────────────────────────────────

let _id = $state<string>(crypto.randomUUID());
let _image = $state<ImageInput | undefined>(undefined);
let _promptFragments = $state<PromptFragment[]>([]);
let _outputFormat = $state<OutputFormat>('webp');
let _currentRender = $state<RenderResult | undefined>(undefined);
let _status = $state<RequestStatus>('idle');
let _promptOverride = $state<string | undefined>(undefined);

// ── Derived ──────────────────────────────────────────────────────────────────

const _prompt = $derived.by<string>(() => {
	if (_promptOverride !== undefined) return _promptOverride;
	return [..._promptFragments]
		.sort((a, b) => a.order - b.order)
		.map((f) => f.text)
		.filter(Boolean)
		.join(' ');
});

// ── Mutations ────────────────────────────────────────────────────────────────

function addFragment(fragment?: { text?: string; label?: string }): string {
	const id = crypto.randomUUID();
	const order =
		_promptFragments.length > 0
			? Math.max(..._promptFragments.map((f) => f.order)) + 1
			: 0;
	_promptFragments = [..._promptFragments, { id, text: fragment?.text ?? '', label: fragment?.label, order }];
	return id;
}

function updateFragment(id: string, updates: Partial<Omit<PromptFragment, 'id'>>): void {
	_promptFragments = _promptFragments.map((f) => (f.id === id ? { ...f, ...updates } : f));
}

function removeFragment(id: string): void {
	_promptFragments = _promptFragments.filter((f) => f.id !== id);
}

// Reorders fragments by assigning each an `order` based on position in `orderedIds`.
// Fragments whose IDs are not listed keep their current order (appended after listed ones).
function reorder(orderedIds: string[]): void {
	_promptFragments = _promptFragments.map((f) => {
		const newOrder = orderedIds.indexOf(f.id);
		return newOrder === -1 ? f : { ...f, order: newOrder };
	});
}

function setImage(image: ImageInput | undefined): void {
	_image = image;
}

function setOutputFormat(format: OutputFormat): void {
	_outputFormat = format;
}

function setCurrentRender(render: RenderResult | undefined): void {
	_currentRender = render;
}

// Sets the submitting/error/idle lifecycle status.
// Components call this around API calls to prevent double-submission.
function setStatus(status: RequestStatus): void {
	_status = status;
}

// Overrides the derived prompt with a literal value.
// The override persists across view switches (FR-А3).
function setPrompt(prompt: string): void {
	_promptOverride = prompt;
}

function clearPromptOverride(): void {
	_promptOverride = undefined;
}

// ── Validation ───────────────────────────────────────────────────────────────

function validate(): ValidationResult {
	const missing: ValidationField[] = [];
	if (!_image) missing.push('image');
	if (!_prompt.trim()) missing.push('prompt');
	return { valid: missing.length === 0, missing };
}

// Returns true when submission is currently safe (valid model, not already in flight).
function canSubmit(): boolean {
	return validate().valid && _status !== 'submitting';
}

// ── Serialization (FR-А6) ────────────────────────────────────────────────────

function toJSON(): SerializedRequest {
	return {
		id: _id,
		image: _image ? { ..._image, dimensions: _image.dimensions ? [..._image.dimensions] : undefined } : undefined,
		promptFragments: [..._promptFragments]
			.sort((a, b) => a.order - b.order)
			.map((f) => ({ ...f })),
		prompt: _prompt,
		promptOverride: _promptOverride,
		outputFormat: _outputFormat
	};
}

function fromJSON(data: SerializedRequest): void {
	_id = data.id;
	_image = data.image
		? { ...data.image, dimensions: data.image.dimensions ? [data.image.dimensions[0], data.image.dimensions[1]] : undefined }
		: undefined;
	_promptFragments = data.promptFragments.map((f) => ({ ...f }));
	_outputFormat = data.outputFormat;
	_promptOverride = data.promptOverride;
	_currentRender = undefined;
	_status = 'idle';
}

// ── Reset ────────────────────────────────────────────────────────────────────

function reset(): void {
	_id = crypto.randomUUID();
	_image = undefined;
	_promptFragments = [];
	_outputFormat = 'webp';
	_currentRender = undefined;
	_status = 'idle';
	_promptOverride = undefined;
}

// ── Public API ────────────────────────────────────────────────────────────────

export const requestModel = {
	get id() { return _id; },
	get image() { return _image; },
	get promptFragments() { return _promptFragments; },
	get outputFormat() { return _outputFormat; },
	get currentRender() { return _currentRender; },
	get status() { return _status; },
	get prompt() { return _prompt; },
	get hasPromptOverride() { return _promptOverride !== undefined; },

	addFragment,
	updateFragment,
	removeFragment,
	reorder,
	setImage,
	setOutputFormat,
	setCurrentRender,
	setStatus,
	setPrompt,
	clearPromptOverride,
	validate,
	canSubmit,
	toJSON,
	fromJSON,
	reset,
};
