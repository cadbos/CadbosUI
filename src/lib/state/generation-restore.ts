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
import { generationKinds } from '$lib/api/contract';
import { mediaAccess } from '$lib/state/media-access.svelte';
import { request, requestFormSnapshotSchema } from '$lib/state/request.svelte';

const mediaAccessSchema = z.object({ key: z.string().min(1), url: z.url() });

// GET /api/generated-images/[id]'s response shape — shared by every caller
// that reopens a past generation's exact settings (the Scenes drawer's
// per-scene restore, "Continue session" in projects/[id]), so the schema and
// the apply logic below can't drift apart between them.
export const generatedImageDetailResponseSchema = z.object({
	id: z.string().min(1),
	prompt: z.string(),
	kind: z.enum(generationKinds),
	createdAt: z.number(),
	image: mediaAccessSchema,
	source: mediaAccessSchema,
	formSnapshot: requestFormSnapshotSchema.nullable(),
	media: z.array(mediaAccessSchema)
});

export type GeneratedImageDetail = z.infer<typeof generatedImageDetailResponseSchema>;

export async function fetchGeneratedImageDetail(id: string): Promise<GeneratedImageDetail | null> {
	const response = await fetch(`/api/generated-images/${encodeURIComponent(id)}`);
	if (!response.ok) return null;
	const body: unknown = await response.json().catch(() => null);
	const parsed = generatedImageDetailResponseSchema.safeParse(body);
	return parsed.success ? parsed.data : null;
}

// Registers a fetched detail's media with the client-side media-access cache
// and, if it carries a snapshot, restores the exact form settings that
// produced it — the settings-half of a restore. Callers set the base image
// themselves first (ScenesDrawer.svelte's resetForNewScene(), or
// initializeSessionState()'s own fallback), since that part differs by
// context (a scene restore also clears render/job history a session
// continuation must not touch).
export function applyGeneratedImageFormSnapshot(detail: GeneratedImageDetail): void {
	for (const access of detail.media) mediaAccess.normalize(access);
	if (!detail.formSnapshot) return;
	request.restoreFormSnapshot(detail.formSnapshot);
	// The snapshot's own source-mode fields may point at a prior render's
	// output ('current-result') — meaningless here, since restoring never
	// reconstructs that render chain, only the single image the caller set.
	request.setStyleSourceMode('room-photo');
	request.setObjectReplacementSourceMode('room-photo');
	request.setTextureReplacementSourceMode('room-photo');
}
