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

// POST /api/style-transfer — apply a reference image's style to a source image.
export interface StyleTransferRequest {
	image: string;
	referenceImage: string;
	outputFormat: OutputFormat;
	prompt?: string;
	negativePrompt?: string;
	styleTransferStrength?: number;
}

// POST /api/auto-prompt — describe an input image as a render prompt.
export interface AutoPromptRequest {
	image: string;
}

// Normalized response for image-generation endpoints. Provider array/string
// outputs are normalized to a single URL. `balance` is the
// caller's own remaining approved-account balance after this call — never
// archAI's raw (shared) account balance, which the client must never see.
export interface RenderResponse {
	outputUrl: string;
	cost: number;
	balance: number;
}

// Normalized auto-prompt response. `prompt` is ArchAI's plain-text output,
// and `balance` follows the same approved-account rule as RenderResponse.
export interface AutoPromptResponse {
	prompt: string;
	cost: number;
	balance: number;
}

export interface GeneratedImageRecord {
	id: string;
	url: string;
	createdAt: number;
}

export interface GeneratedImagesResponse {
	images: GeneratedImageRecord[];
	pagination: {
		offset: number;
		size: number;
		hasMore: boolean;
	};
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

// Real per-account balance as reported by archAI after the user's last
// generation (Module 6) — mirrored server-side for ops visibility only
// (billing.ts's `balances` table). Never sent to the client: it reflects the
// one shared ARCHAI_API_KEY account, not anything personal to a given user.
export interface Balance {
	balance: number;
	updatedAt: number;
}

// A single deduction from an approved account's own limit (see CreditInfo
// below). `amount` is the real cost archAI charged. `id` is a stable identifier
// for list rendering — createdAt alone can collide across concurrent calls.
export interface CreditTransaction {
	id: string;
	amount: number;
	balanceAfter: number;
	kind: 'render' | 'edit' | 'style-transfer' | 'auto-prompt';
	createdAt: number;
}

// An account's own generation limit, set by an admin (billing.ts) — the only
// balance a user is ever shown, both in their profile and after a render/edit
// (see RenderResponse.balance). Present only once an admin has approved the
// account (a `credits` row).
export interface CreditInfo {
	balance: number;
	updatedAt: number;
	history: CreditTransaction[];
}

// GET /auth/me → 401 when no session.
export interface MeResponse {
	user: SessionUser;
	credit?: CreditInfo;
}
