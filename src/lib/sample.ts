import { addDays, addMonths, today } from './dates';
import {
  addAccount,
  addCategory,
  addGroup,
  emptyBudget,
  saveScheduled,
  saveTransaction,
  setAssigned,
  setTarget,
} from './ops';
import { READY_TO_ASSIGN, type BudgetState, type Cents, type ID, type ISODate, type Target } from './types';

/*
 * An example household budget covering the last few months, so a first
 * visit shows the app working. It is clearly labeled as sample data and
 * replaced as soon as someone starts their own budget.
 */

function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface CatSpec {
  name: string;
  assign: Cents;
  target?: Target;
}

export function buildSampleBudget(asOf: ISODate = today()): BudgetState {
  const random = rng(20261019);
  const between = (lo: number, hi: number) => Math.round(lo + random() * (hi - lo));
  const thisMonth = asOf.slice(0, 7);
  const start = addMonths(thisMonth, -2);
  const startDate = `${start}-01`;

  let s = emptyBudget('Sample Budget');
  s.isSample = true;

  const add = (name: string, type: Parameters<typeof addAccount>[1]['type'], balance: Cents) => {
    const r = addAccount(s, { name, type, balance, date: startDate });
    s = r.state;
    return r.id;
  };
  const checking = add('Everyday Checking', 'checking', 320_000);
  const savings = add('High-Yield Savings', 'savings', 650_000);
  const visa = add('Rewards Visa', 'credit', 0);
  add('Car (Kelley Blue Book value)', 'asset', 1_850_000);
  add('Car Loan', 'liability', -940_000);

  const goalDate = addMonths(thisMonth, 6);
  const yearOut = addMonths(thisMonth, 12);
  const groups: { name: string; cats: CatSpec[] }[] = [
    {
      name: 'Bills',
      cats: [
        { name: 'Rent', assign: 165_000, target: { type: 'monthly', amount: 165_000, mode: 'set-aside' } },
        { name: 'Electric', assign: 18_000, target: { type: 'monthly', amount: 18_000, mode: 'refill' } },
        { name: 'Water & Trash', assign: 7_500 },
        { name: 'Internet', assign: 7_000, target: { type: 'monthly', amount: 7_000, mode: 'set-aside' } },
        { name: 'Phone', assign: 8_500, target: { type: 'monthly', amount: 8_500, mode: 'set-aside' } },
        { name: 'Car Insurance', assign: 14_200, target: { type: 'monthly', amount: 14_200, mode: 'set-aside' } },
        { name: 'Car Payment', assign: 38_500, target: { type: 'monthly', amount: 38_500, mode: 'set-aside' } },
      ],
    },
    {
      name: 'Everyday',
      cats: [
        { name: 'Groceries', assign: 72_000, target: { type: 'monthly', amount: 72_000, mode: 'refill' } },
        { name: 'Gas', assign: 18_000, target: { type: 'monthly', amount: 18_000, mode: 'refill' } },
        { name: 'Household Supplies', assign: 9_000 },
        { name: 'Dining Out', assign: 20_000, target: { type: 'monthly', amount: 20_000, mode: 'set-aside' } },
      ],
    },
    {
      name: 'True Expenses',
      cats: [
        { name: 'Car Maintenance', assign: 5_000, target: { type: 'monthly', amount: 5_000, mode: 'set-aside' } },
        { name: 'Medical', assign: 5_000 },
        { name: 'Gifts', assign: 6_000, target: { type: 'balance', amount: 60_000, by: goalDate } },
        { name: 'Clothing', assign: 6_000 },
      ],
    },
    {
      name: 'Quality of Life',
      cats: [
        { name: 'Streaming', assign: 3_000, target: { type: 'monthly', amount: 3_000, mode: 'set-aside' } },
        { name: 'Entertainment', assign: 8_000 },
        { name: 'Fitness', assign: 6_000 },
      ],
    },
    {
      name: 'Savings Goals',
      cats: [
        { name: 'Emergency Fund', assign: 100_000, target: { type: 'balance', amount: 1_500_000, by: yearOut } },
        { name: 'Vacation', assign: 25_000, target: { type: 'balance', amount: 300_000, by: goalDate } },
      ],
    },
  ];

  const ids: Record<string, ID> = {};
  const specs: Record<string, CatSpec> = {};
  for (const g of groups) {
    const gr = addGroup(s, g.name);
    s = gr.state;
    for (const c of g.cats) {
      const cr = addCategory(s, gr.id, c.name);
      s = cr.state;
      ids[c.name] = cr.id;
      specs[c.name] = c;
      if (c.target) s = setTarget(s, cr.id, c.target);
    }
  }

  let visaBalance = 0;
  const tx = (account: ID, date: ISODate, payee: string, amount: Cents, category: string | null, memo = '') => {
    if (date > asOf) return;
    if (account === visa) visaBalance += amount;
    s = saveTransaction(s, {
      accountId: account,
      date,
      payee,
      memo,
      amount,
      categoryId: category === null ? null : category === 'income' ? READY_TO_ASSIGN : ids[category],
      cleared: date < addDays(asOf, -3) ? 'cleared' : 'uncleared',
    }).state;
  };
  const transfer = (from: ID, to: ID, date: ISODate, amount: Cents, memo = '') => {
    if (date > asOf) return;
    if (from === visa) visaBalance -= amount;
    if (to === visa) visaBalance += amount;
    s = saveTransaction(s, {
      accountId: from,
      date,
      payee: '',
      memo,
      amount: -amount,
      categoryId: null,
      transferAccountId: to,
      cleared: date < addDays(asOf, -3) ? 'cleared' : 'uncleared',
    }).state;
  };

  for (let i = 0; i < 3; i++) {
    const month = addMonths(start, i);
    const d = (day: number) => `${month}-${String(day).padStart(2, '0')}`;
    const current = month === thisMonth;

    tx(checking, d(1), 'Bayou City Design Co.', 285_000, 'income', 'Paycheck');
    tx(checking, d(15), 'Bayou City Design Co.', 285_000, 'income', 'Paycheck');
    tx(checking, d(1), 'Westheimer Lofts', -165_000, 'Rent');
    tx(checking, d(5), 'Progressive', -14_200, 'Car Insurance');
    tx(checking, d(12), 'Reliant Energy', -between(11_800, 17_900), 'Electric');
    tx(checking, d(20), 'City of Houston Water', -between(5_900, 7_100), 'Water & Trash');
    tx(checking, d(18), 'Lone Star Auto Finance', -38_500, 'Car Payment');
    transfer(checking, savings, d(16), 100_000, 'Emergency fund');
    tx(visa, d(8), 'Xfinity', -7_000, 'Internet');
    tx(visa, d(22), 'Verizon', -8_500, 'Phone');
    tx(visa, d(3), 'Netflix', -1_549, 'Streaming');
    tx(visa, d(9), 'Spotify', -1_199, 'Streaming');
    tx(visa, d(2), 'Life Time Fitness', -5_900, 'Fitness');

    for (const day of [2, 9, 16, 23, 29]) tx(visa, d(Math.min(day, 28)), 'H-E-B', -between(8_200, 13_000), 'Groceries');
    tx(visa, d(13), "Trader Joe's", -between(3_100, 5_800), 'Groceries');
    for (const day of [4, 14, 25]) tx(visa, d(day), day === 14 ? "Buc-ee's" : 'Shell', -between(3_900, 5_600), 'Gas');
    const dining = ["Torchy's Tacos", 'Chick-fil-A', 'Local Foods', 'Blacksmith Coffee', 'Pappas Bros.', 'Tacos A Go Go'];
    const diningDays = current ? [3, 6, 10, 11, 14, 17] : [6, 11, 19, 27];
    diningDays.forEach((day, j) => tx(visa, d(day), dining[(i + j) % dining.length], -between(900, 5_200), 'Dining Out'));
    tx(visa, d(7), 'Target', -between(2_400, 7_800), 'Household Supplies');
    tx(visa, d(21), 'Amazon', -between(1_500, 4_900), i === 1 ? 'Clothing' : 'Household Supplies');
    tx(visa, d(10), 'AMC Theatres', -between(2_200, 4_400), 'Entertainment');
    if (i === 0) tx(checking, d(17), 'Memorial Hermann', -6_000, 'Medical', 'Copay');
    if (i === 1) tx(visa, d(24), 'Discount Tire', -12_800, 'Car Maintenance', 'Rotate & balance');
    if (i === 1) tx(visa, d(26), 'Etsy', -4_600, 'Gifts', "Mom's birthday");

    // Pay last month's card bill in full.
    if (!current && visaBalance < 0) transfer(checking, visa, d(26), -visaBalance, 'Statement balance');

    for (const [name, spec] of Object.entries(specs)) {
      // The sample leaves part of this month unassigned so there's something to do.
      const waitingOnPaycheck = current && asOf.slice(8) < '15' && name === 'Emergency Fund';
      if (waitingOnPaycheck) continue;
      if (current && ['Vacation', 'Gifts', 'Groceries', 'Clothing', 'Entertainment'].includes(name)) {
        if (name === 'Groceries') s = setAssigned(s, month, ids[name], 34_000);
        continue;
      }
      s = setAssigned(s, month, ids[name], spec.assign);
    }
    if (i === 0) {
      // Put the money already in savings to work, and seed the sinking funds.
      s = setAssigned(s, month, ids['Emergency Fund'], 100_000 + 650_000);
      s = setAssigned(s, month, ids.Vacation, 25_000 + 150_000);
      s = setAssigned(s, month, ids['Car Maintenance'], 5_000 + 60_000);
      s = setAssigned(s, month, ids.Gifts, 6_000 + 30_000);
      s = setAssigned(s, month, ids.Medical, 5_000 + 30_000);
    }
  }

  // Everything older than a few days has posted at the bank, both sides of transfers included.
  const posted = addDays(asOf, -3);
  s = {
    ...s,
    transactions: s.transactions.map((t) => (t.date < posted && t.cleared === 'uncleared' ? { ...t, cleared: 'cleared' } : t)),
  };

  const next = addMonths(thisMonth, 1);
  s = saveScheduled(s, {
    accountId: checking,
    payee: 'Westheimer Lofts',
    memo: '',
    amount: -165_000,
    categoryId: ids.Rent,
    frequency: 'monthly',
    nextDate: `${next}-01`,
  });
  s = saveScheduled(s, {
    accountId: checking,
    payee: 'Bayou City Design Co.',
    memo: 'Paycheck',
    amount: 285_000,
    categoryId: READY_TO_ASSIGN,
    frequency: 'twice-a-month',
    nextDate: asOf.slice(8) < '15' ? `${thisMonth}-15` : `${next}-01`,
  });
  s = saveScheduled(s, {
    accountId: visa,
    payee: 'Netflix',
    memo: '',
    amount: -1_549,
    categoryId: ids.Streaming,
    frequency: 'monthly',
    nextDate: `${next}-03`,
  });
  return s;
}
