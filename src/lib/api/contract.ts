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

// Shared client↔server wire types (no secrets). The server proxy normalizes
// external-service responses to these shapes, so the client never depends on
// provider quirks. Dev mocks and real endpoints return exactly these types.

export const OUTPUT_FORMATS = ['webp', 'jpg', 'png', 'avif'] as const;

export type OutputFormat = (typeof OUTPUT_FORMATS)[number];

// Unified error body (HTTP 4xx/5xx) — no stack, paths, or internal ids.
export interface ApiError {
	error: { code: string; message: string };
}

export const healthServiceStatusSchema = z.enum(['healthy', 'unhealthy']);

export const serviceHealthSchema = z
	.object({
		status: healthServiceStatusSchema,
		latencyMs: z.number().int().nonnegative()
	})
	.strict();

export const nostrHealthSchema = serviceHealthSchema
	.extend({
		reachable: z.number().int().nonnegative(),
		total: z.number().int().nonnegative()
	})
	.refine(({ reachable, total }) => reachable <= total);

export const healthSnapshotSchema = z
	.object({
		status: healthServiceStatusSchema,
		timestamp: z.iso.datetime(),
		services: z
			.object({
				archai: serviceHealthSchema,
				assets: serviceHealthSchema,
				comfyui: serviceHealthSchema,
				d1: serviceHealthSchema,
				nostr: nostrHealthSchema,
				r2: serviceHealthSchema
			})
			.strict()
	})
	.strict();

export type HealthServiceStatus = z.infer<typeof healthServiceStatusSchema>;
export type ServiceHealth = z.infer<typeof serviceHealthSchema>;
export type NostrHealth = z.infer<typeof nostrHealthSchema>;
export type HealthSnapshot = z.infer<typeof healthSnapshotSchema>;

// POST /api/uploads (after UploadThing) → data for the image input.
export const uploadResultSchema = z
	.object({
		url: z.url(),
		mime: z.string().min(1),
		size: z.number().nonnegative(),
		hash: z.string().min(1),
		dimensions: z.tuple([z.number().positive(), z.number().positive()]).optional()
	})
	.strict();

export type UploadResult = z.infer<typeof uploadResultSchema>;

export interface RemoteImageUploadRequest {
	url: string;
}

// POST /api/render or /api/render/exterior — create a render.
export interface RenderRequest {
	image: string;
	// SHA-256 hex digest of `image`'s bytes, from the /api/uploads response —
	// omitted when `image` is a previous render/edit result rather than a
	// fresh upload. Lets the server record image_generation_details.input_hash for future
	// upload dedup; never forwarded to the render provider.
	imageHash?: string;
	prompt: string;
	outputFormat: OutputFormat;
}

// POST /api/edit — edit by prompt (no outputFormat; aspect ratio is preserved).
export interface EditRequest {
	image: string;
	// See RenderRequest.imageHash — Edit has no room-photo/current-result
	// toggle, but still falls back to the room photo when there's no render
	// yet (resolveEditSource), so `image` isn't always a previous result.
	imageHash?: string;
	prompt: string;
}

// POST /api/style-transfer — apply a reference image's style to a source image.
export interface StyleTransferRequest {
	image: string;
	imageHash?: string;
	referenceImage: string;
	outputFormat: OutputFormat;
	prompt?: string;
	negativePrompt?: string;
	styleTransferStrength?: number;
}

// POST /api/upscale — upscale an existing render/edit result to 4K.
export interface UpscaleRequest {
	image: string;
	outputFormat?: OutputFormat;
}

export interface ObjectReplacementRequest {
	image: string;
	imageHash?: string;
	referenceImage: string;
	replacementObject: string;
}

export interface ObjectReplacementProcessingResponse {
	id: string;
	status: 'processing';
}

export interface ObjectReplacementCompletedResponse {
	id: string;
	status: 'completed';
	outputUrl: string;
	cost: number;
	balance: number;
}

export interface ObjectReplacementFailedResponse {
	id: string;
	status: 'failed';
	error: { code: string; message: string };
}

export type ObjectReplacementJobResponse =
	| ObjectReplacementProcessingResponse
	| ObjectReplacementCompletedResponse
	| ObjectReplacementFailedResponse;

export interface AutomaticTextureReplacementRequest {
	image: string;
	imageHash?: string;
	referenceImage: string;
	replacementSurface: string;
}

export interface MaskedTextureReplacementRequest {
	image: string;
	imageHash?: string;
	referenceImage: string;
	mask: string;
}

export type TextureReplacementRequest =
	| AutomaticTextureReplacementRequest
	| MaskedTextureReplacementRequest;

