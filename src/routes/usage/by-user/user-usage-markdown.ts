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

import type {
	GenerationKindCount,
	UsageGenerationRecord,
	UserUsageRecord
} from '$lib/api/contract';
import { t, ti } from '$lib/i18n/index.svelte';
import {
	formatGenerationKind,
	formatUsageDay,
	formatUsageTimestamp,
	formatUsageValue
} from '../usage-format';

export interface UserUsageMarkdownInput {
	npub: string;
	// The local day the export covers; all time when null.
	dayStart: number | null;
	record: UserUsageRecord;
	generationKinds: GenerationKindCount[];
	// Only a day's export lists generations.
	generations: UsageGenerationRecord[] | null;
	// Image links are made absolute so the file renders them outside the app.
	origin: string;
}

// Keeps free text such as prompts inside its table cell and never lets it
// render as HTML, a link or a remote image in a Markdown preview.
function cell(value: string): string {
	return value
		.replaceAll('\\', '\\\\')
		.replaceAll('|', '\\|')
		.replace(/[[\]]/g, '\\$&')
		.replaceAll('<', '&lt;')
		.replace(/\r?\n/g, '<br>');
}

function table(headers: string[], alignments: ('left' | 'right')[], rows: string[][]): string {
	return [
		`| ${headers.map(cell).join(' | ')} |`,
		`| ${alignments.map((alignment) => (alignment === 'right' ? '---:' : '---')).join(' | ')} |`,
		...rows.map((row) => `| ${row.join(' | ')} |`)
	].join('\n');
}

// The angle-bracketed destination keeps a parenthesis in a filename from
// ending the link; `href` already encodes `<` and `>`.
function image(origin: string, url: string, alt: string): string {
	return `![${alt.replace(/[[\]]/g, '\\$&')}](<${new URL(url, origin).href}>)`;
}

function timestamp(value: number | null): string {
	return value === null ? t('usage.emptyValue') : formatUsageTimestamp(value);
}

export function buildUserUsageMarkdown(input: UserUsageMarkdownInput): string {
	const { record, dayStart } = input;
	const summary: [string, string][] = [
		[t('usage.column.balance'), formatUsageValue({ kind: 'currency', value: record.balance })],
		[
			t('usage.totals.deposits'),
			formatUsageValue({ kind: 'currency', value: record.totalDeposit })
		],
		[t('usage.totals.spend'), formatUsageValue({ kind: 'currency', value: record.totalSpend })],
		[t('usage.totals.projects'), formatUsageValue({ kind: 'count', value: record.projectCount })],
		[t('usage.totals.sessions'), formatUsageValue({ kind: 'count', value: record.sessionCount })],
		[
			t('usage.totals.generations'),
			formatUsageValue({ kind: 'count', value: record.generationCount })
		],
		[
			t('usage.totals.sources'),
			formatUsageValue({
				kind: 'countWithSize',
				value: record.sourceCount,
				bytes: record.sourceBytes
			})
		],
		[
			t('usage.totals.references'),
			formatUsageValue({
				kind: 'countWithSize',
				value: record.referenceCount,
				bytes: record.referenceBytes
			})
		],
		[t('usage.column.lastDepositAt'), timestamp(record.lastDepositAt)],
		[t('usage.column.latestSpendAt'), timestamp(record.latestSpendAt)]
	];

	const sections = [
		`# ${ti('usage.byUser.heading', { user: input.npub })}`,
		dayStart === null
			? t('usage.byUser.subtitle')
			: ti('usage.byUser.daySubtitle', { date: formatUsageDay(dayStart) }),
		`## ${t('usage.byUser.summary')}`,
		table(
			[t('usage.export.metric'), t('usage.export.value')],
			['left', 'right'],
			summary.map(([label, value]) => [cell(label), cell(value)])
		),
		`## ${t('usage.kinds.title')}`,
		input.generationKinds.length === 0
			? t('usage.kinds.empty')
			: table(
					[t('usage.kinds.column.kind'), t('usage.kinds.column.count')],
					['left', 'right'],
					input.generationKinds.map((entry) => [
						cell(formatGenerationKind(entry.kind)),
						cell(formatUsageValue({ kind: 'count', value: entry.count }))
					])
				)
	];

	if (input.generations !== null) {
		sections.push(
			`## ${t('usage.generations.title')}`,
			input.generations.length === 0
				? t('usage.generations.empty')
				: table(
						[
							t('usage.generations.column.id'),
							t('usage.generations.column.time'),
							t('usage.generations.column.kind'),
							t('usage.generations.column.prompt'),
							t('usage.generations.column.source'),
							t('usage.generations.column.result'),
							t('usage.generations.column.reference')
						],
						['left', 'left', 'left', 'left', 'left', 'left', 'left'],
						input.generations.map((generation) => [
							cell(generation.id),
							cell(formatUsageTimestamp(generation.createdAt)),
							cell(formatGenerationKind(generation.kind)),
							cell(generation.prompt || t('usage.emptyValue')),
							image(
								input.origin,
								generation.source.url,
								ti('usage.generations.sourceAlt', { id: generation.id })
							),
							image(
								input.origin,
								generation.result.url,
								ti('usage.generations.resultAlt', { id: generation.id })
							),
							generation.reference === null
								? t('usage.emptyValue')
								: image(
										input.origin,
										generation.reference.url,
										ti('usage.generations.referenceAlt', { id: generation.id })
									)
						])
					)
		);
	}

	return `${sections.join('\n\n')}\n`;
}
