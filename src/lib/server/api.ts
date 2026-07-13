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
import type { ApiError } from '$lib/api/contract';

export function apiError(status: number, code: string, message: string): Response {
	return json({ error: { code, message } } satisfies ApiError, { status });
}

const outputFormat = z.enum(['webp', 'jpg', 'png', 'avif']);
const httpImageUrl = z.url({ protocol: /^https?$/ }).trim();
const httpsImageUrl = z.url({ protocol: /^https$/ }).trim();
const optionalText = z
	.string()
	.trim()
	.transform((value) => (value.length === 0 ? undefined : value))
	.optional();

export const renderRequestSchema = z.object({
	image: z.string().trim().min(1),
	prompt: z.string().trim().default(''),
	outputFormat
});

export const remoteImageUploadRequestSchema = z.object({
	url: httpsImageUrl
});

// Unlike render, edit-by-prompt has no "enhance" fallback for an empty prompt —
// the instruction is the whole point of the call (FR-К2/К3).
export const editRequestSchema = z.object({
	image: z.url().trim(),
	prompt: z.string().trim().min(1)
});

export const styleTransferRequestSchema = z.object({
	image: httpImageUrl,
	referenceImage: httpImageUrl,
	outputFormat,
	prompt: optionalText,
	negativePrompt: optionalText,
	styleTransferStrength: z.number().min(0).max(1).optional()
});

export const upscaleRequestSchema = z.object({
	image: httpImageUrl,
	outputFormat: outputFormat.optional()
});

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
