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
import type { ProjectDetailResponse, ShareGenerationDetailResponse } from '$lib/api/contract';
import { requestFormSnapshotSchema } from '$lib/state/request.svelte';

export type ShareViewerStatus = 'idle' | 'loading' | 'ready' | 'not-found' | 'error';
export type ShareGenerationDetailStatus = 'idle' | 'loading' | 'ready' | 'error';

// PublicFormSnapshot ($lib/api/contract) — the same shape, minus every
// image-carrying field, which GET /api/share/[token]/generations/[id] never
// sends to an unauthenticated viewer in the first place.
const publicFormSnapshotSchema = requestFormSnapshotSchema.omit({
	styleReferenceImage: true,
	objectReferenceImage: true,
	textureReferenceImage: true,
	textureMaskImage: true,
	textureMaskSourceKey: true
});

const shareGenerationDetailSchema = z.object({
	id: z.uuid(),
	prompt: z.string(),
	kind: z.enum(generationKinds),
	createdAt: z.number().int().min(0),
	formSnapshot: publicFormSnapshotSchema.nullable()
});

const sessionGenerationSchema = z.object({
	id: z.uuid(),
	image: z.object({
		key: z.string().min(1),
		url: z.url()
	}),
	source: z.object({
		key: z.string().min(1),
		url: z.url()
	}),
	kind: z.enum(generationKinds),
	createdAt: z.number().int().min(0)
});

const sessionSchema = z.object({
	id: z.uuid(),
	title: z.string(),
	parentSessionId: z.uuid().nullable(),
	forkedFromGenerationId: z.uuid().nullable(),
	createdAt: z.number().int().min(0),
	updatedAt: z.number().int().min(0),
	generations: z.array(sessionGenerationSchema)
});

const projectDetailSchema = z.object({
	id: z.uuid(),
	title: z.string(),
	createdAt: z.number().int().min(0),
	updatedAt: z.number().int().min(0),
	shareActive: z.boolean(),
	sessions: z.array(sessionSchema)
});

export class ShareViewerLoadError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ShareViewerLoadError';
	}
}

// Read-only counterpart of project-detail.svelte.ts — backs the public,
// unauthenticated /share/[token] viewer. No mutations: nothing here ever
// writes to the server.
class ShareViewerState {
	project = $state<ProjectDetailResponse | null>(null);
	status = $state<ShareViewerStatus>('idle');
	#abort: AbortController | null = null;

	async load(token: string): Promise<void> {
		this.#abort?.abort();
		const controller = new AbortController();
		this.#abort = controller;
		this.status = 'loading';

		try {
			const response = await fetch(`/api/share/${token}`, { signal: controller.signal });
			if (this.#abort !== controller) return;
			if (response.status === 404) {
				this.project = null;
				this.status = 'not-found';
				return;
			}
			if (!response.ok) throw new ShareViewerLoadError('share viewer request failed');

			const parsed = projectDetailSchema.safeParse(await response.json().catch(() => null));
			if (!parsed.success) throw new ShareViewerLoadError('share viewer response invalid');

			this.project = parsed.data;
			this.status = 'ready';
		} catch (error) {
			if (controller.signal.aborted) return;
			this.project = null;
			this.status = 'error';
			console.error('Share viewer load failed:', error);
		} finally {
			if (this.#abort === controller) this.#abort = null;
		}
	}

	clear(): void {
		this.#abort?.abort();
		this.#abort = null;
		this.project = null;
		this.status = 'idle';
	}

	generationDetail = $state<ShareGenerationDetailResponse | null>(null);
	generationDetailStatus = $state<ShareGenerationDetailStatus>('idle');
	#detailAbort: AbortController | null = null;

	// Lazy, opened only when a visitor expands one generation's preview — see
	// this store's own doc comment on why the settings aren't bundled into
	// load() itself.
	async loadGenerationDetail(token: string, generationId: string): Promise<void> {
		this.#detailAbort?.abort();
		const controller = new AbortController();
		this.#detailAbort = controller;
		this.generationDetailStatus = 'loading';

		try {
			const response = await fetch(`/api/share/${token}/generations/${generationId}`, {
				signal: controller.signal
			});
			if (this.#detailAbort !== controller) return;
			if (!response.ok) throw new ShareViewerLoadError('share generation detail request failed');

			const parsed = shareGenerationDetailSchema.safeParse(await response.json().catch(() => null));
			if (!parsed.success) throw new ShareViewerLoadError('share generation detail invalid');

			this.generationDetail = parsed.data;
			this.generationDetailStatus = 'ready';
		} catch (error) {
			if (controller.signal.aborted) return;
			this.generationDetail = null;
			this.generationDetailStatus = 'error';
			console.error('Share generation detail load failed:', error);
		} finally {
			if (this.#detailAbort === controller) this.#detailAbort = null;
		}
	}

	clearGenerationDetail(): void {
		this.#detailAbort?.abort();
		this.#detailAbort = null;
		this.generationDetail = null;
		this.generationDetailStatus = 'idle';
	}
}

export const shareViewer = new ShareViewerState();
