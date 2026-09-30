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
import { generationKinds, mediaAccessSchema } from '$lib/api/contract';
import { requestFormSnapshotSchema } from '$lib/state/request.svelte';
import { describeCause, issuePaths } from '$lib/utils';

// GET /api/generated-images/[id]'s response shape — shared by every caller
// that reopens a past generation (workspace-tabs.svelte.ts's
// initializeGenerationPreview), so they all validate it the same way.
export const generatedImageDetailResponseSchema = z.object({
	id: z.string().min(1),
	prompt: z.string(),
	kind: z.enum(generationKinds),
	createdAt: z.number(),
	amount: z.number(),
	balanceAfter: z.number(),
	image: mediaAccessSchema,
	source: mediaAccessSchema,
	formSnapshot: requestFormSnapshotSchema.nullable(),
	session: z
		.object({
			projectId: z.uuid(),
			projectTitle: z.string(),
			sessionId: z.uuid(),
			sessionTitle: z.string()
		})
		.nullable(),
	media: z.array(mediaAccessSchema)
});

export type GeneratedImageDetail = z.infer<typeof generatedImageDetailResponseSchema>;

export class GeneratedImageDetailLoadError extends Error {
	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = 'GeneratedImageDetailLoadError';
	}
}

// Null only on a 404 (deleted, or not the caller's); any other failure —
// network, blocked request, 5xx, malformed body — throws, so a caller can
// tell a dead link apart from a connection problem worth retrying (same
// contract as project-detail.svelte.ts's fetchProjectDetail).
export async function fetchGeneratedImageDetail(id: string): Promise<GeneratedImageDetail | null> {
	let response: Response;
	try {
		response = await fetch(`/api/generated-images/${encodeURIComponent(id)}`);
	} catch (error) {
		throw new GeneratedImageDetailLoadError(
			`generation detail request failed (network): ${describeCause(error)}`,
			{
				cause: error
			}
		);
	}
	if (response.status === 404) return null;
	if (!response.ok) {
		throw new GeneratedImageDetailLoadError(
			`generation detail request failed: HTTP ${response.status}`
		);
	}
	let body: unknown;
	try {
		body = await response.json();
	} catch (error) {
		throw new GeneratedImageDetailLoadError(
			`generation detail response is not valid JSON: ${describeCause(error)}`,
			{
				cause: error
			}
		);
	}
	const parsed = generatedImageDetailResponseSchema.safeParse(body);
	if (!parsed.success) {
		throw new GeneratedImageDetailLoadError(
			`generation detail response failed schema validation at ${issuePaths(parsed.error)}`
		);
	}
	return parsed.data;
}
