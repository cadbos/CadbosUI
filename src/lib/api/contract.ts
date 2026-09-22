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

export const SCENE_TYPES = ['interior', 'exterior'] as const;

export type SceneType = (typeof SCENE_TYPES)[number];

export const IMAGE_SOURCE_MODES = ['room-photo', 'current-result'] as const;

export type ImageSourceMode = (typeof IMAGE_SOURCE_MODES)[number];

export interface ManagedImageInput {
	mediaKey: string;
	mime?: string;
	size?: number;
	dimensions?: [number, number];
}

export interface StylePresetImageInput {
	stylePresetId: string;
	url: string;
	mime?: string;
}

export type ImageInput = ManagedImageInput | StylePresetImageInput;

export interface PromptFragment {
	id: string;
	label?: string;
	text: string;
	order: number;
}

// The full set of editable form fields for a single generation call, captured
// client-side (RequestState#captureFormSnapshot) at submit time and persisted
// alongside the resulting `generations`/`*_jobs` row so a past generation can
// later be reopened with its exact settings restored — not just its image.
// Defined here (not in $lib/state/request.svelte.ts) so both the client store
// and the server-side request schemas (src/lib/server/api.ts) share one shape
// without the server depending on Svelte-only modules.
export interface RequestFormSnapshot {
	promptFragments: PromptFragment[];
	promptOverride: string | null;
	editPrompt: string;
	addObjectPresetId: string | null;
	removeObjectText: string;
	outputFormat: OutputFormat;
	sceneType: SceneType;
	styleTransferPrompt: string;
	styleTransferStrength: number;
	styleNegativePrompt: string;
	styleSourceMode: ImageSourceMode;
	styleReferenceImage?: ImageInput;
	objectReplacementObject: string;
	objectReplacementSourceMode: ImageSourceMode;
	objectReplacementScale: number;
	objectReferenceImage?: ImageInput;
	textureReplacementSurface: string;
	textureReplacementSourceMode: ImageSourceMode;
	textureReplacementMasked: boolean;
	textureReferenceImage?: ImageInput;
	textureMaskImage?: ImageInput;
	textureMaskSourceKey?: string;
	lightSettingsPresetIds: string[];
	lightSettingsInstruction: string;
}

export interface MediaAccess {
	key: string;
	url: string;
}

export const DEFAULT_UPLOADS_BUCKET_NAME = 'cadbos-uploads';

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
				s3: serviceHealthSchema
			})
			.strict()
	})
	.strict();

export type HealthServiceStatus = z.infer<typeof healthServiceStatusSchema>;
export type ServiceHealth = z.infer<typeof serviceHealthSchema>;
export type NostrHealth = z.infer<typeof nostrHealthSchema>;
export type HealthSnapshot = z.infer<typeof healthSnapshotSchema>;

