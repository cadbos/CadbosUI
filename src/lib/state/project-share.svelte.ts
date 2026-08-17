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
import { discardBody } from '$lib/utils';

export type ShareStatus = 'idle' | 'loading' | 'issuing' | 'active' | 'revoking' | 'error';

const issueShareResponseSchema = z.object({ token: z.string().min(1) });

export class ProjectShareActionError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ProjectShareActionError';
	}
}

class ProjectShareState {
	status = $state<ShareStatus>('idle');
	// Populated right after issuing (see issueShare()) or, when a link is
	// already active, by load()/hydrate()'s GET .../share fetch.
	token = $state<string | null>(null);
	#projectId: string | null = null;
	// issueShare/revokeShare/load/hydrate are mutually exclusive views of the
	// same share link for a given project, so whichever call started most
	// recently for that project is the only one allowed to write
	// status/token. A stale response arriving after a newer call for the
	// same (or a different) project already ran would otherwise resurrect
	// state that call never produced.
	#call = 0;

	#claim(projectId: string): number {
		this.#projectId = projectId;
		return ++this.#call;
	}

	#isCurrent(projectId: string, call: number): boolean {
		return this.#projectId === projectId && this.#call === call;
	}

	// Standalone GET .../share fetch — used by callers with no pre-fetched
	// Response of their own (the header's share dialog).
	async load(projectId: string): Promise<void> {
		const call = this.#claim(projectId);
		this.status = 'loading';
		try {
			const response = await fetch(`/api/projects/${projectId}/share`);
			if (!this.#isCurrent(projectId, call)) {
				discardBody(response);
				return;
			}
			if (response.status === 404) {
				discardBody(response);
				this.status = 'idle';
				this.token = null;
				return;
			}
			if (!response.ok) {
				discardBody(response);
				throw new ProjectShareActionError('share link fetch failed');
			}
			const parsed = issueShareResponseSchema.safeParse(await response.json().catch(() => null));
			if (!this.#isCurrent(projectId, call)) return;
			this.status = 'active';
			this.token = parsed.success ? parsed.data.token : null;
		} catch (error) {
			if (this.#isCurrent(projectId, call)) this.status = 'error';
			console.error('Project share load failed:', error);
		}
	}

	// Called only by ProjectDetailState.load(), handed its own already-fetched,
	// unread Response from its parallel Promise.all([detail, share]) fetch.
	// shareActive (from the detail payload) is the source of truth for
	// whether a link exists at all — this only ever supplies the plaintext
	// token to go with it.
	async hydrate(projectId: string, shareActive: boolean, response: Response): Promise<void> {
		const call = this.#claim(projectId);
		if (shareActive && response.ok) {
			const parsed = issueShareResponseSchema.safeParse(await response.json().catch(() => null));
			if (!this.#isCurrent(projectId, call)) return;
			this.status = 'active';
			this.token = parsed.success ? parsed.data.token : null;
		} else {
			discardBody(response);
			if (!this.#isCurrent(projectId, call)) return;
			this.status = shareActive ? 'active' : 'idle';
			this.token = null;
		}
	}

	// The token is only ever known at issuance — GET /api/projects/[id]/share
	// never returns it on its own outside of an active link — so this is the
	// only way the owner sees the plaintext link, same as an API key
	// reveal-once flow.
	async issueShare(projectId: string): Promise<string> {
		const call = this.#claim(projectId);
		this.status = 'issuing';
		try {
			const response = await fetch(`/api/projects/${projectId}/share`, { method: 'POST' });
			if (!response.ok) throw new ProjectShareActionError('share link creation failed');

			const parsed = issueShareResponseSchema.safeParse(await response.json().catch(() => null));
			if (!parsed.success) throw new ProjectShareActionError('share link response invalid');

			// A token belonging to a project the caller has since navigated away
			// from — or a share operation since superseded by a newer one, e.g.
			// a revoke that started after this issue and has already run — must
			// never surface as if it were the *current* link.
			if (this.#isCurrent(projectId, call)) {
				this.status = 'active';
				this.token = parsed.data.token;
			}
			return parsed.data.token;
		} catch (error) {
			if (this.#isCurrent(projectId, call)) this.status = 'error';
			throw error;
		}
	}

	// Always revokes whichever link is currently active — the caller never
	// needs to have kept the token value.
	async revokeShare(projectId: string): Promise<void> {
		const call = this.#claim(projectId);
		this.status = 'revoking';
		try {
			const response = await fetch(`/api/projects/${projectId}/share`, { method: 'DELETE' });
			if (!response.ok && response.status !== 404) {
				throw new ProjectShareActionError('share link revoke failed');
			}
			if (this.#isCurrent(projectId, call)) {
				this.status = 'idle';
				this.token = null;
			}
		} catch (error) {
			if (this.#isCurrent(projectId, call)) this.status = 'error';
			throw error;
		}
	}

	clear(): void {
		this.#projectId = null;
		this.status = 'idle';
		this.token = null;
	}
}

export const projectShare = new ProjectShareState();
