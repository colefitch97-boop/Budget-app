import { describe, expect, it } from 'vitest';
import { computeBudget } from './budget';
import {
  addAccount,
  deleteTransactions,
  emptyBudget,
  enterDueScheduled,
  importTransactions,
  isDuplicate,
  saveScheduled,
  saveTransaction,
  setAssigned,
} from './ops';
import { buildSampleBudget } from './sample';
import { fromShards, toShards } from './storage';
import { READY_TO_ASSIGN } from './types';

function twoAccounts() {
  let s = emptyBudget();
  const a = addAccount(s, { name: 'Checking', type: 'checking', balance: 50_000, date: '2026-01-01' });
  s = a.state;
  const b = addAccount(s, { name: 'Savings', type: 'savings', balance: 0, date: '2026-01-01' });
  return { s: b.state, checking: a.id, savings: b.id };
}

describe('transfers', () => {
  it('keeps both sides in step when one is edited, and removes both on delete', () => {
    let { s, checking, savings } = twoAccounts();
    const r = saveTransaction(s, { accountId: checking, date: '2026-01-05', payee: '', memo: '', amount: -10_000, categoryId: null, transferAccountId: savings });
    s = r.state;
    const pair = s.transactions.find((t) => t.accountId === savings && t.transferId === r.id)!;
    expect(pair.amount).toBe(10_000);
    // Edit from the savings side.
    s = saveTransaction(s, { id: pair.id, accountId: savings, date: '2026-01-06', payee: '', memo: 'moved', amount: 12_500, categoryId: null, transferAccountId: checking }).state;
    const main = s.transactions.find((t) => t.id === r.id)!;
    expect(main.amount).toBe(-12_500);
    expect(main.date).toBe('2026-01-06');
    s = deleteTransactions(s, [r.id]);
    expect(s.transactions.filter((t) => t.transferAccountId)).toHaveLength(0);
  });

  it('turning a transfer into an expense removes the other side', () => {
    let { s, checking, savings } = twoAccounts();
    const r = saveTransaction(s, { accountId: checking, date: '2026-01-05', payee: '', memo: '', amount: -10_000, categoryId: null, transferAccountId: savings });
    s = saveTransaction(r.state, { id: r.id, accountId: checking, date: '2026-01-05', payee: 'Store', memo: '', amount: -10_000, categoryId: null }).state;
    expect(s.transactions.filter((t) => t.accountId === savings && t.amount !== 0)).toHaveLength(0);
  });
});

describe('scheduled transactions', () => {
  it('enters everything that has come due and moves to the next date', () => {
    let { s, checking } = twoAccounts();
    s = saveScheduled(s, {
      accountId: checking,
      payee: 'Landlord',
      memo: '',
      amount: -150_000,
      categoryId: null,
      frequency: 'monthly',
      nextDate: '2026-01-31',
    });
    s = enterDueScheduled(s, '2026-04-02');
    const rent = s.transactions.filter((t) => t.payee === 'Landlord').map((t) => t.date);
    expect(rent).toEqual(['2026-01-31', '2026-02-28', '2026-03-31']);
    expect(s.scheduled[0].nextDate).toBe('2026-04-30');
  });

  it('removes a one-off schedule once entered', () => {
    let { s, checking } = twoAccounts();
    s = saveScheduled(s, { accountId: checking, payee: 'Dentist', memo: '', amount: -9_000, categoryId: null, frequency: 'once', nextDate: '2026-02-10' });
    s = enterDueScheduled(s, '2026-02-10');
    expect(s.scheduled).toHaveLength(0);
    expect(s.transactions.some((t) => t.payee === 'Dentist')).toBe(true);
  });
});

describe('importing', () => {
  it('skips rows that are already in the account', () => {
    let { s, checking } = twoAccounts();
    const row = { date: '2026-01-09', payee: 'Coffee', memo: '', amount: -450, importId: 'ofx:1', categoryId: null };
    s = importTransactions(s, checking, [row]);
    expect(isDuplicate(s, checking, row)).toBe(true);
    expect(isDuplicate(s, checking, { ...row, importId: 'ofx:2', date: '2026-01-10' })).toBe(false);
  });
});

describe('Ready to Assign across months', () => {
  it('does not show past months negative when a later month spends its own income', () => {
    let { s, checking } = twoAccounts();
    const cat = 'c-test';
    s = { ...s, groups: [{ id: 'g', name: 'G' }], categories: [{ id: cat, groupId: 'g', name: 'Rent', hidden: false, note: '' }] };
    s = saveTransaction(s, { accountId: checking, date: '2026-02-01', payee: 'Job', memo: '', amount: 100_000, categoryId: READY_TO_ASSIGN }).state;
    s = setAssigned(s, '2026-02', cat, 120_000);
    const model = computeBudget(s, '2026-02');
    expect(model.get('2026-01').readyToAssign).toBe(30_000);
    expect(model.get('2026-01').assignedInFuture).toBe(20_000);
    expect(model.get('2026-02').readyToAssign).toBe(30_000);
  });
});

describe('storage shards', () => {
  it('round-trips a budget through per-month documents', () => {
    const s = buildSampleBudget('2026-10-19');
    const shards = toShards(s);
    expect(Object.keys(shards)).toContain('meta');
    expect(Object.keys(shards).filter((k) => k.startsWith('m:')).length).toBeGreaterThanOrEqual(3);
    const back = fromShards(JSON.parse(JSON.stringify(shards)))!;
    expect(back.transactions).toHaveLength(s.transactions.length);
    expect(back.assigned).toEqual(s.assigned);
    expect(computeBudget(back, '2026-10').get('2026-10').readyToAssign).toBe(computeBudget(s, '2026-10').get('2026-10').readyToAssign);
    for (const shard of Object.values(shards)) expect(JSON.stringify(shard).length).toBeLessThan(256 * 1024);
  });
});