// POST /api/uploads → managed image identity plus temporary read access.
export const uploadResultSchema = z
	.object({
		image: z
			.object({
				key: z.string().min(1),
				url: z.url()
			})
			.strict(),
		mime: z.string().min(1),
		size: z.number().nonnegative(),
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
	imageKey: string;
	prompt: string;
	outputFormat: OutputFormat;
	// The project session this generation attaches to (Module 11) — the server
	// verifies ownership before charging or calling the render provider.
	sessionId: string;
	// The full form state that produced this call (RequestState#captureFormSnapshot),
	// persisted alongside the resulting generation so it can be reopened later
	// with its exact settings restored — see migrations/0018.
	formSnapshot?: RequestFormSnapshot;
}

// POST /api/edit — edit by prompt via the Flux Kontext ComfyUI workflow
// (freeform / add-object / remove-object tools), async job — see
// EditJobResponse.
export interface EditRequest {
	imageKey: string;
	prompt: string;
	sessionId: string;
	formSnapshot?: RequestFormSnapshot;
}

export interface EditProcessingResponse {
	id: string;
	status: 'processing';
}

export interface EditCompletedResponse {
	id: string;
	status: 'completed';
	output: MediaAccess;
	cost: number;
	balance: number;
}

export interface EditFailedResponse {
	id: string;
	status: 'failed';
	error: { code: string; message: string };
}

export type EditJobResponse = EditProcessingResponse | EditCompletedResponse | EditFailedResponse;

// POST /api/style-transfer — apply a reference image's style to a source image.
export interface StyleTransferRequest {
	imageKey: string;
	referenceImageKey?: string;
	stylePresetId?: string;
	outputFormat: OutputFormat;
	prompt?: string;
	negativePrompt?: string;
	styleTransferStrength?: number;
	sessionId: string;
	formSnapshot?: RequestFormSnapshot;
}

// POST /api/upscale — upscale an existing render/edit result to 4K.
export interface UpscaleRequest {
	imageKey: string;
	outputFormat?: OutputFormat;
	sessionId: string;
}

export interface ObjectReplacementRequest {
	imageKey: string;
	referenceImageKey: string;
	replacementObject: string;
	sessionId: string;
	formSnapshot?: RequestFormSnapshot;
}

export interface ObjectReplacementProcessingResponse {
	id: string;
	status: 'processing';
}

export interface ObjectReplacementCompletedResponse {
	id: string;
	status: 'completed';
	output: MediaAccess;
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
	imageKey: string;
	instruction: string;
	sessionId: string;
	formSnapshot?: RequestFormSnapshot;
}

export interface LightSettingsProcessingResponse {
	id: string;
	status: 'processing';
}

export interface LightSettingsCompletedResponse {
	id: string;
	status: 'completed';
	output: MediaAccess;
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
	imageKey: string;
	referenceImageKey: string;
	replacementSurface: string;
	sessionId: string;
	formSnapshot?: RequestFormSnapshot;
}

export interface MaskedTextureReplacementRequest {
	imageKey: string;
	referenceImageKey: string;
	maskImageKey: string;
	sessionId: string;
	formSnapshot?: RequestFormSnapshot;
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
	output: MediaAccess;
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

// Normalized response for image-generation endpoints. Provider outputs are
// mirrored to managed storage before temporary access is issued. `balance` is the caller's own
// remaining approved-account balance after this call — never archAI's raw
// (shared) account balance, which the client must never see.
export interface RenderResponse {
	output: MediaAccess;
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
	image: MediaAccess;
	source: MediaAccess;
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

// GET /api/generated-images/[id] — the exact settings a past generation was
// submitted with (migrations/0018), for restoring them into the current form.
// `formSnapshot` is null both for generations recorded before that column
// existed and for `upscale` (nothing to restore). `image` is this
// generation's own result — what restoring should show as the current
// working photo, the same field name/meaning as GeneratedImageRecord['image']
// — while `source` is what it was generated from, kept for display/reference.
// `media` resolves every media key the snapshot's reference/mask images point
// to (plus `image` and `source` themselves), for the client to register with
// its media-access cache before applying the snapshot — restoring settings
// whose reference image can no longer be resolved degrades to
// `formSnapshot: null` rather than failing.
export interface GeneratedImageDetailResponse {
	id: string;
	prompt: string;
	kind: GenerationKind;
	createdAt: number;
	image: MediaAccess;
	source: MediaAccess;
	formSnapshot: RequestFormSnapshot | null;
	media: MediaAccess[];
}

// The subset of RequestFormSnapshot safe to hand to an unauthenticated viewer
// of a public /share/[token] link — every image-shaped field is stripped
// (mediaKey values aren't meant for public exposure, and the share viewer
// never renders reference-image thumbnails, only text settings), leaving the
// prompt/instruction/preset fields a visitor can actually read.
export type PublicFormSnapshot = Omit<
	RequestFormSnapshot,
	| 'styleReferenceImage'
	| 'objectReferenceImage'
	| 'textureReferenceImage'
	| 'textureMaskImage'
	| 'textureMaskSourceKey'
>;

// GET /api/share/[token]/generations/[id] — the text settings behind one
// generation in a shared project, fetched lazily when a visitor opens that
// generation's preview (not bundled into GET /api/share/[token], which can
// list many generations at once). `formSnapshot` is null for generations
// recorded before migrations/0018, for `upscale`, or if the stored snapshot
// no longer parses/validates.
export interface ShareGenerationDetailResponse {
	id: string;
	prompt: string;
	kind: GenerationKind;
	createdAt: number;
	formSnapshot: PublicFormSnapshot | null;
}

// GET /api/resources — distinct source photos the user has actually
// uploaded (one card per source media row). Rows whose source
// was a previous generation's own result rather than a fresh upload (edit,
// upscale, or any other call made with source mode 'current-result') are
// excluded, not shown as if they were uploads; see listDistinctSourceImages. Content-hash dedup still
// applies at *upload* time (findGenerationSourceByHash) to avoid storing
// duplicate objects. Read-only gallery: no delete in this iteration.
export interface ResourceImageRecord {
	image: MediaAccess;
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
	comfyuiUploadQueueSec: number;
	comfyuiQueueWaitSec: number;
	comfyuiExecutionSec: number;
	comfyuiDownloadSec: number;
	comfyuiReuploadSec: number;
	archaiRenderSec: number;
	archaiDownloadSec: number;
	archaiReuploadSec: number;
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
