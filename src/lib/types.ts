/** Money is stored as integer cents to keep arithmetic exact. */
export type Cents = number;
/** A calendar date, `YYYY-MM-DD`. */
export type ISODate = string;
/** A budget month, `YYYY-MM`. */
export type Month = string;
export type ID = string;

/** Income lands here: money waiting for a job. */
export const READY_TO_ASSIGN = 'ready-to-assign';
/** Pseudo-category for on-budget transactions nobody has categorized yet. */
export const UNCATEGORIZED = 'uncategorized';

export type AccountType =
  | 'checking'
  | 'savings'
  | 'cash'
  | 'credit'
  | 'asset'
  | 'liability';

export interface Account {
  id: ID;
  name: string;
  type: AccountType;
  closed: boolean;
  note: string;
}

export interface CategoryGroup {
  id: ID;
  name: string;
  /** The group that holds one payment category per credit card. */
  isCreditCardPayments?: boolean;
  collapsed?: boolean;
}

export type Target =
  /** Assign the same amount every month (or top it up to that amount). */
  | { type: 'monthly'; amount: Cents; mode: 'set-aside' | 'refill' }
  /** Build up a balance, optionally by a given month. */
  | { type: 'balance'; amount: Cents; by?: Month };

export interface Category {
  id: ID;
  groupId: ID;
  name: string;
  hidden: boolean;
  note: string;
  target?: Target;
  /** Set on a credit card's payment category. */
  creditAccountId?: ID;
}

export type ClearedState = 'uncleared' | 'cleared' | 'reconciled';

export interface Split {
  id: ID;
  categoryId: ID | null;
  amount: Cents;
  memo: string;
}

export interface Transaction {
  id: ID;
  accountId: ID;
  date: ISODate;
  payee: string;
  memo: string;
  /** Positive is money in, negative is money out. */
  amount: Cents;
  /** READY_TO_ASSIGN, a category id, or null (uncategorized or an on-budget transfer). */
  categoryId: ID | null;
  /** When present the transaction is split and `categoryId` is ignored. */
  splits?: Split[];
  cleared: ClearedState;
  /** The other account of a transfer, and the matching transaction there. */
  transferAccountId?: ID;
  transferId?: ID;
  /** A credit card's opening debt, which never touches a category. */
  startingBalance?: boolean;
  /** Bank id (or a hash of the row) for an imported transaction, used to skip duplicates. */
  importId?: string;
}

export type Frequency =
  | 'once'
  | 'weekly'
  | 'every-2-weeks'
  | 'twice-a-month'
  | 'monthly'
  | 'every-3-months'
  | 'every-6-months'
  | 'yearly';

export interface ScheduledTransaction {
  id: ID;
  accountId: ID;
  payee: string;
  memo: string;
  amount: Cents;
  categoryId: ID | null;
  transferAccountId?: ID;
  frequency: Frequency;
  /** The original day the schedule was anchored to; keeps month-end dates stable. */
  anchorDate: ISODate;
  nextDate: ISODate;
}

export interface Settings {
  currency: string;
}

export interface BudgetState {
  version: 1;
  name: string;
  settings: Settings;
  accounts: Account[];
  groups: CategoryGroup[];
  categories: Category[];
  transactions: Transaction[];
  scheduled: ScheduledTransaction[];
  /** month -> category id -> amount assigned that month */
  assigned: Record<Month, Record<ID, Cents>>;
  /** True while the person is looking around the built-in example budget. */
  isSample?: boolean;
}

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  checking: 'Checking',
  savings: 'Savings',
  cash: 'Cash',
  credit: 'Credit card',
  asset: 'Asset (tracking)',
  liability: 'Loan or mortgage (tracking)',
};

export function isOnBudget(type: AccountType): boolean {
  return type !== 'asset' && type !== 'liability';
}

export function isCredit(type: AccountType): boolean {
  return type === 'credit';
}
