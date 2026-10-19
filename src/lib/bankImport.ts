import { parseMoney } from './money';
import type { Cents, ISODate } from './types';

/*
 * Reads the files banks let you download: CSV in its many local dialects,
 * and OFX/QFX (the "Quicken" / "Money" download most US banks offer).
 */

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const delimiter = detectDelimiter(text);
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"' && field === '') {
      quoted = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some((f) => f.trim() !== '')) rows.push(row.map((f) => f.trim()));
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== '')) rows.push(row.map((f) => f.trim()));
  return rows;
}

function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const counts = [',', ';', '\t', '|'].map((d) => [d, firstLine.split(d).length - 1] as const);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ',';
}

export type DateFormat = 'YMD' | 'MDY' | 'DMY';

export const DATE_FORMAT_LABELS: Record<DateFormat, string> = {
  MDY: 'Month/Day/Year (10/31/2026)',
  DMY: 'Day/Month/Year (31/10/2026)',
  YMD: 'Year-Month-Day (2026-10-31)',
};

export function parseDate(raw: string, format: DateFormat): ISODate | null {
  const text = raw.trim().replace(/\s.*$/, '');
  // Compact bank formats: 20261031
  if (/^\d{8}$/.test(text)) return validDate(+text.slice(0, 4), +text.slice(4, 6), +text.slice(6, 8));
  const parts = text.split(/[-/.]/).map((p) => p.trim());
  if (parts.length !== 3 || parts.some((p) => !/^\d+$/.test(p))) return null;
  let [a, b, c] = parts.map(Number);
  if (parts[0].length === 4) return validDate(a, b, c);
  let year = c;
  if (parts[2].length <= 2) year = c + (c < 70 ? 2000 : 1900);
  if (format === 'DMY') [a, b] = [b, a];
  return validDate(year, a, b);
}

function validDate(y: number, m: number, d: number): ISODate | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(y, m - 1, d);
  if (date.getMonth() !== m - 1) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Picks the date format that reads every value in the column. */
export function guessDateFormat(values: string[]): DateFormat {
  const options: DateFormat[] = ['MDY', 'DMY', 'YMD'];
  for (const f of options) {
    if (values.length && values.every((v) => parseDate(v, f))) return f;
  }
  return 'MDY';
}

export interface ColumnMapping {
  date: number;
  payee: number;
  memo: number | null;
  /** Either one signed amount column, or separate outflow/inflow columns. */
  amount: number | null;
  outflow: number | null;
  inflow: number | null;
  /** Some card exports list purchases as positive numbers. */
  flipSign: boolean;
  dateFormat: DateFormat;
  hasHeader: boolean;
}

const find = (headers: string[], ...patterns: RegExp[]) => {
  for (const p of patterns) {
    const i = headers.findIndex((h) => p.test(h));
    if (i !== -1) return i;
  }
  return null;
};

