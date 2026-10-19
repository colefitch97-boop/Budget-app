import { computeBudget, type BudgetModel } from './budget';
import { addMonths, today } from './dates';
import { newId } from './ids';
import { nextOccurrence } from './schedule';
import {
  READY_TO_ASSIGN,
  isCredit,
  isOnBudget,
  type Account,
  type AccountType,
  type BudgetState,
  type Category,
  type CategoryGroup,
  type Cents,
  type ClearedState,
  type ID,
  type ISODate,
  type Month,
  type ScheduledTransaction,
  type Split,
  type Target,
  type Transaction,
} from './types';

/*
 * Every change to a budget goes through one of these pure functions:
 * state in, new state out. That keeps undo trivial and makes the rules
 * testable without a browser.
 */

export function emptyBudget(name = 'My Budget'): BudgetState {
  return {
    version: 1,
    name,
    settings: { currency: 'USD' },
    accounts: [],
    groups: [],
    categories: [],
    transactions: [],
    scheduled: [],
    assigned: {},
  };
}

/* ------------------------------------------------------------------ accounts */

export interface NewAccount {
  name: string;
  type: AccountType;
  balance: Cents;
  date?: ISODate;
  note?: string;
}

export function addAccount(s: BudgetState, input: NewAccount): { state: BudgetState; id: ID } {
  const account: Account = {
    id: newId('a'),
    name: input.name.trim() || 'Account',
    type: input.type,
    closed: false,
    note: input.note ?? '',
  };
  let next: BudgetState = { ...s, accounts: [...s.accounts, account] };
  if (isCredit(account.type)) next = ensurePaymentCategory(next, account);
  if (input.balance !== 0 || isOnBudget(account.type)) {
    const opening: Transaction = {
      id: newId('t'),
      accountId: account.id,
      date: input.date ?? today(),
      payee: 'Starting Balance',
      memo: '',
      amount: input.balance,
      // Cash you already have is ready for a job; card debt and tracking
      // balances don't touch the budget.
      categoryId: isOnBudget(account.type) && !isCredit(account.type) ? READY_TO_ASSIGN : null,
      cleared: 'cleared',
      ...(isCredit(account.type) ? { startingBalance: true } : {}),
    };
    next = { ...next, transactions: [...next.transactions, opening] };
  }
  return { state: next, id: account.id };
}

function ensurePaymentCategory(s: BudgetState, account: Account): BudgetState {
  if (s.categories.some((c) => c.creditAccountId === account.id)) return s;
  let group = s.groups.find((g) => g.isCreditCardPayments);
  let groups = s.groups;
  if (!group) {
    group = { id: newId('g'), name: 'Credit Card Payments', isCreditCardPayments: true };
    groups = [group, ...s.groups];
  }
  const category: Category = {
    id: newId('c'),
    groupId: group.id,
    name: account.name,
    hidden: false,
    note: '',
    creditAccountId: account.id,
  };
  return { ...s, groups, categories: [...s.categories, category] };
}

export function updateAccount(s: BudgetState, id: ID, patch: Partial<Pick<Account, 'name' | 'note' | 'closed'>>): BudgetState {
  const accounts = s.accounts.map((a) => (a.id === id ? { ...a, ...patch } : a));
  const categories =
    patch.name !== undefined
      ? s.categories.map((c) => (c.creditAccountId === id ? { ...c, name: patch.name!.trim() || c.name } : c))
      : s.categories;
  return { ...s, accounts, categories };
}

