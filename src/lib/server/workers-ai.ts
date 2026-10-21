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

import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { WorkersAiDailyUsage } from '$lib/api/contract';
import { getDb, type Database } from '$lib/server/db';

export const WORKERS_AI_MODEL = '@cf/qwen/qwen3-30b-a3b-fp8';

// Workers AI's free allocation: 10,000 Neurons per day, reset at 00:00 UTC
// (https://developers.cloudflare.com/workers-ai/platform/pricing/).
export const WORKERS_AI_DAILY_NEURON_LIMIT = 10_000;

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

// Workers AI's chat-completion shape for Qwen3; `usage.neurons` is what the
// call was billed, summed per day by recordWorkersAiUsage.
const chatCompletionSchema = z.object({
	choices: z.array(z.object({ message: z.object({ content: z.string().nullable() }) })).min(1),
	usage: z.object({ neurons: z.number().nonnegative().optional() }).optional()
});

// Not an AbortSignal passed to `ai.run`: the local dev platform proxy cannot
// serialize one across to workerd, so every call would fail there.
function withTimeout<T>(call: Promise<T>, timeoutMs: number): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<never>((_, reject) => {
		timer = setTimeout(() => reject(new WorkersAiError('timeout')), timeoutMs);
	});
	return Promise.race([call, timeout]).finally(() => clearTimeout(timer));
}

function utcDate(now: Date = new Date()): string {
	return now.toISOString().slice(0, 10);
}

async function recordWorkersAiUsage(
	platform: App.Platform | undefined,
	neurons: number | undefined
): Promise<void> {
	if (neurons === undefined) {
		console.warn(JSON.stringify({ event: 'workers_ai_usage_missing' }));
	}
	try {
		await getDb(platform).run(
			sql`INSERT INTO workers_ai_daily_usage (date, requests, neurons)
				VALUES (${utcDate()}, 1, ${neurons ?? 0})
				ON CONFLICT (date) DO UPDATE SET
					requests = requests + 1,
					neurons = neurons + excluded.neurons`
		);
	} catch (error) {
		console.error(
			JSON.stringify({
				event: 'workers_ai_usage_record_failed',
				error: error instanceof Error ? error.name : typeof error
			})
		);
	}
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
	await recordWorkersAiUsage(platform, parsed.success ? parsed.data.usage?.neurons : undefined);
	if (!parsed.success) throw new WorkersAiError('response');
	return parsed.data.choices[0].message.content ?? '';
}

export async function getWorkersAiDailyUsage(db: Database): Promise<WorkersAiDailyUsage> {
	const date = utcDate();
	const row = await db.get<{ requests: number; neurons: number }>(
		sql`SELECT requests, neurons FROM workers_ai_daily_usage WHERE date = ${date}`
	);
	return {
		date,
		requests: row?.requests ?? 0,
		neurons: row?.neurons ?? 0,
		neuronLimit: WORKERS_AI_DAILY_NEURON_LIMIT
	};
}
