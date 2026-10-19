import { describe, expect, it } from 'vitest';
import { applyMapping, cleanPayee, guessMapping, parseCsv, parseDate, parseOfx } from './bankImport';
import { addMonthsToDate } from './dates';
import { applyMoneyInput, parseMoney } from './money';
import { nextOccurrence } from './schedule';

describe('parseMoney', () => {
  it('reads the ways people type amounts', () => {
    expect(parseMoney('12')).toBe(1200);
    expect(parseMoney('$1,234.56')).toBe(123456);
    expect(parseMoney('(45.10)')).toBe(-4510);
    expect(parseMoney('-3.5')).toBe(-350);
    expect(parseMoney('.99')).toBe(99);
    expect(parseMoney('')).toBe(0);
    expect(parseMoney('abc')).toBeNull();
  });

  it('does arithmetic', () => {
    expect(parseMoney('45.10+12')).toBe(5710);
    expect(parseMoney('300/3')).toBe(10000);
    expect(parseMoney('(10+5)*2')).toBe(3000);
    expect(parseMoney('1/0')).toBeNull();
  });

  it('applies relative edits to an existing amount', () => {
    expect(applyMoneyInput(10000, '+25')).toBe(12500);
    expect(applyMoneyInput(10000, '-25')).toBe(7500);
    expect(applyMoneyInput(10000, '*2')).toBe(20000);
    expect(applyMoneyInput(10000, '40')).toBe(4000);
  });
});

describe('dates and schedules', () => {
  it('clamps month math to the end of short months', () => {
    expect(addMonthsToDate('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonthsToDate('2026-02-28', 1, 31)).toBe('2026-03-31');
  });

  it('keeps a month-end bill on the month end', () => {
    const s = { frequency: 'monthly' as const, anchorDate: '2026-01-31' };
    expect(nextOccurrence(s, '2026-01-31')).toBe('2026-02-28');
    expect(nextOccurrence(s, '2026-02-28')).toBe('2026-03-31');
  });

  it('handles twice a month', () => {
    const s = { frequency: 'twice-a-month' as const, anchorDate: '2026-01-01' };
    expect(nextOccurrence(s, '2026-01-01')).toBe('2026-01-15');
    expect(nextOccurrence(s, '2026-01-15')).toBe('2026-02-01');
  });
});

describe('bank files', () => {
  it('parses quoted CSV with embedded commas', () => {
    const rows = parseCsv('Date,Description,Amount\n10/01/2026,"Joe\'s Pizza, Inc",-23.50\r\n10/02/2026,PAYROLL,2000\n');
    expect(rows).toEqual([
      ['Date', 'Description', 'Amount'],
      ['10/01/2026', "Joe's Pizza, Inc", '-23.50'],
      ['10/02/2026', 'PAYROLL', '2000'],
    ]);
  });

  it('guesses columns for a typical bank export', () => {
    const rows = parseCsv('Posted Date,Payee,Memo,Amount\n10/01/2026,H-E-B #123,groceries,-82.14\n10/03/2026,ACME CORP PAYROLL,,2500.00\n');
    const mapping = guessMapping(rows);
    expect(mapping).toMatchObject({ date: 0, payee: 1, memo: 2, amount: 3, hasHeader: true, dateFormat: 'MDY' });
    const { rows: parsed } = applyMapping(rows, mapping);
    expect(parsed.map((r) => [r.date, r.payee, r.amount])).toEqual([
      ['2026-10-01', 'H-E-B #123', -8214],
      ['2026-10-03', 'Acme Corp Payroll', 250000],
    ]);
  });

  it('handles separate debit and credit columns', () => {
    const rows = parseCsv('Date,Description,Debit,Credit\n2026-10-01,Coffee,4.50,\n2026-10-02,Refund,,10.00\n');
    const mapping = guessMapping(rows);
    expect(mapping.amount).toBeNull();
    const { rows: parsed } = applyMapping(rows, mapping);
    expect(parsed.map((r) => r.amount)).toEqual([-450, 1000]);
  });

  it('reads day-first dates when month-first cannot work', () => {
    expect(parseDate('31/10/2026', 'DMY')).toBe('2026-10-31');
    expect(parseDate('31/10/2026', 'MDY')).toBeNull();
    expect(parseDate('1/5/26', 'MDY')).toBe('2026-01-05');
  });

  it('reads OFX statements', () => {
    const ofx = `OFXHEADER:100
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261005120000[-5:CDT]<TRNAMT>-42.17<FITID>abc123<NAME>SHELL OIL 5744<MEMO>FUEL
</STMTTRN>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261006<TRNAMT>1500.00<FITID>abc124<NAME>DIRECT DEP
</STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;
    const rows = parseOfx(ofx);
    expect(rows).toEqual([
      { date: '2026-10-05', payee: 'Shell Oil 5744', memo: 'FUEL', amount: -4217, importId: 'ofx:abc123' },
      { date: '2026-10-06', payee: 'Direct Dep', memo: '', amount: 150000, importId: 'ofx:abc124' },
    ]);
  });

  it('tidies shouting payees but leaves mixed case alone', () => {
    expect(cleanPayee('  WHOLE FOODS   MKT ')).toBe('Whole Foods Mkt');
    expect(cleanPayee('iTunes Store')).toBe('iTunes Store');
  });
});