export function deleteAccount(s: BudgetState, id: ID): BudgetState {
  const account = s.accounts.find((a) => a.id === id);
  if (!account) return s;
  // Transfers into this account become ordinary, uncategorized transactions on the other side.
  const transactions = s.transactions
    .filter((t) => t.accountId !== id)
    .map((t) =>
      t.transferAccountId === id
        ? {
            ...t,
            transferAccountId: undefined,
            transferId: undefined,
            payee: t.payee || `Transfer: ${account.name}`,
            categoryId: null,
          }
        : t,
    );
  const removedCats = new Set(s.categories.filter((c) => c.creditAccountId === id).map((c) => c.id));
  return {
    ...s,
    accounts: s.accounts.filter((a) => a.id !== id),
    transactions,
    scheduled: s.scheduled.filter((x) => x.accountId !== id && x.transferAccountId !== id),
    categories: s.categories.filter((c) => !removedCats.has(c.id)),
    assigned: withoutCategories(s.assigned, removedCats),
  };
}

function withoutCategories(assigned: BudgetState['assigned'], ids: Set<ID>): BudgetState['assigned'] {
  if (!ids.size) return assigned;
  const out: BudgetState['assigned'] = {};
  for (const [month, byCat] of Object.entries(assigned)) {
    const kept: Record<ID, Cents> = {};
    for (const [cat, v] of Object.entries(byCat)) if (!ids.has(cat)) kept[cat] = v;
    out[month] = kept;
  }
  return out;
}

/* -------------------------------------------------------------- transactions */

export interface TransactionInput {
  id?: ID;
  accountId: ID;
  date: ISODate;
  payee: string;
  memo: string;
  amount: Cents;
  categoryId: ID | null;
  splits?: Split[];
  cleared?: ClearedState;
  transferAccountId?: ID;
  importId?: string;
}

/**
 * Creates or updates a transaction. Transfers are kept as a linked pair,
 * one in each account, and stay in step when either side is edited.
 */
export function saveTransaction(s: BudgetState, input: TransactionInput): { state: BudgetState; id: ID } {
  const accounts = new Map(s.accounts.map((a) => [a.id, a]));
  const existing = input.id ? s.transactions.find((t) => t.id === input.id) : undefined;
  const id = existing?.id ?? newId('t');
  const account = accounts.get(input.accountId);
  const other = input.transferAccountId ? accounts.get(input.transferAccountId) : undefined;
  const transfer = other && other.id !== input.accountId ? other : undefined;

  const splits = input.splits && input.splits.length > 1 ? input.splits : undefined;
  let categoryId = splits ? null : input.categoryId;
  let otherCategoryId: ID | null = null;
  if (transfer && account) {
    const here = isOnBudget(account.type);
    const there = isOnBudget(transfer.type);
    if (here === there) categoryId = null;
    else if (!here) {
      otherCategoryId = input.categoryId;
      categoryId = null;
    }
  }

  const main: Transaction = {
    ...(existing ?? {}),
    id,
    accountId: input.accountId,
    date: input.date,
    payee: transfer ? '' : input.payee.trim(),
    memo: input.memo.trim(),
    amount: input.amount,
    categoryId: transfer ? categoryId : splits ? null : categoryId,
    splits: transfer ? undefined : splits,
    cleared: input.cleared ?? existing?.cleared ?? 'uncleared',
    transferAccountId: transfer?.id,
    transferId: undefined,
    importId: input.importId ?? existing?.importId,
  };
  if (!main.splits) delete main.splits;
  if (!main.importId) delete main.importId;
  if (!main.transferAccountId) delete main.transferAccountId;

  let transactions = s.transactions;
  const oldPairId = existing?.transferId;

  if (transfer) {
    const oldPair = oldPairId ? transactions.find((t) => t.id === oldPairId) : undefined;
    const pairId = oldPair?.id ?? newId('t');
    const pair: Transaction = {
      id: pairId,
      accountId: transfer.id,
      date: input.date,
      payee: '',
      memo: main.memo,
      amount: -input.amount,
      categoryId: otherCategoryId,
      cleared: oldPair && oldPair.accountId === transfer.id ? oldPair.cleared : 'uncleared',
      transferAccountId: input.accountId,
      transferId: id,
    };
    main.transferId = pairId;
    if (oldPair) transactions = transactions.map((t) => (t.id === pairId ? pair : t));
    else transactions = [...transactions, pair];
  } else if (oldPairId) {
    transactions = transactions.filter((t) => t.id !== oldPairId);
  }
  if (!main.transferId) delete main.transferId;

  transactions = existing ? transactions.map((t) => (t.id === id ? main : t)) : [...transactions, main];
  return { state: { ...s, transactions }, id };
}

