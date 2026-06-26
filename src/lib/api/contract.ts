// Shared client↔server wire types (no secrets). The server proxy normalizes
// external-service responses to these shapes, so the client never depends on
// provider quirks. Dev mocks and real endpoints return exactly these types.

export type OutputFormat = 'webp' | 'jpg' | 'png' | 'avif';

// ── Request model types ──────────────────────────────────────────────────────

// A single uploaded image (same shape as UploadResult; kept separate to allow divergence).
export interface ImageInput {
	url: string;
	mime: string;
	size: number;
	dimensions?: [number, number];
}

// One segment of a free-text prompt; order defines concatenation sequence.
export interface PromptFragment {
	id: string;
	label?: string;
	text: string;
	order: number;
}

// UX category for an edit instruction; `type` is UI-only, `instruction` goes to the API.
export interface EditOperation {
	type: 'replace-object' | 'change-surface-color' | 'freeform';
	instruction: string;
}

// Result of a render or edit call stored as `currentRender` in the request model.
// `outputUrls` is an array to accommodate a future revision history (Д-16);
// in MVP it always holds exactly one URL.
export interface RenderResult {
	id: string;
	outputUrls: string[];
	cost: number;
	balance: number;
	parentId?: string; // groundwork for revision history (Д-16)
	editOp?: EditOperation;
	ts: number; // Unix ms
}

// ── Unified error body ───────────────────────────────────────────────────────

// HTTP 4xx/5xx body — no stack, paths, or internal ids.
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

export interface Quota {
	balanceOrLimit: number;
	usage: number;
	period: string;
}

// GET /auth/me → 401 when no session.
export interface MeResponse {
	user: SessionUser;
	quota: Quota;
}
