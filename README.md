# Allot

A zero-based "envelope" budgeting app in the spirit of YNAB (You Need A Budget).
Every dollar you have gets a job before you spend it; when plans change, you move
money between jobs.

## What it does

**Budget**
- **Ready to Assign**: income and starting balances land here until you give them a job.
- **Assigned / Activity / Available** for every category, month by month. Leftover
  money rolls into next month automatically.
- **Overspending, handled the YNAB way**: cash overspending comes out of next month's
  Ready to Assign; credit-card overspending stays on the card as debt. Cover either by
  moving money from another category.
- **Credit cards**: each card gets a payment category. Spending on the card from a
  funded category moves that money into the payment category so the bill is covered.
- **Targets**: "set aside $X each month", "refill up to $X", or "save $X (by a date)".
  Underfunded categories are flagged, and one click assigns what they need.
- **Auto-assign**: underfunded, assigned last month, spent last month, averages, or reset.
- **Age of Money**, a month summary, filters (underfunded, overspent, money available),
  hidden categories, notes, and quick math in amount fields (`+25`, `45.10+12`).

**Accounts**
- Checking, savings, cash and credit cards on budget; assets and loans as tracking accounts.
- Register with search, filters, running balance, cleared status, bulk categorize and delete.
- Transfers (kept in sync on both sides), split transactions, scheduled/recurring transactions.
- **Reconcile** against the bank, with an automatic adjustment when they differ.
- **Import** CSV, OFX or QFX files from your bank, with column matching, duplicate
  detection and categories remembered from past payees.

**Reports**: spending by category or group, income vs. spending, and net worth over time.

**Everything else**: undo (Ctrl/Cmd+Z), light and dark themes, phone layout, JSON backup
and restore, CSV export, and a sample budget to explore before starting your own.

## Where data is saved

- **On claude.ai** (the published artifact), the budget is saved to the artifact's private
  per-person store, so it follows you across devices and nobody you share the page with
  can read it.
- **Anywhere else** (`npm run dev`, a self-hosted build), it is saved in the browser's
  localStorage. Use Settings → Download backup now and then.

There is no bank connection; enter transactions as you go or import files your bank provides.

## Running it

```bash
npm install
npm run dev            # http://localhost:5173
npm test               # budgeting engine, parsing and storage tests
npm run build          # static site in dist/
npm run build:artifact # single-page build for claude.ai in artifact/allot.html
```

## How the code is organized

```
src/lib/budget.ts      the budgeting engine: derives every number from transactions + assignments
src/lib/ops.ts         every change to a budget, as pure (state) => state functions
src/lib/reports.ts     age of money, spending, cash flow, net worth
src/lib/bankImport.ts  CSV / OFX parsing and column guessing
src/lib/schedule.ts    recurring-transaction dates
src/lib/storage.ts     cloud (claude.ai) and browser persistence
src/lib/sample.ts      the example budget
src/state.tsx          app state, undo history, routing, dialogs
src/components/        the screens and dialogs
```

Money is stored as integer cents. Nothing derived (balances, available amounts, Ready to
Assign) is stored, so the numbers can't drift out of sync with the transactions.