export function deleteTransactions(s: BudgetState, ids: ID[]): BudgetState {
  const drop = new Set(ids);
  for (const t of s.transactions) if (drop.has(t.id) && t.transferId) drop.add(t.transferId);
  return { ...s, transactions: s.transactions.filter((t) => !drop.has(t.id)) };
}

export function setCleared(s: BudgetState, ids: ID[], cleared: ClearedState): BudgetState {
  const set = new Set(ids);
  return {
    ...s,
    transactions: s.transactions.map((t) => (set.has(t.id) ? { ...t, cleared } : t)),
  };
}

/** Gives a category to many transactions at once, skipping ones that can't take one. */
export function categorize(s: BudgetState, ids: ID[], categoryId: ID | null): BudgetState {
  const set = new Set(ids);
  const accounts = new Map(s.accounts.map((a) => [a.id, a]));
  return {
    ...s,
    transactions: s.transactions.map((t) => {
      if (!set.has(t.id) || !canHaveCategory(t, accounts)) return t;
      const next = { ...t, categoryId };
      delete next.splits;
      return next;
    }),
  };
}

export function canHaveCategory(t: Transaction, accounts: Map<ID, Account>): boolean {
  const account = accounts.get(t.accountId);
  if (!account || !isOnBudget(account.type)) return false;
  if (t.startingBalance && isCredit(account.type)) return false;
  if (t.transferAccountId) {
    const other = accounts.get(t.transferAccountId);
    if (other && isOnBudget(other.type)) return false;
  }
  return true;
}

/**
 * Locks in everything the bank has cleared. If the bank's balance differs
 * from ours, an adjustment makes up the gap, as Ready to Assign money.
 */
export function reconcile(s: BudgetState, accountId: ID, bankBalance: Cents, date = today()): BudgetState {
  let cleared = 0;
  for (const t of s.transactions) if (t.accountId === accountId && t.cleared !== 'uncleared') cleared += t.amount;
  let next = s;
  const diff = bankBalance - cleared;
  if (diff !== 0) {
    const account = s.accounts.find((a) => a.id === accountId);
    next = saveTransaction(next, {
      accountId,
      date,
      payee: 'Reconciliation Balance Adjustment',
      memo: '',
      amount: diff,
      categoryId: account && isOnBudget(account.type) ? READY_TO_ASSIGN : null,
      cleared: 'cleared',
    }).state;
  }
  return {
    ...next,
    transactions: next.transactions.map((t) =>
      t.accountId === accountId && t.cleared === 'cleared' ? { ...t, cleared: 'reconciled' } : t,
    ),
  };
}

/* ---------------------------------------------------------------- budgeting */

export function setAssigned(s: BudgetState, month: Month, categoryId: ID, amount: Cents): BudgetState {
  if ((s.assigned[month]?.[categoryId] ?? 0) === amount) return s;
  const byCat = { ...(s.assigned[month] ?? {}) };
  if (amount === 0) delete byCat[categoryId];
  else byCat[categoryId] = amount;
  const assigned = { ...s.assigned, [month]: byCat };
  if (!Object.keys(byCat).length) delete assigned[month];
  return { ...s, assigned };
}

function getAssigned(s: BudgetState, month: Month, categoryId: ID): Cents {
  return s.assigned[month]?.[categoryId] ?? 0;
}

/** Moves money between categories (or to/from Ready to Assign) within a month. */
export function moveMoney(s: BudgetState, month: Month, fromId: ID, toId: ID, amount: Cents): BudgetState {
  let next = s;
  if (fromId !== READY_TO_ASSIGN) next = setAssigned(next, month, fromId, getAssigned(next, month, fromId) - amount);
  if (toId !== READY_TO_ASSIGN) next = setAssigned(next, month, toId, getAssigned(next, month, toId) + amount);
  return next;
}

