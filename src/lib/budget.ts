import { addMonths, currentMonth, formatMonth, monthOf, monthRange, monthsBetween } from './dates';
import { formatMoney } from './money';
import {
  READY_TO_ASSIGN,
  UNCATEGORIZED,
  isCredit,
  isOnBudget,
  type BudgetState,
  type Category,
  type Cents,
  type ID,
  type ISODate,
  type Month,
  type Target,
} from './types';

/*
 * The budget engine. Everything here is derived from the stored state, so
 * the numbers can never drift out of sync with the transactions.
 *
 * The rules follow envelope budgeting as YNAB does it:
 *  - Income categorized "Ready to Assign" waits to be given a job.
 *  - Each category's Available = last month's leftover + Assigned + Activity.
 *  - Positive leftovers roll into next month. A negative balance does not:
 *    cash overspending is taken out of next month's Ready to Assign, and
 *    credit overspending becomes card debt.
 *  - Spending on a credit card from a funded category moves that money into
 *    the card's payment category, ready for the bill. Payments to the card
 *    draw it back down.
 */

export interface CategoryMonth {
  categoryId: ID;
  /** Positive balance carried in from last month. */
  carryover: Cents;
  assigned: Cents;
  activity: Cents;
  available: Cents;
  /** Spending in cash (non-credit) accounts this month, as a positive number. */
  cashSpending: Cents;
  /** Spending on credit cards this month, as a positive number. */
  creditSpending: Cents;
  /** Overspending paid in cash; comes out of next month's Ready to Assign. */
  cashOverspent: Cents;
  /** Overspending on a credit card; it becomes debt on the card. */
  creditOverspent: Cents;
  target: TargetProgress | null;
}

export interface TargetProgress {
  /** Still to assign this month for the target to be on track. */
  needed: Cents;
  /** 0..1 progress toward this month's (or the overall) goal. */
  progress: number;
  /** What this month asks for in total. */
  monthlyAmount: Cents;
  summary: string;
}

export type CategoryStatus = 'cash-overspent' | 'credit-overspent' | 'underfunded' | 'funded' | 'zero';

export interface MonthSummary {
  month: Month;
  readyToAssign: Cents;
  /** Ready to Assign carried over from the month before. */
  leftOverFromLastMonth: Cents;
  incomeThisMonth: Cents;
  assignedThisMonth: Cents;
  /** Cash overspending from last month, deducted this month. */
  overspentLastMonth: Cents;
  assignedInFuture: Cents;
  activityThisMonth: Cents;
  totalAvailable: Cents;
  underfunded: Cents;
  categories: Record<ID, CategoryMonth>;
}

export interface BudgetModel {
  firstMonth: Month;
  lastMonth: Month;
  months: Map<Month, MonthSummary>;
  /** Summary for any month, computing past the stored range when needed. */
  get(month: Month): MonthSummary;
}

interface Line {
  date: ISODate;
  amount: Cents;
  creditAccountId: ID | null;
  order: number;
}

