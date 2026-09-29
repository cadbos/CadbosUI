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

import { goto } from '$app/navigation';
import { resolve } from '$app/paths';
import type { PathnameWithSearchOrHash } from '$app/types';
import { fetchGeneratedImageDetail } from '$lib/state/generation-restore';
import { request } from '$lib/state/request.svelte';
import { buildWorkspaceUrl, destinationForGenerationKind } from '$lib/state/url-state';
import { initializeGenerationPreview, workspaceTabs } from '$lib/state/workspace-tabs.svelte';

// Opens a past generation in the workspace exactly as it looked right after
// it was made — its own project/session tab, result on screen, source as the
// "before", the form it was submitted with, on the mode/tool that produced
// it (see workspace-tabs.svelte.ts's initializeGenerationPreview). Shared by
// every page that lists past generations (/expenses, a resource's page) so
// they all land on the same screen and URL. Resolves to false when there's
// nothing to open into — the generation is gone, or its session/project has
// been archived; a connection failure throws (see fetchGeneratedImageDetail).
export async function openGenerationInWorkspace(generationId: string): Promise<boolean> {
	const generation = await fetchGeneratedImageDetail(generationId);
	const session = generation?.session;
	if (!generation || !session) return false;

	workspaceTabs.openProject({
		projectId: session.projectId,
		projectTitle: session.projectTitle,
		sessionId: session.sessionId,
		sessionTitle: session.sessionTitle.trim() === '' ? null : session.sessionTitle,
		initialize: (state) => initializeGenerationPreview(state, generation)
	});

	const destination = destinationForGenerationKind(generation.kind, generation.formSnapshot);
	await goto(
		resolve(
			buildWorkspaceUrl(destination.mode, request, destination.subTab) as PathnameWithSearchOrHash,
			{}
		),
		{ replaceState: false }
	);
	return true;
}