export type AutoAssignStrategy =
  | 'underfunded'
  | 'assigned-last-month'
  | 'spent-last-month'
  | 'average-assigned'
  | 'average-spent'
  | 'reset-available'
  | 'reset-assigned';

export const AUTO_ASSIGN_LABELS: Record<AutoAssignStrategy, string> = {
  underfunded: 'Underfunded',
  'assigned-last-month': 'Assigned last month',
  'spent-last-month': 'Spent last month',
  'average-assigned': 'Average assigned',
  'average-spent': 'Average spent',
  'reset-available': 'Reset available amounts',
  'reset-assigned': 'Reset assigned amounts',
};

/** How much each category would get from an auto-assign strategy. */
export function autoAssignPlan(
  s: BudgetState,
  model: BudgetModel,
  month: Month,
  strategy: AutoAssignStrategy,
  categoryIds?: ID[],
): Map<ID, Cents> {
  const ids = categoryIds ?? s.categories.filter((c) => !c.hidden).map((c) => c.id);
  const now = model.get(month);
  const last = model.get(addMonths(month, -1));
  const recent = [1, 2, 3].map((n) => model.get(addMonths(month, -n)));
  const plan = new Map<ID, Cents>();
  for (const id of ids) {
    const cm = now.categories[id];
    if (!cm) continue;
    let value = cm.assigned;
    switch (strategy) {
      case 'underfunded':
        value = cm.assigned + (cm.target?.needed ?? 0);
        break;
      case 'assigned-last-month':
        value = last.categories[id]?.assigned ?? 0;
        break;
      case 'spent-last-month':
        value = Math.max(0, -(last.categories[id]?.activity ?? 0));
        break;
      case 'average-assigned':
        value = Math.round(recent.reduce((sum, m) => sum + (m.categories[id]?.assigned ?? 0), 0) / recent.length);
        break;
      case 'average-spent':
        value = Math.max(0, Math.round(-recent.reduce((sum, m) => sum + (m.categories[id]?.activity ?? 0), 0) / recent.length));
        break;
      case 'reset-available':
        value = cm.available > 0 ? cm.assigned - cm.available : cm.assigned;
        break;
      case 'reset-assigned':
        value = 0;
        break;
    }
    if (value !== cm.assigned) plan.set(id, value);
  }
  return plan;
}

export function autoAssign(
  s: BudgetState,
  month: Month,
  strategy: AutoAssignStrategy,
  categoryIds?: ID[],
): BudgetState {
  const plan = autoAssignPlan(s, computeBudget(s, month), month, strategy, categoryIds);
  let next = s;
  for (const [id, value] of plan) next = setAssigned(next, month, id, value);
  return next;
}

/* --------------------------------------------------------------- categories */

export function addGroup(s: BudgetState, name: string): { state: BudgetState; id: ID } {
  const group: CategoryGroup = { id: newId('g'), name: name.trim() || 'New Group' };
  return { state: { ...s, groups: [...s.groups, group] }, id: group.id };
}

export function updateGroup(s: BudgetState, id: ID, patch: Partial<Pick<CategoryGroup, 'name' | 'collapsed'>>): BudgetState {
  return { ...s, groups: s.groups.map((g) => (g.id === id ? { ...g, ...patch } : g)) };
}

export function addCategory(s: BudgetState, groupId: ID, name: string): { state: BudgetState; id: ID } {
  const category: Category = { id: newId('c'), groupId, name: name.trim() || 'New Category', hidden: false, note: '' };
  // Keep a group's categories together in the list.
  const lastIndex = s.categories.map((c) => c.groupId).lastIndexOf(groupId);
  const categories = [...s.categories];
  categories.splice(lastIndex === -1 ? categories.length : lastIndex + 1, 0, category);
  return { state: { ...s, categories }, id: category.id };
}

