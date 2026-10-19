import type { ISODate, Month } from './types';

const pad = (n: number) => String(n).padStart(2, '0');

export function toISODate(d: Date): ISODate {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function today(): ISODate {
  return toISODate(new Date());
}

export function monthOf(date: ISODate): Month {
  return date.slice(0, 7);
}

export function currentMonth(): Month {
  return monthOf(today());
}

export function parseISODate(date: ISODate): Date {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addMonths(month: Month, n: number): Month {
  const [y, m] = month.split('-').map(Number);
  const total = y * 12 + (m - 1) + n;
  return `${Math.floor(total / 12)}-${pad((total % 12) + 1)}`;
}

/** Whole months from `a` to `b` (positive when `b` is later). */
export function monthsBetween(a: Month, b: Month): number {
  const [ay, am] = a.split('-').map(Number);
  const [by, bm] = b.split('-').map(Number);
  return (by - ay) * 12 + (bm - am);
}

export function monthRange(from: Month, to: Month): Month[] {
  const out: Month[] = [];
  for (let m = from; m <= to; m = addMonths(m, 1)) out.push(m);
  return out;
}

export function daysInMonth(year: number, month1: number): number {
  return new Date(year, month1, 0).getDate();
}

export function addDays(date: ISODate, n: number): ISODate {
  const d = parseISODate(date);
  d.setDate(d.getDate() + n);
  return toISODate(d);
}

/** Adds months to a date, clamping to the end of shorter months (Jan 31 + 1 month = Feb 28). */
export function addMonthsToDate(date: ISODate, n: number, anchorDay?: number): ISODate {
  const [y, m, d] = date.split('-').map(Number);
  const target = addMonths(`${y}-${pad(m)}`, n);
  const [ty, tm] = target.split('-').map(Number);
  const day = Math.min(anchorDay ?? d, daysInMonth(ty, tm));
  return `${target}-${pad(day)}`;
}

export function daysBetween(a: ISODate, b: ISODate): number {
  const ms = parseISODate(b).getTime() - parseISODate(a).getTime();
  return Math.round(ms / 86_400_000);
}

export function lastDayOfMonth(month: Month): ISODate {
  const [y, m] = month.split('-').map(Number);
  return `${month}-${pad(daysInMonth(y, m))}`;
}

export function formatMonth(month: Month, style: 'long' | 'short' = 'long'): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', {
    month: style,
    year: 'numeric',
  });
}

export function formatMonthName(month: Month, style: 'long' | 'short' = 'short'): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: style });
}

export function formatDate(date: ISODate, withYear = true): string {
  return parseISODate(date).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(withYear ? { year: 'numeric' } : {}),
  });
}
