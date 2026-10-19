import { describe, expect, it } from 'vitest';
import { categoryStatus, computeBudget } from './budget';
import {
  addAccount,
  addCategory,
  addGroup,
  autoAssign,
  deleteCategories,
  emptyBudget,
  moveMoney,
  reconcile,
  saveTransaction,
  setAssigned,
  setTarget,
} from './ops';
import { READY_TO_ASSIGN, type BudgetState } from './types';

function setup() {
  let s = emptyBudget();
  const checking = addAccount(s, { name: 'Checking', type: 'checking', balance: 100_000, date: '2026-01-01' });
  s = checking.state;
  const group = addGroup(s, 'Everyday');
  s = group.state;
  const groceries = addCategory(s, group.id, 'Groceries');
  s = groceries.state;
  const dining = addCategory(s, group.id, 'Dining Out');
  s = dining.state;
  return { s, checking: checking.id, groceries: groceries.id, dining: dining.id, group: group.id };
}

function spend(s: BudgetState, accountId: string, date: string, amount: number, categoryId: string | null) {
  return saveTransaction(s, { accountId, date, payee: 'Store', memo: '', amount: -amount, categoryId }).state;
}

describe('Ready to Assign', () => {
  it('starts as the cash on hand and drops as money is assigned', () => {
    let { s, groceries } = setup();
    expect(computeBudget(s, '2026-01').get('2026-01').readyToAssign).toBe(100_000);
    s = setAssigned(s, '2026-01', groceries, 40_000);
    const jan = computeBudget(s, '2026-01').get('2026-01');
    expect(jan.readyToAssign).toBe(60_000);
    expect(jan.categories[groceries].available).toBe(40_000);
  });

  it('counts income only from the month it arrives', () => {
    let { s, checking } = setup();
    s = saveTransaction(s, {
      accountId: checking,
      date: '2026-02-15',
      payee: 'Employer',
      memo: '',
      amount: 250_000,
      categoryId: READY_TO_ASSIGN,
    }).state;
    const model = computeBudget(s, '2026-02');
    expect(model.get('2026-01').readyToAssign).toBe(100_000);
    expect(model.get('2026-02').readyToAssign).toBe(350_000);
    expect(model.get('2026-02').incomeThisMonth).toBe(250_000);
    expect(model.get('2026-02').leftOverFromLastMonth).toBe(100_000);
  });

  it('subtracts money assigned in future months', () => {
    let { s, groceries } = setup();
    s = setAssigned(s, '2026-03', groceries, 30_000);
    const model = computeBudget(s, '2026-01');
    expect(model.get('2026-01').readyToAssign).toBe(70_000);
    expect(model.get('2026-01').assignedInFuture).toBe(30_000);
    expect(model.get('2026-03').readyToAssign).toBe(70_000);
  });
});

