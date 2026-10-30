<!--
Copyright (c) 2026 Cadbos company. All rights reserved.

SPDX-License-Identifier: LicenseRef-Cadbos-BSL-1.1

Cadbos Interior Design AI is licensed under the Business Source License 1.1.
Access is limited to automated analysis tools for analysis of this repository.
This code is not open for contribution or usage except under a separate written
agreement with Cadbos company.

Commercial use in Interior Design & AEC Generative AI Services is prohibited
before the Change Date. See LICENSE for complete terms.
-->

<script lang="ts">
	import { tick } from 'svelte';
	import { goto } from '$app/navigation';
	import { CalendarDays, ChevronLeft, ChevronRight } from '@lucide/svelte';
	import { getLocale, t } from '$lib/i18n/index.svelte';
	import { logBoundaryError } from '$lib/utils';
	import { placeBelow } from '../popover-placement';
	import { localDateKey, localDay } from '../usage-day';

	interface Props {
		// The day shown, as an ISO date; null when no single day is.
		selected: string | null;
		// The page for a picked day.
		dayHref: (dateKey: string) => string;
	}

	let { selected, dayHref }: Props = $props();

	const POPOVER_MAX_WIDTH_REM = 19;
	// ISO 8601 weeks start on Monday, like the ISO dates the page shows.
	const FIRST_WEEKDAY = 1;
	const MONDAY = new Date(2026, 0, 5);

	let trigger: HTMLButtonElement | null = null;
	let placement = $state({ top: 0, left: 0, arrowLeft: 0 });
	let today = $state(localDateKey(Date.now()));
	let focused = $state(localDateKey(Date.now()));
	const shown = $derived(dateOf(focused));

	const popoverId = $props.id();

	function dateOf(dateKey: string): Date {
		const day = localDay(dateKey);
		return new Date(day === null ? Date.now() : day.from);
	}

	function shiftDay(dateKey: string, days: number): string {
		const date = dateOf(dateKey);
		return localDateKey(
			new Date(date.getFullYear(), date.getMonth(), date.getDate() + days).getTime()
		);
	}

	// The same day of another month, or that month's last day when it is shorter.
	function shiftMonth(dateKey: string, months: number): string {
		const date = dateOf(dateKey);
		const lastDay = new Date(date.getFullYear(), date.getMonth() + months + 1, 0).getDate();
		return localDateKey(
			new Date(
				date.getFullYear(),
				date.getMonth() + months,
				Math.min(date.getDate(), lastDay)
			).getTime()
		);
	}

	function latest(dateKey: string): string {
		return dateKey > today ? today : dateKey;
	}

	const weekdays = $derived(
		Array.from({ length: 7 }, (_, index) =>
			new Intl.DateTimeFormat(getLocale(), { weekday: 'short' }).format(
				new Date(MONDAY.getFullYear(), MONDAY.getMonth(), MONDAY.getDate() + index)
			)
		)
	);

	const monthTitle = $derived(
		new Intl.DateTimeFormat(getLocale(), { month: 'long', year: 'numeric' }).format(shown)
	);

	// The shown month as weeks of ISO dates, null where a week runs past it.
	const weeks = $derived.by(() => {
		const year = shown.getFullYear();
		const month = shown.getMonth();
		const lead = (new Date(year, month, 1).getDay() - FIRST_WEEKDAY + 7) % 7;
		const length = new Date(year, month + 1, 0).getDate();
		const cells: (string | null)[] = [
			...Array.from({ length: lead }, () => null),
			...Array.from({ length }, (_, index) =>
				localDateKey(new Date(year, month, index + 1).getTime())
			)
		];
		while (cells.length % 7 !== 0) cells.push(null);
		return Array.from({ length: cells.length / 7 }, (_, week) =>
			cells.slice(week * 7, week * 7 + 7)
		);
	});

	const canShowNextMonth = $derived(
		new Date(shown.getFullYear(), shown.getMonth() + 1, 1).getTime() <= dateOf(today).getTime()
	);

	function registerTrigger(node: HTMLButtonElement): () => void {
		trigger = node;
		return () => {
			trigger = null;
		};
	}

	function open(event: ToggleEvent): void {
		if (event.newState !== 'open' || !trigger) return;
		today = localDateKey(Date.now());
		focused = latest(selected ?? today);
		placement = placeBelow(trigger, POPOVER_MAX_WIDTH_REM, 'start');
	}

	async function focusDay(grid: HTMLElement, dateKey: string): Promise<void> {
		focused = latest(dateKey);
		await tick();
		grid.querySelector<HTMLButtonElement>(`[data-date="${focused}"]`)?.focus();
	}

	function onGridKeydown(event: KeyboardEvent & { currentTarget: HTMLElement }): void {
		const moves: Record<string, () => string> = {
			ArrowLeft: () => shiftDay(focused, -1),
			ArrowRight: () => shiftDay(focused, 1),
			ArrowUp: () => shiftDay(focused, -7),
			ArrowDown: () => shiftDay(focused, 7),
			PageUp: () => shiftMonth(focused, -1),
			PageDown: () => shiftMonth(focused, 1)
		};
		const move = moves[event.key];
		if (!move) return;
		event.preventDefault();
		void focusDay(event.currentTarget, move());
	}

	function pick(dateKey: string, popover: HTMLElement | null): void {
		popover?.hidePopover();
		goto(dayHref(dateKey), { noScroll: true }).catch((error: unknown) =>
			logBoundaryError('usageDayPicker.pick', error)
		);
	}
