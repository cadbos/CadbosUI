// Raw wire types generated from myarchitect.yaml (MyArchitectAI API v1.0.0).
// Used by the server proxy only — never imported by client bundles.

export type MaOutputFormat = 'webp' | 'jpg' | 'png' | 'avif';

// POST /v1/render/interior
export interface MaRenderInteriorInput {
	image: string; // uri, required
	outputFormat: MaOutputFormat; // required
	prompt?: string; // optional in spec; Cadbos always sends one
}

// POST /v1/edit-by-prompt
export interface MaEditByPromptInput {
	image: string; // uri, required — URL of the image to edit
	prompt: string; // required — natural-language instruction
}

// POST /v1/upscale-4k (post-MVP)
export interface MaUpscale4kInput {
	image: string; // uri, required
	outputFormat?: MaOutputFormat; // defaults to jpg if omitted
}

// POST /v1/text-to-image (out of MVP scope)
export interface MaTextToImageInput {
	prompt: string; // required
	outputFormat: 'png' | 'jpg' | 'webp'; // avif not supported
	outputHeight: number; // 128–2048
	outputWidth: number; // 128–2048
	negativePrompt?: string;
}

// POST /v1/auto-prompt (post-MVP)
export interface MaAutoPromptInput {
	image: string; // uri, required
}

// POST /v1/style-transfer (post-MVP)
export interface MaStyleTransferInput {
	image: string; // uri, required
	outputFormat: MaOutputFormat; // required
	referenceImage: string; // uri, required
	prompt?: string;
	negativePrompt?: string;
	styleTransferStrength?: number; // 0–1
}

// POST /v1/animate (out of MVP scope)
export interface MaAnimateInput {
	startFrameUrl: string; // uri, required
	prompt: string; // required
	endFrameUrl?: string; // uri
}

// Shared response for endpoints returning a URL array (render/interior, render/exterior, style-transfer)
export interface MaArrayGenerationResponse {
	output: string[]; // array of image URLs
	balance: number;
	cost: number;
}

// Shared response for endpoints returning a single URL (edit-by-prompt, upscale-4k, animate, text-to-image)
export interface MaSingleGenerationResponse {
	output: string; // single URL (or plain text for auto-prompt)
	balance: number;
	cost: number;
}

// /auto-prompt returns plain text in output, not a URL — distinct type for clarity
export interface MaAutoPromptResponse {
	output: string; // comma-separated prompt text, not a URL
	balance: number;
	cost: number;
}

// 400 error (invalid input or processing error)
export interface MaErrorResponse {
	error: string;
	balance: number;
	cost: number;
}

// 403 / 500 gateway error
export interface MaGatewayErrorResponse {
	message: string;
}