describe('category balances', () => {
  it('rolls positive balances into the next month', () => {
    let { s, checking, groceries } = setup();
    s = setAssigned(s, '2026-01', groceries, 50_000);
    s = spend(s, checking, '2026-01-10', 20_000, groceries);
    const model = computeBudget(s, '2026-02');
    expect(model.get('2026-01').categories[groceries].available).toBe(30_000);
    expect(model.get('2026-02').categories[groceries].carryover).toBe(30_000);
    expect(model.get('2026-02').categories[groceries].available).toBe(30_000);
  });

  it('takes cash overspending out of next month’s Ready to Assign', () => {
    let { s, checking, groceries } = setup();
    s = setAssigned(s, '2026-01', groceries, 10_000);
    s = spend(s, checking, '2026-01-10', 15_000, groceries);
    const model = computeBudget(s, '2026-02');
    const jan = model.get('2026-01');
    expect(jan.categories[groceries].available).toBe(-5_000);
    expect(jan.categories[groceries].cashOverspent).toBe(5_000);
    expect(categoryStatus(jan.categories[groceries])).toBe('cash-overspent');
    expect(jan.readyToAssign).toBe(90_000);
    const feb = model.get('2026-02');
    expect(feb.categories[groceries].available).toBe(0);
    expect(feb.overspentLastMonth).toBe(5_000);
    expect(feb.readyToAssign).toBe(85_000);
  });

  it('covering overspending by moving money clears it', () => {
    let { s, checking, groceries, dining } = setup();
    s = setAssigned(s, '2026-01', groceries, 10_000);
    s = setAssigned(s, '2026-01', dining, 10_000);
    s = spend(s, checking, '2026-01-10', 15_000, groceries);
    s = moveMoney(s, '2026-01', dining, groceries, 5_000);
    const model = computeBudget(s, '2026-02');
    expect(model.get('2026-01').categories[groceries].available).toBe(0);
    expect(model.get('2026-01').categories[dining].available).toBe(5_000);
    expect(model.get('2026-02').overspentLastMonth).toBe(0);
    expect(model.get('2026-02').readyToAssign).toBe(80_000);
  });

  it('keeps total available plus Ready to Assign equal to cash when there are no cards', () => {
    let { s, checking, groceries, dining } = setup();
    s = setAssigned(s, '2026-01', groceries, 30_000);
    s = setAssigned(s, '2026-01', dining, 20_000);
    s = spend(s, checking, '2026-01-04', 12_345, groceries);
    s = spend(s, checking, '2026-01-09', 4_500, dining);
    const jan = computeBudget(s, '2026-01').get('2026-01');
    const cash = 100_000 - 12_345 - 4_500;
    expect(jan.readyToAssign + jan.totalAvailable).toBe(cash);
  });

  it('shows uncategorized spending in its own row', () => {
    let { s, checking } = setup();
    s = spend(s, checking, '2026-01-04', 2_000, null);
    const jan = computeBudget(s, '2026-01').get('2026-01');
    expect(jan.categories.uncategorized.activity).toBe(-2_000);
  });

  it('splits spread one purchase across categories', () => {
    let { s, checking, groceries, dining } = setup();
    s = saveTransaction(s, {
      accountId: checking,
      date: '2026-01-05',
      payee: 'Target',
      memo: '',
      amount: -9_000,
      categoryId: null,
      splits: [
        { id: 'x1', categoryId: groceries, amount: -6_000, memo: '' },
        { id: 'x2', categoryId: dining, amount: -3_000, memo: '' },
      ],
    }).state;
    const jan = computeBudget(s, '2026-01').get('2026-01');
    expect(jan.categories[groceries].activity).toBe(-6_000);
    expect(jan.categories[dining].activity).toBe(-3_000);
  });

  it('hands a deleted category’s money and history to its replacement', () => {
    let { s, checking, groceries, dining } = setup();
    s = setAssigned(s, '2026-01', dining, 10_000);
    s = setAssigned(s, '2026-01', groceries, 5_000);
    s = spend(s, checking, '2026-01-05', 3_000, dining);
    s = deleteCategories(s, [dining], groceries);
    const jan = computeBudget(s, '2026-01').get('2026-01');
    expect(jan.categories[groceries].assigned).toBe(15_000);
    expect(jan.categories[groceries].available).toBe(12_000);
    expect(jan.categories[dining]).toBeUndefined();
  });
});

