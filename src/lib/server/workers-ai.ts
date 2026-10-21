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

export const WORKERS_AI_MODEL = '@cf/qwen/qwen3-30b-a3b-fp8';

export interface WorkersAiMessage {
	role: 'system' | 'user';
	content: string;
}

export class WorkersAiError extends Error {
	constructor(reason: 'unconfigured' | 'timeout' | 'response') {
		super(reason);
		this.name = 'WorkersAiError';
	}
}

// Workers AI's chat-completion shape for Qwen3.
const chatCompletionSchema = z.object({
	choices: z.array(z.object({ message: z.object({ content: z.string().nullable() }) })).min(1)
});

// Not an AbortSignal passed to `ai.run`: the local dev platform proxy cannot
// serialize one across to workerd, so every call would fail there. The race
// only stops waiting — the call itself still runs to completion and is billed,
// capped by its `max_tokens`.
function withTimeout<T>(call: Promise<T>, timeoutMs: number): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<never>((_, reject) => {
		timer = setTimeout(() => reject(new WorkersAiError('timeout')), timeoutMs);
	});
	return Promise.race([call, timeout]).finally(() => clearTimeout(timer));
}

export async function runWorkersAiChat(
	platform: App.Platform | undefined,
	request: { messages: WorkersAiMessage[]; maxTokens: number; timeoutMs: number }
): Promise<string> {
	const ai = platform?.env?.AI;
	if (!ai) throw new WorkersAiError('unconfigured');

	const output: unknown = await withTimeout(
		ai.run(WORKERS_AI_MODEL, {
			messages: request.messages,
			max_tokens: request.maxTokens,
			temperature: 0
		}),
		request.timeoutMs
	);
	const parsed = chatCompletionSchema.safeParse(output);
	if (!parsed.success) throw new WorkersAiError('response');
	return parsed.data.choices[0].message.content ?? '';
}
