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

import { json } from '@sveltejs/kit';
import { z } from 'zod';
import {
	EDIT_OPERATION_TYPES,
	IMAGE_SOURCE_MODES,
	SCENE_TYPES,
	type ApiError,
	type RequestFormSnapshot
} from '$lib/api/contract';
import { parseMediaKey } from '$lib/server/media';

export function apiError(status: number, code: string, message: string): Response {
	return json({ error: { code, message } } satisfies ApiError, { status });
}

const outputFormat = z.enum(['webp', 'jpg', 'png', 'avif']);
const httpsImageUrl = z.url({ protocol: /^https$/ }).trim();
const optionalText = z
	.string()
	.trim()
	.transform((value) => (value.length === 0 ? undefined : value))
	.optional();
const mediaKey = z.string().refine((value) => parseMediaKey(value) !== null);

// The project-session a generation attaches to (Module 11) — ownership is
// verified server-side (projects.ts' assertSessionOwnedByUser) before any paid
// call, never trusted from the shape of the id alone.
const sessionId = z.uuid();

const imageSourceMode = z.enum(IMAGE_SOURCE_MODES);
const sceneType = z.enum(SCENE_TYPES);

const formSnapshotPromptFragment = z.object({
	id: z.string().min(1),
	label: z.string().optional(),
	text: z.string(),
	order: z.number().int().nonnegative()
});

const formSnapshotImage = z.union([
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

// Structural validation only (shape + bounds) — not the client's own
// requestFormSnapshotSchema (request.svelte.ts), which also enforces catalog
// membership (e.g. a light-settings preset id must exist in
// LIGHT_SETTINGS_PRESETS). That check depends on Svelte-only client modules
// and isn't needed here: this snapshot is opaque storage for later display
// back to the same user, not an input the server acts on. The `satisfies`
// below keeps this shape honest against RequestFormSnapshot as that type
// evolves.
export const formSnapshotSchema = z.object({
	promptFragments: z.array(formSnapshotPromptFragment).max(200),
	promptOverride: z.string().nullable(),
	editPrompt: z.string(),
	addObjectPresetId: z.string().nullable(),
	removeObjectText: z.string(),
	// Absent/null for a snapshot recorded before this field existed.
	editOperationType: z.enum(EDIT_OPERATION_TYPES).nullable().default(null),
	outputFormat,
	sceneType,
	styleTransferPrompt: z.string(),
	styleTransferStrength: z.number().min(0).max(1),
	styleNegativePrompt: z.string(),
	styleSourceMode: imageSourceMode,
	styleReferenceImage: formSnapshotImage.optional(),
	objectReplacementObject: z.string().max(200),
	objectReplacementSourceMode: imageSourceMode,
	objectReplacementScale: z.number().min(0.5).max(2),
	objectReferenceImage: formSnapshotImage.optional(),
	textureReplacementSurface: z.string().max(200),
	textureReplacementSourceMode: imageSourceMode,
	textureReplacementMasked: z.boolean(),
	textureReferenceImage: formSnapshotImage.optional(),
	textureMaskImage: formSnapshotImage.optional(),
	textureMaskSourceKey: z.string().min(1).optional(),
	lightSettingsPresetIds: z.array(z.string()).max(50),
	lightSettingsInstruction: z.string().max(500)
}) satisfies z.ZodType<RequestFormSnapshot>;

const formSnapshot = formSnapshotSchema.optional();

export const renderRequestSchema = z.object({
	imageKey: mediaKey,
	prompt: z.string().trim().default(''),
	outputFormat,
	sessionId,
	formSnapshot
});

export const remoteImageUploadRequestSchema = z.object({
	url: httpsImageUrl
});

// Unlike render, edit-by-prompt has no "enhance" fallback for an empty prompt —
// the instruction is the whole point of the call (FR-К2/К3).
export const editRequestSchema = z.object({
	imageKey: mediaKey,
	prompt: z.string().trim().min(1),
	sessionId,
	formSnapshot
});

const styleTransferBase = {
	imageKey: mediaKey,
	outputFormat,
	prompt: optionalText,
	negativePrompt: optionalText,
	styleTransferStrength: z.number().min(0).max(1).optional(),
	sessionId,
	formSnapshot
};

export const styleTransferRequestSchema = z.union([
	z.strictObject({ ...styleTransferBase, referenceImageKey: mediaKey }),
	z.strictObject({ ...styleTransferBase, stylePresetId: z.string().trim().min(1) })
]);

// upscale has no user-adjustable form settings beyond imageKey/outputFormat —
// nothing meaningful to restore, so it carries no formSnapshot.
export const upscaleRequestSchema = z.object({
	imageKey: mediaKey,
	outputFormat: outputFormat.optional(),
	sessionId
});

export const objectReplacementRequestSchema = z.strictObject({
	imageKey: mediaKey,
	referenceImageKey: mediaKey,
	replacementObject: z.string().trim().min(1).max(200),
	sessionId,
	formSnapshot
});

export const lightSettingsRequestSchema = z.strictObject({
	imageKey: mediaKey,
	instruction: z.string().trim().min(1).max(500),
	sessionId,
	formSnapshot
});

export const textureReplacementRequestSchema = z.union([
	z.strictObject({
		imageKey: mediaKey,
		referenceImageKey: mediaKey,
		replacementSurface: z.string().trim().min(1).max(200),
		sessionId,
		formSnapshot
	}),
	z.strictObject({
		imageKey: mediaKey,
		referenceImageKey: mediaKey,
		maskImageKey: mediaKey,
		sessionId,
		formSnapshot
	})
]);

// Module 11 — Projects. Same shape for a project title and an explicit session
// rename (both required, non-empty); session *creation* leaves title optional
// (defaults to '' — see createSession), since the new-session flow never
// prompts for one up front.
const requiredTitle = z.string().trim().min(1).max(200);
const sessionTitle = z.string().trim().max(200).optional();

export const createProjectRequestSchema = z.strictObject({ title: requiredTitle });

export const renameProjectRequestSchema = z.strictObject({ title: requiredTitle });

export const createSessionRequestSchema = z.strictObject({ title: sessionTitle });

export const renameSessionRequestSchema = z.strictObject({ title: requiredTitle });

// Nostr pubkey: 32-byte lowercase hex (x-only schnorr public key).
export const challengeRequestSchema = z.object({
	pubkey: z
		.string()
		.trim()
		.toLowerCase()
		.regex(/^[0-9a-f]{64}$/)
});

const profileName = z
	.string()
	.trim()
	.max(80)
	.transform((value) => (value.length === 0 ? null : value))
	.optional();

export const profileUpdateRequestSchema = z.object({
	firstName: profileName,
	lastName: profileName
});

export async function parseBody<S extends z.ZodType>(
	request: Request,
	schema: S
): Promise<{ ok: true; data: z.infer<S> } | { ok: false; response: Response }> {
	const body = await request.json().catch(() => null);
	const result = schema.safeParse(body);
	if (!result.success) {
		return { ok: false, response: apiError(400, 'invalid_request', 'Invalid request body') };
	}
	return { ok: true, data: result.data };
}
