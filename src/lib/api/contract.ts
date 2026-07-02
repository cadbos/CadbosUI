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

// Shared client↔server wire types (no secrets). The server proxy normalizes
// external-service responses to these shapes, so the client never depends on
// provider quirks. Dev mocks and real endpoints return exactly these types.

export const OUTPUT_FORMATS = ['webp', 'jpg', 'png', 'avif'] as const;

export type OutputFormat = (typeof OUTPUT_FORMATS)[number];

// Unified error body (HTTP 4xx/5xx) — no stack, paths, or internal ids.
export interface ApiError {
	error: { code: string; message: string };
}

// POST /api/uploads (after UploadThing) → data for the image input.
export interface UploadResult {
	url: string;
	mime: string;
	size: number;
	dimensions?: [number, number];
}

// POST /api/render — create an interior render.
export interface RenderRequest {
	image: string;
	prompt: string;
	outputFormat: OutputFormat;
}

// POST /api/edit — edit by prompt (no outputFormat; aspect ratio is preserved).
export interface EditRequest {
	image: string;
	prompt: string;
}

// Normalized response for both render and edit (output[0] for render,
// output for edit — both normalized to a single url).
export interface RenderResponse {
	outputUrl: string;
	cost: number;
	balance: number;
}

// Auth (Appendix B). The signed NIP-98 event travels in
// `Authorization: Nostr <base64>`.
export interface ChallengeRequest {
	pubkey: string;
}

export interface ChallengeResponse {
	challenge: string; // nonce, single-use, short TTL
}

export interface SessionUser {
	pubkey: string;
	firstName?: string;
	lastName?: string;
}

export interface ProfileUpdateRequest {
	firstName?: string | null;
	lastName?: string | null;
}

export interface RelayInfo {
	url: string;
	read: boolean;
	write: boolean;
}

export interface NostrProfile {
	name?: string;
	picture?: string;
	about?: string;
	nip05?: string;
	website?: string;
	relays: RelayInfo[];
}

export interface Quota {
	balanceOrLimit: number;
	usage: number;
	period: string;
}

// GET /auth/me → 401 when no session.
export interface MeResponse {
	user: SessionUser;
	quota?: Quota;
}
