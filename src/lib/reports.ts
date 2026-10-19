import { accountBalances } from './budget';
import { addMonths, daysBetween, lastDayOfMonth, monthOf, monthRange } from './dates';
import { READY_TO_ASSIGN, isOnBudget, type BudgetState, type Cents, type ID, type Month } from './types';

/**
 * Age of Money: how many days, on average, a dollar sat in your accounts
 * before you spent it. Income is used first-in, first-out; the figure is
 * the average across the ten most recent spending transactions.
 */
export function ageOfMoney(state: BudgetState): number | null {
  const onBudget = new Set(state.accounts.filter((a) => isOnBudget(a.type)).map((a) => a.id));
  const crossesBudget = (t: BudgetState['transactions'][number]) =>
    !t.transferAccountId || !onBudget.has(t.transferAccountId);
  const flows = state.transactions
    .filter((t) => onBudget.has(t.accountId) && crossesBudget(t) && !t.startingBalance)
    .filter((t) => t.amount !== 0)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : b.amount - a.amount));

  const buckets: { date: string; left: Cents }[] = [];
  let head = 0;
  const ages: number[] = [];
  for (const t of flows) {
    const income = t.amount > 0 && (t.categoryId === READY_TO_ASSIGN || t.transferAccountId);
    if (income) {
      buckets.push({ date: t.date, left: t.amount });
      continue;
    }
    if (t.amount > 0) continue; // refunds don't count as new money
    let need = -t.amount;
    let weighted = 0;
    let covered = 0;
    while (need > 0 && head < buckets.length) {
      const b = buckets[head];
      const take = Math.min(b.left, need);
      weighted += take * Math.max(0, daysBetween(b.date, t.date));
      covered += take;
      b.left -= take;
      need -= take;
      if (b.left === 0) head++;
    }
    if (covered > 0) ages.push(weighted / covered);
  }
  if (ages.length < 3) return null;
  const recent = ages.slice(-10);
  return Math.round(recent.reduce((a, b) => a + b, 0) / recent.length);
}

export interface SpendingRow {
  categoryId: ID;
  groupId: ID | null;
  amount: Cents;
}

/** Net spending per category between two months (inclusive), outflows as positive. */
export function spendingByCategory(state: BudgetState, from: Month, to: Month): SpendingRow[] {
  const accounts = new Map(state.accounts.map((a) => [a.id, a]));
  const totals = new Map<ID, Cents>();
  for (const t of state.transactions) {
    const m = monthOf(t.date);
    if (m < from || m > to) continue;
    const account = accounts.get(t.accountId);
    if (!account || !isOnBudget(account.type) || t.startingBalance) continue;
    if (t.transferAccountId && accounts.get(t.transferAccountId) && isOnBudget(accounts.get(t.transferAccountId)!.type)) continue;
    const parts = t.splits?.length ? t.splits : [{ categoryId: t.categoryId, amount: t.amount }];
    for (const p of parts) {
      if (p.categoryId === READY_TO_ASSIGN) continue;
      const id = p.categoryId ?? 'uncategorized';
      totals.set(id, (totals.get(id) ?? 0) - p.amount);
    }
  }
  const groupOf = new Map(state.categories.map((c) => [c.id, c.groupId]));
  return [...totals]
    .filter(([, amount]) => amount !== 0)
    .map(([categoryId, amount]) => ({ categoryId, groupId: groupOf.get(categoryId) ?? null, amount }))
    .sort((a, b) => b.amount - a.amount);
}

export interface CashFlowMonth {
  month: Month;
  income: Cents;
  spending: Cents;
}

/** Income (money into Ready to Assign) against category spending, month by month. */
export function incomeVsSpending(state: BudgetState, from: Month, to: Month): CashFlowMonth[] {
  const rows = new Map(monthRange(from, to).map((m) => [m, { month: m, income: 0, spending: 0 }]));
  const accounts = new Map(state.accounts.map((a) => [a.id, a]));
  for (const t of state.transactions) {
    const row = rows.get(monthOf(t.date));
    if (!row || t.startingBalance || t.payee === 'Starting Balance') continue;
    const account = accounts.get(t.accountId);
    if (!account || !isOnBudget(account.type)) continue;
    const other = t.transferAccountId ? accounts.get(t.transferAccountId) : undefined;
    if (other && isOnBudget(other.type)) continue;
    const parts = t.splits?.length ? t.splits : [{ categoryId: t.categoryId, amount: t.amount }];
    for (const p of parts) {
      if (p.categoryId === READY_TO_ASSIGN) row.income += p.amount;
      else row.spending -= p.amount;
    }
  }
  return [...rows.values()];
}

export interface NetWorthMonth {
  month: Month;
  assets: Cents;
  debts: Cents;
  net: Cents;
}

/** Month-end balances across every account, split into what you own and what you owe. */
export function netWorthByMonth(state: BudgetState, from: Month, to: Month): NetWorthMonth[] {
  return monthRange(from, to).map((month) => {
    const balances = accountBalances(state, lastDayOfMonth(month));
    let assets = 0;
    let debts = 0;
    for (const b of balances.values()) {
      if (b.working >= 0) assets += b.working;
      else debts += b.working;
    }
    return { month, assets, debts, net: assets + debts };
  });
}

export function firstActivityMonth(state: BudgetState, fallback: Month): Month {
  let first = fallback;
  for (const t of state.transactions) {
    const m = monthOf(t.date);
    if (m < first) first = m;
  }
  return first;
}

export function clampRange(state: BudgetState, to: Month, months: number): [Month, Month] {
  const first = firstActivityMonth(state, to);
  const from = addMonths(to, -(months - 1));
  return [from < first ? first : from, to];
}