export function computeBudget(state: BudgetState, through: Month = currentMonth()): BudgetModel {
  const accounts = new Map(state.accounts.map((a) => [a.id, a]));
  const linesByMonth = new Map<Month, Map<ID, Line[]>>();
  const incomeByMonth = new Map<Month, Cents>();
  /** month -> credit account id -> payment-category activity from transfers */
  const paymentsByMonth = new Map<Month, Map<ID, Cents>>();
  let firstMonth = through;

  const addLine = (month: Month, categoryId: ID, line: Line) => {
    let byCat = linesByMonth.get(month);
    if (!byCat) linesByMonth.set(month, (byCat = new Map()));
    let list = byCat.get(categoryId);
    if (!list) byCat.set(categoryId, (list = []));
    list.push(line);
  };

  state.transactions.forEach((t, order) => {
    const account = accounts.get(t.accountId);
    if (!account || !isOnBudget(account.type)) return;
    const month = monthOf(t.date);
    if (month < firstMonth) firstMonth = month;
    const onCredit = isCredit(account.type);

    if (t.transferAccountId) {
      const other = accounts.get(t.transferAccountId);
      if (other && isOnBudget(other.type)) {
        // Money moving between budget accounts doesn't change any category,
        // except that paying a card (or borrowing from it) moves the money
        // set aside in its payment category.
        if (onCredit) {
          let byAcct = paymentsByMonth.get(month);
          if (!byAcct) paymentsByMonth.set(month, (byAcct = new Map()));
          byAcct.set(t.accountId, (byAcct.get(t.accountId) ?? 0) - t.amount);
        }
        return;
      }
    }
    if (t.startingBalance && onCredit) return;

    const parts = t.splits?.length
      ? t.splits.map((s) => ({ categoryId: s.categoryId, amount: s.amount }))
      : [{ categoryId: t.categoryId, amount: t.amount }];
    for (const part of parts) {
      if (part.categoryId === READY_TO_ASSIGN) {
        incomeByMonth.set(month, (incomeByMonth.get(month) ?? 0) + part.amount);
        continue;
      }
      addLine(month, part.categoryId ?? UNCATEGORIZED, {
        date: t.date,
        amount: part.amount,
        creditAccountId: onCredit ? t.accountId : null,
        order,
      });
    }
  });

  for (const month of Object.keys(state.assigned)) {
    if (month < firstMonth && Object.values(state.assigned[month]).some((v) => v !== 0)) {
      firstMonth = month;
    }
  }

  const regular = state.categories.filter((c) => !c.creditAccountId);
  const payment = state.categories.filter((c) => c.creditAccountId);
  const categoryIds = new Set(state.categories.map((c) => c.id));

  const months = new Map<Month, MonthSummary>();
  let prev: MonthSummary | null = null;
  let incomeThrough = 0;
  let assignedThrough = 0;
  let cashOverspentBefore = 0;
  let prevCashOverspent = 0;
  const netAssignedThrough = new Map<Month, Cents>();

  const step = (month: Month): MonthSummary => {
    const lines = linesByMonth.get(month) ?? new Map<ID, Line[]>();
    const assignedMap = state.assigned[month] ?? {};
    const categories: Record<ID, CategoryMonth> = {};
    const moveToPayment = new Map<ID, Cents>();
    let assignedThisMonth = 0;
    let cashOverspentThisMonth = 0;

    const regularIds = regular.map((c) => c.id);
    // Transactions in a category that has since been deleted still count, as uncategorized.
    for (const [catId, list] of lines) {
      if (catId !== UNCATEGORIZED && !categoryIds.has(catId)) {
        const into = lines.get(UNCATEGORIZED) ?? [];
        into.push(...list);
        lines.set(UNCATEGORIZED, into);
        lines.delete(catId);
      }
    }
    regularIds.push(UNCATEGORIZED);

    for (const id of regularIds) {
      const carryover = Math.max(0, prev?.categories[id]?.available ?? 0);
      const assigned = id === UNCATEGORIZED ? 0 : (assignedMap[id] ?? 0);
      const catLines = (lines.get(id) ?? []).slice().sort(byDateThenOrder);
      let running = carryover + assigned;
      let activity = 0;
      let cashSpending = 0;
      let creditSpending = 0;
      let unfundedCredit = 0;
      for (const line of catLines) {
        activity += line.amount;
        if (line.creditAccountId) {
          if (line.amount < 0) {
            const spend = -line.amount;
            creditSpending += spend;
            const funded = Math.max(0, Math.min(running, spend));
            unfundedCredit += spend - funded;
            if (funded) moveToPayment.set(line.creditAccountId, (moveToPayment.get(line.creditAccountId) ?? 0) + funded);
          } else {
            // A refund on the card hands its money back to the category.
            creditSpending -= line.amount;
            moveToPayment.set(line.creditAccountId, (moveToPayment.get(line.creditAccountId) ?? 0) - line.amount);
          }
        } else {
          cashSpending -= line.amount;
        }
        running += line.amount;
      }
      const available = carryover + assigned + activity;
      let cashOverspent = 0;
      let creditOverspent = 0;
      if (available < 0) {
        creditOverspent = Math.min(-available, unfundedCredit);
        cashOverspent = -available - creditOverspent;
      }
      cashOverspentThisMonth += cashOverspent;
      assignedThisMonth += assigned;
      categories[id] = {
        categoryId: id,
        carryover,
        assigned,
        activity,
        available,
        cashSpending,
        creditSpending,
        cashOverspent,
        creditOverspent,
        target: null,
      };
    }

    const payments = paymentsByMonth.get(month);
    for (const cat of payment) {
      const cardId = cat.creditAccountId!;
      const carryover = Math.max(0, prev?.categories[cat.id]?.available ?? 0);
      const assigned = assignedMap[cat.id] ?? 0;
      const activity = (moveToPayment.get(cardId) ?? 0) + (payments?.get(cardId) ?? 0);
      const available = carryover + assigned + activity;
      const cashOverspent = Math.max(0, -available);
      cashOverspentThisMonth += cashOverspent;
      assignedThisMonth += assigned;
      categories[cat.id] = {
        categoryId: cat.id,
        carryover,
        assigned,
        activity,
        available,
        cashSpending: 0,
        creditSpending: 0,
        cashOverspent,
        creditOverspent: 0,
        target: null,
      };
    }

    for (const cat of regular) {
      if (cat.target) categories[cat.id].target = targetProgress(cat.target, categories[cat.id], month);
    }

    const incomeThisMonth = incomeByMonth.get(month) ?? 0;
    const leftOverFromLastMonth = prev ? prev.readyToAssign + prev.assignedInFuture : 0;
    const overspentLastMonth = prevCashOverspent;

    incomeThrough += incomeThisMonth;
    assignedThrough += assignedThisMonth;
    // Money left once this month is budgeted. Later months can still claim
    // some of it (see the pass after the loop below).
    const readyToAssign = incomeThrough - assignedThrough - cashOverspentBefore;
    const assignedInFuture = 0;
    netAssignedThrough.set(month, incomeThrough - assignedThrough);

    let activityThisMonth = 0;
    let totalAvailable = 0;
    for (const c of Object.values(categories)) {
      activityThisMonth += c.activity;
      totalAvailable += c.available;
    }
    // Hidden categories still hold money, but a hidden target shouldn't ask for more.
    let underfunded = 0;
    for (const cat of regular) {
      if (!cat.hidden) underfunded += categories[cat.id].target?.needed ?? 0;
    }

    cashOverspentBefore += cashOverspentThisMonth;
    prevCashOverspent = cashOverspentThisMonth;

    return {
      month,
      readyToAssign,
      leftOverFromLastMonth,
      incomeThisMonth,
      assignedThisMonth,
      overspentLastMonth,
      assignedInFuture,
      activityThisMonth,
      totalAvailable,
      underfunded,
      categories,
    };
  };

  const lastStored = [through, ...Object.keys(state.assigned)].reduce((a, b) => (b > a ? b : a));
  let lastMonth = firstMonth;
  for (const month of monthRange(firstMonth, lastStored)) {
    prev = step(month);
    months.set(month, prev);
    lastMonth = month;
  }

  // Money assigned in a later month has to come from somewhere. Each month
  // holds back whatever later months assigned beyond their own income, so
  // Ready to Assign is the most you could assign now without leaving a
  // future month short.
  let floor = Infinity;
  for (const month of [...months.keys()].reverse()) {
    const summary = months.get(month)!;
    const net = netAssignedThrough.get(month)!;
    floor = Math.min(floor, net);
    summary.assignedInFuture = net - floor;
    summary.readyToAssign -= summary.assignedInFuture;
  }

  return {
    firstMonth,
    lastMonth,
    months,
    get(month: Month): MonthSummary {
      const hit = months.get(month);
      if (hit) return hit;
      if (month < firstMonth) return emptyMonth(month, state);
      while (lastMonth < month) {
        lastMonth = addMonths(lastMonth, 1);
        prev = step(lastMonth);
        months.set(lastMonth, prev);
      }
      return months.get(month)!;
    },
  };
}