export interface TextureReplacementProcessingResponse {
	id: string;
	status: 'processing';
}

export interface TextureReplacementCompletedResponse {
	id: string;
	status: 'completed';
	outputUrl: string;
	cost: number;
	balance: number;
}

export interface TextureReplacementFailedResponse {
	id: string;
	status: 'failed';
	error: { code: string; message: string };
}

export type TextureReplacementJobResponse =
	| TextureReplacementProcessingResponse
	| TextureReplacementCompletedResponse
	| TextureReplacementFailedResponse;

// Normalized response for image-generation endpoints. Provider array/string
// outputs are normalized to a single URL. `balance` is the caller's own
// remaining approved-account balance after this call — never archAI's raw
// (shared) account balance, which the client must never see.
export interface RenderResponse {
	outputUrl: string;
	cost: number;
	balance: number;
}

export const generationKinds = [
	'render',
	'edit',
	'style-transfer',
	'upscale',
	'object-replacement',
	'texture-replacement'
] as const;

export type GenerationKind = (typeof generationKinds)[number];

export interface GeneratedImageRecord {
	id: string;
	url: string;
	sourceUrl: string;
	kind: GenerationKind;
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

// GET /api/resources — distinct source photos the user has actually
// uploaded (one card per photo, grouped by source_url). Rows whose source
// was a previous generation's own result rather than a fresh upload (edit,
// upscale, or any other call made with source mode 'current-result' —
// these intentionally carry imageHash: '') are excluded, not shown as if
// they were uploads; see listDistinctSourceImages. Content-hash dedup still
// applies at *upload* time (findGenerationSourceByHash) to avoid storing
// duplicate objects. Read-only gallery: no delete in this iteration.
export interface ResourceImageRecord {
	sourceUrl: string;
	createdAt: number;
}

export interface ResourcesResponse {
	images: ResourceImageRecord[];
	pagination: {
		offset: number;
		size: number;
		hasMore: boolean;
	};
}

export interface UserUsageRecord {
	pubkey: string;
	balance: number;
	totalDeposit: number;
	lastDepositAt: number | null;
	generationCount: number;
	totalSpend: number;
	latestSpendAt: number | null;
}

export interface UserUsageResponse {
	users: UserUsageRecord[];
	pagination: {
		offset: number;
		size: number;
		hasMore: boolean;
	};
}

export interface UsageProfile {
	name?: string;
	picture?: string;
}

export interface UsageProfilesRequest {
	pubkeys: string[];
}

export interface UsageProfilesResponse {
	profiles: Record<string, UsageProfile>;
}

export const packageRecordSchema = z.strictObject({
	id: z.string().min(1),
	usdAmount: z.number().positive(),
	creditsAwarded: z.number().positive()
});

export const packagesResponseSchema = z.strictObject({
	packages: z.array(packageRecordSchema)
});

export const createDepositRequestSchema = z.strictObject({
	requestId: z.uuid(),
	packageId: z.string().trim().min(1).max(64)
});

export const depositIdSchema = z.uuid();
export const depositStatusSchema = z.enum(['creating', 'pending', 'paid', 'expired', 'failed']);

export const depositResponseSchema = z.strictObject({
	id: depositIdSchema,
	status: depositStatusSchema,
	bolt11: z.string().min(1).optional(),
	satsAmount: z.number().int().positive().optional(),
	usdAmount: z.number().positive().optional(),
	expiresAt: z.number().int().positive().optional(),
	balance: z.number().optional()
});

export type PackageRecord = z.infer<typeof packageRecordSchema>;
export type CreateDepositRequest = z.infer<typeof createDepositRequestSchema>;
export type DepositStatus = z.infer<typeof depositStatusSchema>;
export type DepositResponse = z.infer<typeof depositResponseSchema>;

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

// GET /api/usage/balance — the shared ARCHAI_API_KEY account's live balance,
// fetched from archAI's own Check Balance endpoint. Admin-only, shown on /usage
// (see authorizeUsageViewer).
export interface WalletBalanceResponse {
	balance: number;
}

// A generation deduction from an approved account's app-credit ledger.
// `amount` is the real cost archAI charged. `id` is a stable identifier for
// list rendering — createdAt alone can collide across concurrent calls.
export interface CreditTransaction {
	id: string;
	amount: number;
	balanceAfter: number;
	kind: GenerationKind;
	createdAt: number;
}

// An account's own generation limit, set by an admin (billing.ts) — the only
// balance a user is ever shown, both in their profile and after a render/edit
// (see RenderResponse.balance). Present only once an admin has approved the
// account (an enabled `generation_access` row with an app-credit ledger account).
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
