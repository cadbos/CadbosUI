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
import { photoAdjustmentsSchema } from '$lib/photo-adjustments';
import { EDIT_WORKFLOWS, type ApiError } from '$lib/api/contract';
import { REPAINT_COLOR_PATTERN } from '$lib/repaint-colors';
import { imageRegionSchema } from '$lib/image-region';
import { formSnapshotSchema } from '$lib/api/form-snapshot';
import { parseMediaKey } from '$lib/server/media';

export function apiError(status: number, code: string, message: string): Response {
	return json({ error: { code, message } } satisfies ApiError, { status });
}

export const invoiceIdSchema = z.uuid();

export const createInvoiceRequestSchema = z.strictObject({
	id: invoiceIdSchema,
	paymentProcessor: z.string().min(1).max(100),
	amountMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
	currency: z.literal('USD')
});

export const invoiceActionRequestSchema = z.strictObject({});

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
	workflow: z.enum(EDIT_WORKFLOWS).default('default'),
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

export const upscaleRequestSchema = z.object({
	formSnapshot,
	imageKey: mediaKey,
	outputFormat: outputFormat.optional(),
	sessionId
});

export const photoProcessingRequestSchema = z.strictObject({
	imageKey: mediaKey,
	sessionId,
	formSnapshot: formSnapshotSchema.extend({
		photoAdjustments: photoAdjustmentsSchema,
		editOperationType: z.literal('photo-processing')
	})
});

export const objectReplacementRequestSchema = z.strictObject({
	imageKey: mediaKey,
	referenceImageKey: mediaKey,
	replacementObject: z.string().trim().min(1).max(200),
	region: imageRegionSchema.optional(),
	sessionId,
	formSnapshot
});

export const lightSettingsRequestSchema = z.strictObject({
	imageKey: mediaKey,
	instruction: z.string().trim().min(1).max(500),
	sessionId,
	formSnapshot
});

export const repaintRequestSchema = z.strictObject({
	imageKey: mediaKey,
	target: z.string().trim().min(1).max(200),
	color: z.string().regex(REPAINT_COLOR_PATTERN),
	region: imageRegionSchema.optional(),
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
