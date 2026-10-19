import { addDays, addMonthsToDate, daysInMonth } from './dates';
import type { Frequency, ISODate, ScheduledTransaction } from './types';

export const FREQUENCY_LABELS: Record<Frequency, string> = {
  once: 'Once',
  weekly: 'Every week',
  'every-2-weeks': 'Every other week',
  'twice-a-month': 'Twice a month (1st and 15th)',
  monthly: 'Every month',
  'every-3-months': 'Every 3 months',
  'every-6-months': 'Every 6 months',
  yearly: 'Every year',
};

/** The date after `date` for a repeating schedule, or null for a one-off. */
export function nextOccurrence(s: Pick<ScheduledTransaction, 'frequency' | 'anchorDate'>, date: ISODate): ISODate | null {
  const anchorDay = Number(s.anchorDate.slice(8, 10));
  switch (s.frequency) {
    case 'once':
      return null;
    case 'weekly':
      return addDays(date, 7);
    case 'every-2-weeks':
      return addDays(date, 14);
    case 'twice-a-month': {
      const day = Number(date.slice(8, 10));
      if (day < 15) return `${date.slice(0, 8)}15`;
      return addMonthsToDate(`${date.slice(0, 8)}01`, 1);
    }
    case 'monthly':
      return addMonthsToDate(date, 1, anchorDay);
    case 'every-3-months':
      return addMonthsToDate(date, 3, anchorDay);
    case 'every-6-months':
      return addMonthsToDate(date, 6, anchorDay);
    case 'yearly':
      return addMonthsToDate(date, 12, anchorDay);
  }
}

/** Every date a schedule falls on, from its next date through `until`. */
export function occurrencesThrough(s: ScheduledTransaction, until: ISODate, max = 400): ISODate[] {
  const out: ISODate[] = [];
  let d: ISODate | null = s.nextDate;
  while (d && d <= until && out.length < max) {
    out.push(d);
    d = nextOccurrence(s, d);
  }
  return out;
}

export function isValidDay(date: ISODate): boolean {
  const [y, m, d] = date.split('-').map(Number);
  return m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
}