function byDateThenOrder(a: Line, b: Line): number {
  return a.date < b.date ? -1 : a.date > b.date ? 1 : a.order - b.order;
}

function emptyMonth(month: Month, state: BudgetState): MonthSummary {
  const categories: Record<ID, CategoryMonth> = {};
  for (const c of [...state.categories.map((c) => c.id), UNCATEGORIZED]) {
    categories[c] = {
      categoryId: c,
      carryover: 0,
      assigned: 0,
      activity: 0,
      available: 0,
      cashSpending: 0,
      creditSpending: 0,
      cashOverspent: 0,
      creditOverspent: 0,
      target: null,
    };
  }
  return {
    month,
    readyToAssign: 0,
    leftOverFromLastMonth: 0,
    incomeThisMonth: 0,
    assignedThisMonth: 0,
    overspentLastMonth: 0,
    assignedInFuture: 0,
    activityThisMonth: 0,
    totalAvailable: 0,
    underfunded: 0,
    categories,
  };
}

export function targetProgress(target: Target, cm: CategoryMonth, month: Month): TargetProgress {
  const { carryover, assigned, available } = cm;
  if (target.type === 'monthly') {
    const base = target.mode === 'refill' ? carryover + assigned : assigned;
    const needed = Math.max(0, target.amount - base);
    return {
      needed,
      progress: target.amount > 0 ? clamp01(base / target.amount) : 1,
      monthlyAmount: target.amount,
      summary:
        target.mode === 'refill'
          ? `Refill up to ${formatMoney(target.amount)} each month`
          : `Set aside ${formatMoney(target.amount)} each month`,
    };
  }
  if (target.by) {
    const monthsLeft = Math.max(1, monthsBetween(month, target.by) + 1);
    // What was there before this month's assignment, after this month's spending.
    const before = carryover + cm.activity;
    const remaining = Math.max(0, target.amount - before);
    const perMonth = month > target.by ? remaining : Math.ceil(remaining / monthsLeft);
    return {
      needed: Math.max(0, perMonth - assigned),
      progress: target.amount > 0 ? clamp01(Math.max(0, available) / target.amount) : 1,
      monthlyAmount: perMonth,
      summary: `Have ${formatMoney(target.amount)} by ${formatMonth(target.by)}`,
    };
  }
  return {
    needed: Math.max(0, target.amount - available),
    progress: target.amount > 0 ? clamp01(Math.max(0, available) / target.amount) : 1,
    monthlyAmount: Math.max(0, target.amount - (available - assigned)),
    summary: `Have a balance of ${formatMoney(target.amount)}`,
  };
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

export function categoryStatus(cm: CategoryMonth | undefined, hidden = false): CategoryStatus {
  if (!cm) return 'zero';
  if (cm.available < 0) return cm.cashOverspent > 0 ? 'cash-overspent' : 'credit-overspent';
  if (!hidden && cm.target && cm.target.needed > 0) return 'underfunded';
  return cm.available > 0 ? 'funded' : 'zero';
}

/** Account balances, split into what the bank has cleared and what it hasn't yet. */
export function accountBalances(state: BudgetState, asOf?: ISODate) {
  const out = new Map<ID, { cleared: Cents; uncleared: Cents; working: Cents }>();
  for (const a of state.accounts) out.set(a.id, { cleared: 0, uncleared: 0, working: 0 });
  for (const t of state.transactions) {
    if (asOf && t.date > asOf) continue;
    const b = out.get(t.accountId);
    if (!b) continue;
    if (t.cleared === 'uncleared') b.uncleared += t.amount;
    else b.cleared += t.amount;
    b.working += t.amount;
  }
  return out;
}

export function isPaymentCategory(c: Category | undefined): boolean {
  return !!c?.creditAccountId;
}