export function guessMapping(rows: string[][]): ColumnMapping {
  const first = rows[0] ?? [];
  const hasHeader = first.length > 0 && first.every((f) => !/^[-$(]?\d/.test(f) || /[a-z]/i.test(f)) && first.some((f) => /[a-z]/i.test(f));
  const headers = hasHeader ? first.map((h) => h.toLowerCase()) : [];
  const body = hasHeader ? rows.slice(1) : rows;
  const sample = body.slice(0, 20);

  let date = find(headers, /^(transaction |posted |post )?date$/, /date/);
  if (date === null) date = columnWhere(sample, (v) => parseDate(v, 'MDY') !== null || parseDate(v, 'YMD') !== null) ?? 0;
  const payee = find(headers, /payee/, /^description$/, /description/, /merchant/, /^name$/, /details/) ?? pickTextColumn(sample, [date]);
  const memo = find(headers, /memo/, /note/, /reference/);
  let amount = find(headers, /^amount$/, /amount/);
  const outflow = find(headers, /debit/, /withdraw/, /outflow/, /^spent$/, /paid out/);
  const inflow = find(headers, /credit(?! card)/, /deposit/, /inflow/, /paid in/);
  if (outflow !== null && inflow !== null) amount = null;
  if (amount === null && (outflow === null || inflow === null)) {
    amount = columnWhere(sample, (v) => parseMoney(v) !== null && /\d/.test(v), [date]) ?? null;
  }
  const dateFormat = guessDateFormat(sample.map((r) => r[date!] ?? '').filter(Boolean));
  return {
    date: date!,
    payee: payee ?? 1,
    memo: memo !== null && memo !== payee ? memo : null,
    amount,
    outflow: amount === null ? outflow : null,
    inflow: amount === null ? inflow : null,
    flipSign: false,
    dateFormat,
    hasHeader,
  };
}

function columnWhere(rows: string[][], test: (v: string) => boolean, skip: number[] = []): number | null {
  const width = Math.max(0, ...rows.map((r) => r.length));
  for (let i = 0; i < width; i++) {
    if (skip.includes(i)) continue;
    const values = rows.map((r) => r[i] ?? '').filter(Boolean);
    if (values.length && values.every(test)) return i;
  }
  return null;
}

function pickTextColumn(rows: string[][], skip: number[]): number | null {
  const width = Math.max(0, ...rows.map((r) => r.length));
  let best: number | null = null;
  let bestLen = 0;
  for (let i = 0; i < width; i++) {
    if (skip.includes(i)) continue;
    const values = rows.map((r) => r[i] ?? '');
    if (values.some((v) => parseMoney(v) !== null && v !== '')) continue;
    const len = values.reduce((a, v) => a + v.length, 0);
    if (len > bestLen) {
      best = i;
      bestLen = len;
    }
  }
  return best;
}

export interface ParsedRow {
  date: ISODate;
  payee: string;
  memo: string;
  amount: Cents;
  importId: string;
}

export interface ParseResult {
  rows: ParsedRow[];
  skipped: number;
}

export function applyMapping(rows: string[][], m: ColumnMapping): ParseResult {
  const body = m.hasHeader ? rows.slice(1) : rows;
  const out: ParsedRow[] = [];
  let skipped = 0;
  const seen = new Map<string, number>();
  for (const r of body) {
    const date = parseDate(r[m.date] ?? '', m.dateFormat);
    let amount: Cents | null = null;
    if (m.amount !== null) amount = parseMoney(r[m.amount] ?? '');
    else {
      const out_ = m.outflow !== null ? parseMoney(r[m.outflow] ?? '') : 0;
      const in_ = m.inflow !== null ? parseMoney(r[m.inflow] ?? '') : 0;
      if (out_ !== null && in_ !== null) amount = Math.abs(in_) - Math.abs(out_);
    }
    if (!date || amount === null) {
      skipped++;
      continue;
    }
    if (m.flipSign) amount = -amount;
    const payee = cleanPayee(r[m.payee] ?? '');
    const memo = m.memo !== null ? (r[m.memo] ?? '').trim() : '';
    // Identical rows on the same day are legitimately separate purchases; number them.
    const base = `${date}|${amount}|${payee.toLowerCase()}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    out.push({ date, payee, memo, amount, importId: `csv:${hash(base)}:${n}` });
  }
  return { rows: out, skipped };
}

/** Tidies the shouty, padded descriptions banks use: "  AMAZON.COM*AB12  " -> "Amazon.com*ab12". */
export function cleanPayee(raw: string): string {
  const text = raw.replace(/\s+/g, ' ').trim();
  if (text && text === text.toUpperCase() && /[A-Z]/.test(text)) {
    return text.toLowerCase().replace(/(^|[\s&/-])([a-z])/g, (_, p, c) => p + c.toUpperCase());
  }
  return text;
}

export function isOfx(text: string): boolean {
  return /<OFX>|OFXHEADER/i.test(text.slice(0, 2000));
}

/** Pulls transactions out of an OFX/QFX statement (SGML or XML flavor). */
export function parseOfx(text: string): ParsedRow[] {
  const out: ParsedRow[] = [];
  const blocks = text.split(/<STMTTRN>/i).slice(1);
  for (const raw of blocks) {
    const block = raw.split(/<\/STMTTRN>/i)[0];
    const tag = (name: string) => {
      const m = new RegExp(`<${name}>([^<\\r\\n]*)`, 'i').exec(block);
      return m ? decodeEntities(m[1].trim()) : '';
    };
    const dt = tag('DTPOSTED') || tag('DTUSER');
    const date = parseDate(dt.slice(0, 8), 'YMD');
    const amount = parseMoney(tag('TRNAMT'));
    if (!date || amount === null) continue;
    const name = tag('NAME') || tag('PAYEE');
    const memo = tag('MEMO');
    const fitid = tag('FITID');
    out.push({
      date,
      payee: cleanPayee(name || memo),
      memo: name ? memo : '',
      amount,
      importId: fitid ? `ofx:${fitid}` : `ofx:${hash(`${date}|${amount}|${name}`)}`,
    });
  }
  return out;
}

function decodeEntities(s: string): string {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}

function hash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}