</script>

<button
	{@attach registerTrigger}
	type="button"
	class="day-trigger"
	popovertarget={popoverId}
	aria-haspopup="dialog"
>
	<CalendarDays size={16} strokeWidth={1.8} aria-hidden="true" />
	{selected ?? t('usage.byUser.pickDay')}
</button>
<div
	id={popoverId}
	popover="auto"
	role="dialog"
	aria-label={t('usage.calendar.label')}
	class="day-popover"
	style:top="{placement.top}px"
	style:left="{placement.left}px"
	onbeforetoggle={open}
>
	<div class="month-row">
		<button
			type="button"
			class="month-step"
			aria-label={t('usage.calendar.previousMonth')}
			title={t('usage.calendar.previousMonth')}
			onclick={() => (focused = shiftMonth(focused, -1))}
		>
			<ChevronLeft size={16} strokeWidth={1.8} aria-hidden="true" />
		</button>
		<span class="month-title" aria-live="polite">{monthTitle}</span>
		<button
			type="button"
			class="month-step"
			aria-label={t('usage.calendar.nextMonth')}
			title={t('usage.calendar.nextMonth')}
			disabled={!canShowNextMonth}
			onclick={() => (focused = latest(shiftMonth(focused, 1)))}
		>
			<ChevronRight size={16} strokeWidth={1.8} aria-hidden="true" />
		</button>
	</div>
	<table class="days" role="grid" onkeydown={onGridKeydown}>
		<thead>
			<tr>
				{#each weekdays as weekday (weekday)}
					<th scope="col">{weekday}</th>
				{/each}
			</tr>
		</thead>
		<tbody>
			{#each weeks as week, weekIndex (weekIndex)}
				<tr>
					{#each week as dateKey, dayIndex (dateKey ?? `blank-${weekIndex}-${dayIndex}`)}
						<td>
							{#if dateKey !== null}
								<button
									type="button"
									class={['day', { selected: dateKey === selected, today: dateKey === today }]}
									data-date={dateKey}
									tabindex={dateKey === focused ? 0 : -1}
									disabled={dateKey > today}
									aria-label={dateKey}
									aria-current={dateKey === selected ? 'date' : undefined}
									onclick={(event) =>
										pick(dateKey, event.currentTarget.closest<HTMLElement>('[popover]'))}
								>
									{Number(dateKey.slice(-2))}
								</button>
							{/if}
						</td>
					{/each}
				</tr>
			{/each}
		</tbody>
	</table>
</div>

<style>
	.day-trigger {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.375rem 0.75rem;
		border: 1px solid var(--color-accent);
		border-radius: var(--radius-sm);
		background: var(--color-accent);
		color: var(--color-accent-contrast);
		font: inherit;
		font-size: 0.875rem;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		cursor: pointer;
	}

	.day-trigger:hover {
		background: var(--color-accent-hover);
		border-color: var(--color-accent-hover);
	}

	.day-popover {
		position: absolute;
		inset: auto;
		box-sizing: border-box;
		width: min(19rem, calc(100vw - 2rem));
		margin: 0;
		padding: 0.75rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		background: var(--color-surface);
		color: var(--color-text);
		box-shadow: var(--shadow);
	}

	.month-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		margin-bottom: 0.5rem;
	}

	.month-title {
		display: inline-block;
		font-weight: 700;
	}

	/* "январь 2026 г." reads as a title; capitalizing every word would also turn "г." into "Г.". */
	.month-title::first-letter {
		text-transform: uppercase;
	}

	.month-step,
	.day {
		display: inline-grid;
		place-items: center;
		padding: 0;
		border: 1px solid transparent;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--color-text);
		font: inherit;
		cursor: pointer;
	}

	.month-step {
		width: 2rem;
		height: 2rem;
	}

	.days {
		width: 100%;
		border-collapse: collapse;
		table-layout: fixed;
	}

	.days th {
		padding: 0 0 0.25rem;
		color: var(--color-muted);
		font-size: 0.75rem;
		font-weight: 600;
		text-align: center;
	}

	.days td {
		padding: 1px;
		text-align: center;
	}

	.day {
		width: 100%;
		aspect-ratio: 1;
		font-size: 0.875rem;
		font-variant-numeric: tabular-nums;
	}

	.month-step:hover:not(:disabled),
	.day:hover:not(:disabled) {
		background: var(--color-surface-hover);
	}

	.day.today {
		border-color: var(--color-accent);
	}

	.day.selected {
		background: var(--color-accent);
		color: var(--color-accent-contrast);
		font-weight: 700;
	}

	.month-step:disabled,
	.day:disabled {
		cursor: default;
		opacity: 0.35;
	}
</style>