describe('credit cards', () => {
  function withCard() {
    const base = setup();
    const card = addAccount(base.s, { name: 'Visa', type: 'credit', balance: 0, date: '2026-01-01' });
    const payment = card.state.categories.find((c) => c.creditAccountId === card.id)!;
    return { ...base, s: card.state, card: card.id, payment: payment.id };
  }

  it('creates a payment category for each card', () => {
    const { s, card } = withCard();
    const payment = s.categories.find((c) => c.creditAccountId === card);
    expect(payment?.name).toBe('Visa');
    expect(s.groups.find((g) => g.id === payment?.groupId)?.isCreditCardPayments).toBe(true);
  });

  it('moves funded card spending into the payment category', () => {
    let { s, card, groceries, payment } = withCard();
    s = setAssigned(s, '2026-01', groceries, 20_000);
    s = spend(s, card, '2026-01-03', 5_000, groceries);
    const jan = computeBudget(s, '2026-01').get('2026-01');
    expect(jan.categories[groceries].available).toBe(15_000);
    expect(jan.categories[payment].available).toBe(5_000);
    expect(jan.readyToAssign).toBe(80_000);
  });

  it('treats unfunded card spending as credit overspending, not a Ready to Assign hit', () => {
    let { s, card, groceries, payment } = withCard();
    s = setAssigned(s, '2026-01', groceries, 2_000);
    s = spend(s, card, '2026-01-03', 5_000, groceries);
    const model = computeBudget(s, '2026-02');
    const jan = model.get('2026-01');
    expect(jan.categories[groceries].available).toBe(-3_000);
    expect(jan.categories[groceries].creditOverspent).toBe(3_000);
    expect(jan.categories[groceries].cashOverspent).toBe(0);
    expect(categoryStatus(jan.categories[groceries])).toBe('credit-overspent');
    expect(jan.categories[payment].available).toBe(2_000);
    expect(model.get('2026-02').readyToAssign).toBe(98_000);
  });

  it('draws the payment category down when the card is paid', () => {
    let { s, checking, card, groceries, payment } = withCard();
    s = setAssigned(s, '2026-01', groceries, 20_000);
    s = spend(s, card, '2026-01-03', 5_000, groceries);
    s = saveTransaction(s, {
      accountId: checking,
      date: '2026-01-20',
      payee: '',
      memo: '',
      amount: -5_000,
      categoryId: null,
      transferAccountId: card,
    }).state;
    const jan = computeBudget(s, '2026-01').get('2026-01');
    expect(jan.categories[payment].available).toBe(0);
    expect(jan.readyToAssign).toBe(80_000);
    // The pair is linked: one transaction in each account.
    const pair = s.transactions.filter((t) => t.transferAccountId);
    expect(pair).toHaveLength(2);
    expect(pair.map((t) => t.amount).sort()).toEqual([-5_000, 5_000]);
  });

  it('leaves an opening card balance as debt without touching Ready to Assign', () => {
    const base = setup();
    const card = addAccount(base.s, { name: 'Amex', type: 'credit', balance: -50_000, date: '2026-01-01' });
    const jan = computeBudget(card.state, '2026-01').get('2026-01');
    expect(jan.readyToAssign).toBe(100_000);
  });
});

describe('targets', () => {
  it('asks for the monthly amount until it is assigned', () => {
    let { s, groceries } = setup();
    s = setTarget(s, groceries, { type: 'monthly', amount: 60_000, mode: 'set-aside' });
    s = setAssigned(s, '2026-01', groceries, 20_000);
    const jan = computeBudget(s, '2026-01').get('2026-01');
    expect(jan.categories[groceries].target?.needed).toBe(40_000);
    expect(jan.underfunded).toBe(40_000);
    expect(categoryStatus(jan.categories[groceries])).toBe('underfunded');
  });

  it('refill targets count last month’s leftover', () => {
    let { s, groceries } = setup();
    s = setTarget(s, groceries, { type: 'monthly', amount: 50_000, mode: 'refill' });
    s = setAssigned(s, '2026-01', groceries, 50_000);
    const feb = computeBudget(s, '2026-02').get('2026-02');
    expect(feb.categories[groceries].carryover).toBe(50_000);
    expect(feb.categories[groceries].target?.needed).toBe(0);
  });

  it('spreads a dated savings goal over the months left', () => {
    let { s, dining } = setup();
    s = setTarget(s, dining, { type: 'balance', amount: 120_000, by: '2026-12' });
    const jan = computeBudget(s, '2026-01').get('2026-01');
    expect(jan.categories[dining].target?.needed).toBe(10_000);
  });

  it('auto-assigns exactly what targets need', () => {
    let { s, groceries, dining } = setup();
    s = setTarget(s, groceries, { type: 'monthly', amount: 45_000, mode: 'set-aside' });
    s = setTarget(s, dining, { type: 'balance', amount: 20_000 });
    s = autoAssign(s, '2026-01', 'underfunded');
    const jan = computeBudget(s, '2026-01').get('2026-01');
    expect(jan.categories[groceries].assigned).toBe(45_000);
    expect(jan.categories[dining].assigned).toBe(20_000);
    expect(jan.underfunded).toBe(0);
    expect(jan.readyToAssign).toBe(35_000);
  });
});

describe('reconcile', () => {
  it('adds an adjustment for the difference and locks cleared transactions', () => {
    let { s, checking, groceries } = setup();
    s = spend(s, checking, '2026-01-04', 2_500, groceries);
    s = saveTransaction(s, { ...s.transactions[s.transactions.length - 1], cleared: 'cleared' }).state;
    s = reconcile(s, checking, 97_000, '2026-01-31');
    const adj = s.transactions.find((t) => t.payee === 'Reconciliation Balance Adjustment');
    expect(adj?.amount).toBe(-500);
    expect(s.transactions.filter((t) => t.accountId === checking).every((t) => t.cleared === 'reconciled')).toBe(true);
  });
});