export function updateCategory(s: BudgetState, id: ID, patch: Partial<Pick<Category, 'name' | 'note' | 'hidden'>>): BudgetState {
  return { ...s, categories: s.categories.map((c) => (c.id === id ? { ...c, ...patch } : c)) };
}

export function setTarget(s: BudgetState, id: ID, target: Target | undefined): BudgetState {
  return {
    ...s,
    categories: s.categories.map((c) => {
      if (c.id !== id) return c;
      const next = { ...c, target };
      if (!target) delete next.target;
      return next;
    }),
  };
}

/**
 * Deletes categories, handing their transactions, schedules and assigned
 * money to a replacement so no dollar loses its place.
 */
export function deleteCategories(s: BudgetState, ids: ID[], replacementId: ID | null): BudgetState {
  const drop = new Set(ids);
  const swap = (c: ID | null) => (c && drop.has(c) ? replacementId : c);
  const transactions = s.transactions.map((t) => {
    const touched = (t.categoryId && drop.has(t.categoryId)) || t.splits?.some((x) => x.categoryId && drop.has(x.categoryId));
    if (!touched) return t;
    return {
      ...t,
      categoryId: swap(t.categoryId),
      ...(t.splits ? { splits: t.splits.map((x) => ({ ...x, categoryId: swap(x.categoryId) })) } : {}),
    };
  });
  const scheduled = s.scheduled.map((x) => (x.categoryId && drop.has(x.categoryId) ? { ...x, categoryId: replacementId } : x));
  const assigned: BudgetState['assigned'] = {};
  for (const [month, byCat] of Object.entries(s.assigned)) {
    const next: Record<ID, Cents> = {};
    let moved = 0;
    for (const [cat, v] of Object.entries(byCat)) {
      if (drop.has(cat)) moved += v;
      else next[cat] = v;
    }
    if (moved && replacementId && replacementId !== READY_TO_ASSIGN) next[replacementId] = (next[replacementId] ?? 0) + moved;
    if (Object.keys(next).length) assigned[month] = next;
  }
  return {
    ...s,
    transactions,
    scheduled,
    assigned,
    categories: s.categories.filter((c) => !drop.has(c.id)),
  };
}

export function deleteGroup(s: BudgetState, id: ID, replacementId: ID | null): BudgetState {
  const ids = s.categories.filter((c) => c.groupId === id).map((c) => c.id);
  const next = deleteCategories(s, ids, replacementId);
  return { ...next, groups: next.groups.filter((g) => g.id !== id) };
}

/** Moves a category up or down one place, or into another group. */
export function moveCategory(s: BudgetState, id: ID, to: { direction: -1 | 1 } | { groupId: ID }): BudgetState {
  const cat = s.categories.find((c) => c.id === id);
  if (!cat) return s;
  if ('groupId' in to) {
    const rest = s.categories.filter((c) => c.id !== id);
    const moved = { ...cat, groupId: to.groupId };
    const lastIndex = rest.map((c) => c.groupId).lastIndexOf(to.groupId);
    rest.splice(lastIndex === -1 ? rest.length : lastIndex + 1, 0, moved);
    return { ...s, categories: rest };
  }
  const siblings = s.categories.filter((c) => c.groupId === cat.groupId);
  const i = siblings.indexOf(cat);
  const j = i + to.direction;
  if (j < 0 || j >= siblings.length) return s;
  const a = s.categories.indexOf(cat);
  const b = s.categories.indexOf(siblings[j]);
  const categories = [...s.categories];
  [categories[a], categories[b]] = [categories[b], categories[a]];
  return { ...s, categories };
}

export function moveGroup(s: BudgetState, id: ID, direction: -1 | 1): BudgetState {
  const i = s.groups.findIndex((g) => g.id === id);
  const j = i + direction;
  if (i < 0 || j < 0 || j >= s.groups.length) return s;
  const groups = [...s.groups];
  [groups[i], groups[j]] = [groups[j], groups[i]];
  return { ...s, groups };
}

/* ---------------------------------------------------------------- schedules */

