import type { Cents } from './types';

const formatters = new Map<string, Intl.NumberFormat>();

function formatter(currency: string, compact: boolean): Intl.NumberFormat {
  const key = `${currency}:${compact}`;
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      ...(compact
        ? { notation: 'compact', maximumFractionDigits: 1 }
        : { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    });
    formatters.set(key, f);
  }
  return f;
}

let activeCurrency = 'USD';

export function setCurrency(currency: string) {
  activeCurrency = currency;
}

export function getCurrency(): string {
  return activeCurrency;
}

export function formatMoney(cents: Cents, opts: { compact?: boolean; signed?: boolean } = {}): string {
  const text = formatter(activeCurrency, !!opts.compact).format(cents / 100);
  if (opts.signed && cents > 0) return `+${text}`;
  // Avoid "-$0.00" from negative zero.
  return Object.is(cents, -0) ? formatter(activeCurrency, !!opts.compact).format(0) : text;
}

/** Plain number for an input box: 1234.5 -> "1,234.50"; zero -> "". */
export function formatPlain(cents: Cents, blankZero = true): string {
  if (cents === 0 && blankZero) return '';
  return (cents / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Parses what someone typed into a money field. Accepts currency symbols,
 * thousands separators, parentheses for negatives and simple arithmetic
 * ("45.10+12", "300/3"). Returns null when the text is not a number.
 */
export function parseMoney(input: string): Cents | null {
  let text = input.trim();
  if (!text) return 0;
  let negate = false;
  if (/^\(.*\)$/.test(text)) {
    negate = true;
    text = text.slice(1, -1);
  }
  text = text.replace(/[$€£,\s]|CA\$|A\$|MX\$/g, '');
  if (!/^[-+*/().\d]+$/.test(text)) return null;
  const value = evaluate(text);
  if (value === null || !Number.isFinite(value)) return null;
  const cents = Math.round(value * 100);
  return negate ? -cents : cents;
}

/**
 * Applies what someone typed into an existing amount: "+20" adds to it,
 * "-20" subtracts from it, "*2" doubles it, anything else replaces it.
 */
export function applyMoneyInput(current: Cents, input: string): Cents | null {
  const text = input.trim();
  const op = text[0];
  if ((op === '+' || op === '-' || op === '*' || op === '/') && text.length > 1) {
    const rest = parseMoney(text.slice(1));
    if (rest === null) return null;
    if (op === '+') return current + rest;
    if (op === '-') return current - rest;
    if (op === '*') return Math.round((current * rest) / 100);
    return rest === 0 ? null : Math.round((current * 100) / rest);
  }
  return parseMoney(text);
}

/** A tiny recursive-descent evaluator for + - * / and parentheses. */
function evaluate(src: string): number | null {
  let i = 0;
  const peek = () => src[i];
  function number(): number | null {
    if (peek() === '(') {
      i++;
      const v = expr();
      if (peek() !== ')') return null;
      i++;
      return v;
    }
    if (peek() === '-' || peek() === '+') {
      const sign = src[i++] === '-' ? -1 : 1;
      const v = number();
      return v === null ? null : sign * v;
    }
    const m = /^\d*\.?\d+|^\d+\.?/.exec(src.slice(i));
    if (!m) return null;
    i += m[0].length;
    return parseFloat(m[0]);
  }
  function term(): number | null {
    let v = number();
    while (v !== null && (peek() === '*' || peek() === '/')) {
      const op = src[i++];
      const r = number();
      if (r === null) return null;
      v = op === '*' ? v * r : v / r;
    }
    return v;
  }
  function expr(): number | null {
    let v = term();
    while (v !== null && (peek() === '+' || peek() === '-')) {
      const op = src[i++];
      const r = term();
      if (r === null) return null;
      v = op === '+' ? v + r : v - r;
    }
    return v;
  }
  const v = expr();
  return i === src.length ? v : null;
}
