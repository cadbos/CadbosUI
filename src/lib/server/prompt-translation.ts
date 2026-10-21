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

// archAI follows English prompts far better than Russian ones (issue #260),
// so Create translates a Russian prompt through Workers AI first, pinning the
// glossary's wording for terms archAI misreads. Translation is best-effort:
// it resolves to null when the prompt needs none or translation fails (the
// failure is logged), and the caller then sends the original prompt, so
// Create keeps working without Workers AI.

import { matchPromptGlossary } from '$lib/server/prompt-glossary';
import { runWorkersAiChat, WorkersAiError } from '$lib/server/workers-ai';

const TRANSLATION_TIMEOUT_MS = 10_000;
const MAX_OUTPUT_TOKENS = 400;
const CYRILLIC = /[Ѐ-ӿ]/;

const SYSTEM_PROMPT = [
	'You translate interior design requests from Russian into English prompts for an image generation model.',
	'Output only the English translation: no quotes, no notes, no explanations.',
	'Keep every detail of the request, including the room type and every listed item.',
	'When a glossary is given, replace each Russian term with its full English phrase from the glossary,',
	'copied verbatim including every word after commas and colons. Never shorten a glossary phrase.'
].join(' ');

type TranslationFailure = 'empty' | 'cyrillic' | 'too_long';

function userMessage(prompt: string): string {
	const glossary = matchPromptGlossary(prompt).map(({ term, english }) => `${term} = ${english}`);
	const glossaryBlock = glossary.length > 0 ? `Glossary:\n${glossary.join('\n')}\n\n` : '';
	// `/no_think` turns off Qwen3's reasoning pass: it only adds output tokens.
	return `${glossaryBlock}Text:\n${prompt}\n/no_think`;
}

function cleaned(output: string): string {
	return output
		.replace(/<think>[\s\S]*?<\/think>/g, '')
		.trim()
		.replace(/^["«“](.*)["»”]$/s, '$1')
		.trim();
}

function failure(prompt: string, translation: string): TranslationFailure | null {
	if (!translation) return 'empty';
	if (CYRILLIC.test(translation)) return 'cyrillic';
	if (translation.length > prompt.length * 4 + 400) return 'too_long';
	return null;
}

function errorKind(error: unknown): string {
	if (error instanceof WorkersAiError) return error.message;
	return error instanceof Error ? error.name : typeof error;
}

export async function translateCreatePrompt(
	platform: App.Platform | undefined,
	prompt: string
): Promise<string | null> {
	if (!CYRILLIC.test(prompt)) return null;

	try {
		const translation = cleaned(
			await runWorkersAiChat(platform, {
				messages: [
					{ role: 'system', content: SYSTEM_PROMPT },
					{ role: 'user', content: userMessage(prompt) }
				],
				maxTokens: MAX_OUTPUT_TOKENS,
				timeoutMs: TRANSLATION_TIMEOUT_MS
			})
		);
		const reason = failure(prompt, translation);
		if (reason) {
			console.error(JSON.stringify({ event: 'prompt_translation_rejected', reason }));
			return null;
		}
		return translation;
	} catch (error) {
		console.error(JSON.stringify({ event: 'prompt_translation_failed', error: errorKind(error) }));
		return null;
	}
}