export type ScheduledInput = Omit<ScheduledTransaction, 'id' | 'anchorDate'> & { id?: ID };

export function saveScheduled(s: BudgetState, input: ScheduledInput): BudgetState {
  const existing = input.id ? s.scheduled.find((x) => x.id === input.id) : undefined;
  const item: ScheduledTransaction = {
    ...input,
    id: existing?.id ?? newId('s'),
    anchorDate: existing && existing.nextDate === input.nextDate ? existing.anchorDate : input.nextDate,
  };
  return {
    ...s,
    scheduled: existing ? s.scheduled.map((x) => (x.id === item.id ? item : x)) : [...s.scheduled, item],
  };
}

export function deleteScheduled(s: BudgetState, id: ID): BudgetState {
  return { ...s, scheduled: s.scheduled.filter((x) => x.id !== id) };
}

/** Moves a schedule to its next date without entering it (or ends a one-off). */
export function skipScheduled(s: BudgetState, id: ID): BudgetState {
  const item = s.scheduled.find((x) => x.id === id);
  if (!item) return s;
  const next = nextOccurrence(item, item.nextDate);
  if (!next) return deleteScheduled(s, id);
  return { ...s, scheduled: s.scheduled.map((x) => (x.id === id ? { ...x, nextDate: next } : x)) };
}

/** Records the next occurrence of a schedule as a real transaction. */
export function enterScheduled(s: BudgetState, id: ID, date?: ISODate): BudgetState {
  const item = s.scheduled.find((x) => x.id === id);
  if (!item) return s;
  const next = saveTransaction(s, {
    accountId: item.accountId,
    date: date ?? item.nextDate,
    payee: item.payee,
    memo: item.memo,
    amount: item.amount,
    categoryId: item.categoryId,
    transferAccountId: item.transferAccountId,
  }).state;
  return skipScheduled(next, id);
}

/** Enters every scheduled transaction that has come due. */
export function enterDueScheduled(s: BudgetState, asOf = today()): BudgetState {
  let next = s;
  for (const item of s.scheduled) {
    let guard = 0;
    let current = next.scheduled.find((x) => x.id === item.id);
    while (current && current.nextDate <= asOf && guard++ < 400) {
      next = enterScheduled(next, item.id);
      current = next.scheduled.find((x) => x.id === item.id);
    }
  }
  return next;
}

/* ------------------------------------------------------------------- import */

export interface ImportRow {
  date: ISODate;
  payee: string;
  memo: string;
  amount: Cents;
  importId: string;
}

/** Most recent category used with each payee, for auto-categorizing new entries. */
export function payeeCategories(s: BudgetState): Map<string, ID | null> {
  const out = new Map<string, ID | null>();
  const sorted = [...s.transactions].sort((a, b) => (a.date < b.date ? -1 : 1));
  for (const t of sorted) {
    if (!t.payee || t.transferAccountId || t.splits) continue;
    out.set(normalizePayee(t.payee), t.categoryId);
  }
  return out;
}

export function normalizePayee(p: string): string {
  return p.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** True when an imported row is already in the account (same bank id, or same date, amount and payee). */
export function isDuplicate(s: BudgetState, accountId: ID, row: ImportRow): boolean {
  return s.transactions.some(
    (t) =>
      t.accountId === accountId &&
      ((t.importId && t.importId === row.importId) ||
        (t.date === row.date && t.amount === row.amount && normalizePayee(t.payee) === normalizePayee(row.payee))),
  );
}

export function importTransactions(
  s: BudgetState,
  accountId: ID,
  rows: (ImportRow & { categoryId: ID | null })[],
): BudgetState {
  let next = s;
  for (const row of rows) {
    next = saveTransaction(next, {
      accountId,
      date: row.date,
      payee: row.payee,
      memo: row.memo,
      amount: row.amount,
      categoryId: row.categoryId,
      cleared: 'cleared',
      importId: row.importId,
    }).state;
  }
  return next;
}
