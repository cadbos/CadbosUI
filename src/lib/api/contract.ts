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

// GET /api/exchange-rate → USD→RUB rate for the currency switcher.
export const exchangeRateSchema = z
	.object({
		rubPerUsd: z.number().positive(),
		asOf: z.iso.datetime()
	})
	.strict();

export type ExchangeRate = z.infer<typeof exchangeRateSchema>;

export interface RemoteImageUploadRequest {
	url: string;
}

// POST /api/render or /api/render/exterior — create a render.
export interface RenderRequest {
	image: string;
	// SHA-256 hex digest of `image`'s bytes, from the /api/uploads response —
	// omitted when `image` is a previous render/edit result rather than a
	// fresh upload. Lets the server record the source media checksum for future
	// upload dedup; never forwarded to the render provider.
	imageHash?: string;
	prompt: string;
	outputFormat: OutputFormat;
	// The project session this generation attaches to (Module 11) — the server
	// verifies ownership before charging or calling the render provider.
	sessionId: string;
}

// POST /api/edit — edit by prompt (no outputFormat; aspect ratio is preserved).
export interface EditRequest {
	image: string;
	// See RenderRequest.imageHash — Edit has no room-photo/current-result
	// toggle, but still falls back to the room photo when there's no render
	// yet (resolveEditSource), so `image` isn't always a previous result.
	imageHash?: string;
	prompt: string;
	sessionId: string;
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
	sessionId: string;
}

// POST /api/upscale — upscale an existing render/edit result to 4K.
export interface UpscaleRequest {
	image: string;
	outputFormat?: OutputFormat;
	sessionId: string;
}

export interface ObjectReplacementRequest {
	image: string;
	imageHash?: string;
	referenceImage: string;
	replacementObject: string;
	sessionId: string;
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

export interface LightSettingsRequest {
	image: string;
	imageHash?: string;
	instruction: string;
	sessionId: string;
}

export interface LightSettingsProcessingResponse {
	id: string;
	status: 'processing';
}

export interface LightSettingsCompletedResponse {
	id: string;
	status: 'completed';
	outputUrl: string;
	cost: number;
	balance: number;
}

export interface LightSettingsFailedResponse {
	id: string;
	status: 'failed';
	error: { code: string; message: string };
}

export type LightSettingsJobResponse =
	| LightSettingsProcessingResponse
	| LightSettingsCompletedResponse
	| LightSettingsFailedResponse;

export interface AutomaticTextureReplacementRequest {
	image: string;
	imageHash?: string;
	referenceImage: string;
	replacementSurface: string;
	sessionId: string;
}

export interface MaskedTextureReplacementRequest {
	image: string;
	imageHash?: string;
	referenceImage: string;
	mask: string;
	sessionId: string;
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
	'texture-replacement',
	'light-settings'
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
// uploaded (one card per source media row). Rows whose source
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

// GET /api/usage/balance — the shared ARCHAI_API_KEY account's live balance,
// fetched from archAI's own Check Balance endpoint (unlike `Balance` above,
// which is a D1-cached mirror). Admin-only, shown on /usage (see
// authorizeUsageViewer).
export interface WalletBalanceResponse {
	balance: number;
}

// A single deduction from an approved account's own limit (see CreditInfo
// below). `amount` is the operation's provider-reported or configured charge.
// `id` is stable for list rendering — createdAt can collide across concurrent calls.
// `id` doubles as the underlying generations.id — the same id a project
// session's own generation list (SessionGenerationRecord) uses, so a client
// can resolve one back to the other. `sessionId`/`projectId` are null only for
// the — post-Module-11-backfill, essentially unreachable — case of a
// generation with no session attached.
export interface CreditTransaction {
	id: string;
	amount: number;
	balanceAfter: number;
	kind: GenerationKind;
	createdAt: number;
	sessionId: string | null;
	projectId: string | null;
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

// GET /auth/me → 401 when no session; 503 with Retry-After when session storage is unavailable.
export interface MeResponse {
	user: SessionUser;
	credit?: CreditInfo;
}

// Module 11 — Projects: a project groups a user's source photos/rooms; a
// session is one generation thread within it (forked by style-transfer,
// continued in place by every other generation kind). No userId/pubkey field
// is ever included — ownership is enforced server-side, never shown.

export interface ProjectRecord {
	id: string;
	title: string;
	createdAt: number;
	updatedAt: number;
}

export interface ProjectsResponse {
	projects: ProjectRecord[];
	pagination: {
		offset: number;
		size: number;
		hasMore: boolean;
	};
}

export interface CreateProjectRequest {
	title: string;
}

export interface RenameProjectRequest {
	title: string;
}

// Extends GeneratedImageRecord with the cost/balance data a project session's
// own owner is allowed to see. Optional — not just possibly absent but
// deliberately withheld — because ProjectDetailResponse (via
// ProjectSessionRecord) is shared with the public /share/[token] viewer,
// which strips both fields (see that route's own explicit field whitelist);
// only the authenticated GET /api/projects/[id] response ever populates them.
export interface SessionGenerationRecord extends GeneratedImageRecord {
	amount?: number;
	balanceAfter?: number;
}

export interface ProjectSessionRecord {
	id: string;
	title: string;
	parentSessionId: string | null;
	forkedFromGenerationId: string | null;
	createdAt: number;
	updatedAt: number;
	generations: SessionGenerationRecord[];
}

// GET /api/projects/[id] — a project's full session grid, each session's own
// generation timeline included (the session grid needs each session's latest
// generation for its thumbnail regardless, so this isn't paginated separately).
export interface ProjectDetailResponse {
	id: string;
	title: string;
	createdAt: number;
	updatedAt: number;
	// Whether an active (non-revoked) share link currently exists — never the
	// token itself, which the server only ever returns once, at issuance.
	shareActive: boolean;
	sessions: ProjectSessionRecord[];
}

export interface CreateSessionRequest {
	title?: string;
}

export interface CreateSessionResponse {
	id: string;
	title: string;
	createdAt: number;
	updatedAt: number;
}

export interface RenameSessionRequest {
	title: string;
}

// Deliberately not ProjectSessionRecord — a rename never touches lineage or
// generations, so echoing those back (necessarily empty/stale from this
// endpoint alone) would be misleading. Same minimal shape as
// CreateSessionResponse.
export interface RenameSessionResponse {
	id: string;
	title: string;
	createdAt: number;
	updatedAt: number;
}

// POST /api/projects/[id]/sessions/[sessionId]/fork — the style-transfer fork
// point: branches a new session off an existing one at a specific generation.
export interface ForkSessionRequest {
	forkedFromGenerationId: string;
	title?: string;
}

export interface ForkSessionResponse {
	id: string;
	title: string;
	parentSessionId: string;
	forkedFromGenerationId: string;
	createdAt: number;
	updatedAt: number;
}

// POST /api/projects/[id]/share — issuing a new token auto-revokes the
// project's prior active one (one active share link per project at a time).
export interface ShareTokenResponse {
	token: string;
}
