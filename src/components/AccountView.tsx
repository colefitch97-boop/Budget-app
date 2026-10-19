import { useEffect, useMemo, useState } from 'react';
import { accountBalances } from '../lib/budget';
import { formatDate } from '../lib/dates';
import { formatMoney } from '../lib/money';
import { canHaveCategory, categorize, deleteTransactions, enterScheduled, setCleared, skipScheduled } from '../lib/ops';
import { FREQUENCY_LABELS } from '../lib/schedule';
import { ACCOUNT_TYPE_LABELS, READY_TO_ASSIGN, type BudgetState, type ID, type Transaction } from '../lib/types';
import { useApp } from '../state';
import { CategorySelect, categoryName } from './pickers';
import { EmptyState, Icon, Menu, Money } from './ui';

const PAGE = 150;

export function AccountView({ accountId, initialFilter }: { accountId: ID | 'all'; initialFilter?: 'uncategorized' | 'uncleared' }) {
  const { state, act, openDialog, go } = useApp();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'uncategorized' | 'uncleared'>(initialFilter ?? 'all');
  const [selected, setSelected] = useState<Set<ID>>(new Set());
  const [limit, setLimit] = useState(PAGE);
  const [bulkCategory, setBulkCategory] = useState<ID | null>(null);

  useEffect(() => {
    setSelected(new Set());
    setLimit(PAGE);
    setFilter(initialFilter ?? 'all');
  }, [accountId, initialFilter]);

  const account = accountId === 'all' ? undefined : state.accounts.find((a) => a.id === accountId);
  const accounts = useMemo(() => new Map(state.accounts.map((a) => [a.id, a])), [state.accounts]);
  const balances = useMemo(() => accountBalances(state), [state]);

  const all = accountId === 'all';
  const rows = useMemo(() => {
    let list = state.transactions.filter((t) => all || t.accountId === accountId);
    if (filter === 'uncategorized') list = list.filter((t) => t.categoryId === null && !t.splits && canHaveCategory(t, accounts));
    if (filter === 'uncleared') list = list.filter((t) => t.cleared === 'uncleared');
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter((t) =>
        [t.payee, t.memo, categoryName(state, t.categoryId), transferLabel(t, accounts), formatMoney(Math.abs(t.amount))]
          .join(' ')
          .toLowerCase()
          .includes(q),
      );
    }
    // Newest first; for a single account also show the running balance.
    const sorted = [...list].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    return sorted;
  }, [state, accountId, all, filter, query, accounts]);

  const running = useMemo(() => {
    if (all) return null;
    const map = new Map<ID, number>();
    const chronological = state.transactions
      .filter((t) => t.accountId === accountId)
      .map((t, i) => ({ t, i }))
      .sort((a, b) => (a.t.date < b.t.date ? -1 : a.t.date > b.t.date ? 1 : a.i - b.i));
    let bal = 0;
    for (const { t } of chronological) {
      bal += t.amount;
      map.set(t.id, bal);
    }
    return map;
  }, [state.transactions, accountId, all]);

  if (!all && !account) {
    return (
      <div className="page">
        <EmptyState title="This account no longer exists" action={<button className="btn btn-secondary" onClick={() => go({ view: 'budget' })}>Back to budget</button>} />
      </div>
    );
  }

  const bal = account ? balances.get(account.id)! : null;
  const total = all
    ? [...balances.entries()].filter(([id]) => !accounts.get(id)?.closed).reduce((s, [, b]) => s + b.working, 0)
    : 0;
  const schedules = state.scheduled
    .filter((x) => all || x.accountId === accountId || x.transferAccountId === accountId)
    .sort((a, b) => (a.nextDate < b.nextDate ? -1 : 1));
  const visible = rows.slice(0, limit);
  const allVisibleSelected = visible.length > 0 && visible.every((t) => selected.has(t.id));
  const toggle = (id: ID) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  return (
    <div className="page register">
      <header className="page-head">
        <div>
          <p className="eyebrow">{account ? ACCOUNT_TYPE_LABELS[account.type] + (account.closed ? ' · closed' : '') : 'Every account'}</p>
          <h1>{account ? account.name : 'All Accounts'}</h1>
        </div>
        <div className="head-actions">
          <button type="button" className="btn btn-primary" onClick={() => openDialog({ kind: 'transaction', accountId: account?.id })}>
            <Icon name="plus" size={16} /> Add transaction
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => openDialog({ kind: 'import', accountId: account?.id })}>
            <Icon name="upload" size={16} /> Import
          </button>
          {account && (
            <Menu
              label="More account actions"
              trigger={
                <span className="btn btn-secondary btn-icon">
                  <Icon name="more" />
                </span>
              }
              items={[
                { label: 'Reconcile', onSelect: () => openDialog({ kind: 'reconcile', accountId: account.id }) },
                { label: 'Edit account', onSelect: () => openDialog({ kind: 'account', accountId: account.id }) },
              ]}
            />
          )}
        </div>
      </header>

      <div className="balances">
        {bal ? (
          <>
            <Balance label="Cleared" cents={bal.cleared} hint="What the bank has posted" />
            <span className="op" aria-hidden="true">+</span>
            <Balance label="Uncleared" cents={bal.uncleared} hint="Entered here, not posted yet" />
            <span className="op" aria-hidden="true">=</span>
            <Balance label="Working balance" cents={bal.working} strong />
            {account && (
              <button type="button" className="btn btn-quiet btn-sm reconcile-btn" onClick={() => openDialog({ kind: 'reconcile', accountId: account.id })}>
                <Icon name="lock" size={16} /> Reconcile
              </button>
            )}
          </>
        ) : (
          <Balance label="Total of open accounts" cents={total} strong />
        )}
      </div>

      {schedules.length > 0 && (
        <section className="scheduled">
          <h2 className="section-label">
            <Icon name="repeat" size={16} /> Scheduled
          </h2>
          <ul>
            {schedules.map((x) => {
              const amountHere = x.accountId === accountId || all ? x.amount : -x.amount;
              const label = x.transferAccountId
                ? `Transfer ${amountHere < 0 ? 'to' : 'from'} ${accounts.get(x.accountId === accountId || all ? x.transferAccountId : x.accountId)?.name ?? 'account'}`
                : x.payee;
              return (
                <li key={x.id} className="sched-row">
                  <span className="sched-date">{formatDate(x.nextDate, false)}</span>
                  <span className="sched-payee">
                    {label}
                    <span className="sched-meta">
                      {FREQUENCY_LABELS[x.frequency]}
                      {x.categoryId ? ` · ${categoryName(state, x.categoryId)}` : ''}
                      {all ? ` · ${accounts.get(x.accountId)?.name ?? ''}` : ''}
                    </span>
                  </span>
                  <Money cents={amountHere} className={amountHere > 0 ? 'pos' : ''} />
                  <span className="sched-actions">
                    <button type="button" className="btn btn-quiet btn-sm" onClick={() => act('Entered scheduled transaction', (s) => enterScheduled(s, x.id), { toast: true })}>
                      Enter now
                    </button>
                    <Menu
                      label={`More actions for ${label}`}
                      trigger={
                        <span className="icon-btn icon-btn-sm">
                          <Icon name="more" size={16} />
                        </span>
                      }
                      items={[
                        { label: 'Edit schedule', onSelect: () => openDialog({ kind: 'transaction', scheduledId: x.id }) },
                        { label: 'Skip this one', onSelect: () => act('Skipped', (s) => skipScheduled(s, x.id), { toast: true }) },
                      ]}
                    />
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <div className="register-tools">
        <label className="search">
          <Icon name="search" size={16} />
          <span className="sr-only">Search transactions</span>
          <input id="txn-search" type="search" placeholder="Search payee, memo, category or amount" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <select id="txn-filter" className="field field-sm" value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} aria-label="Filter transactions">
          <option value="all">All transactions</option>
          <option value="uncategorized">Needs a category</option>
          <option value="uncleared">Not cleared yet</option>
        </select>
      </div>

      {selected.size > 0 && (
        <div className="bulk-bar" role="region" aria-label="Selected transactions">
          <strong>{selected.size} selected</strong>
          <div className="bulk-cat">
            <CategorySelect
              id="bulk-category"
              state={state}
              value={bulkCategory}
              onChange={setBulkCategory}
              includeReadyToAssign
              placeholder="Choose a category…"
              ariaLabel="Category for selected transactions"
            />
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={!bulkCategory}
              onClick={() => {
                act(`Categorized ${selected.size} transactions`, (s) => categorize(s, [...selected], bulkCategory), { toast: true });
                setSelected(new Set());
              }}
            >
              Categorize
            </button>
          </div>
          <button
            type="button"
            className="btn btn-quiet btn-sm"
            onClick={() => {
              act('Marked cleared', (s) => setCleared(s, [...selected].filter((id) => !isReconciled(s, id)), 'cleared'), { toast: true });
              setSelected(new Set());
            }}
          >
            Mark cleared
          </button>
          <button
            type="button"
            className="btn btn-danger-quiet btn-sm"
            onClick={() => {
              act(`Deleted ${selected.size} ${selected.size === 1 ? 'transaction' : 'transactions'}`, (s) => deleteTransactions(s, [...selected]), { toast: true });
              setSelected(new Set());
            }}
          >
            Delete
          </button>
          <button type="button" className="btn btn-quiet btn-sm" onClick={() => setSelected(new Set())}>
            Clear selection
          </button>
        </div>
      )}

      {rows.length === 0 ? (
        <EmptyState
          title={query || filter !== 'all' ? 'No matching transactions' : 'No transactions yet'}
          action={
            !query && filter === 'all' ? (
              <div className="btn-row center">
                <button type="button" className="btn btn-primary" onClick={() => openDialog({ kind: 'transaction', accountId: account?.id })}>
                  Add a transaction
                </button>
                <button type="button" className="btn btn-secondary" onClick={() => openDialog({ kind: 'import', accountId: account?.id })}>
                  Import from your bank
                </button>
              </div>
            ) : undefined
          }
        >
          {!query && filter === 'all' ? 'Enter transactions as you spend, or download a file from your bank and import it.' : undefined}
        </EmptyState>
      ) : (
        <div className="txn-table-wrap">
          <table className={`txn-table${all ? ' with-account' : ''}${running ? ' with-balance' : ''}`}>
            <thead>
              <tr>
                <th className="col-check">
                  <input
                    type="checkbox"
                    aria-label="Select all shown"
                    checked={allVisibleSelected}
                    onChange={() => setSelected(allVisibleSelected ? new Set() : new Set(visible.map((t) => t.id)))}
                  />
                </th>
                <th className="col-date">Date</th>
                {all && <th className="col-account">Account</th>}
                <th className="col-payee">Payee</th>
                <th className="col-category">Category</th>
                <th className="col-memo">Memo</th>
                <th className="num col-out">Outflow</th>
                <th className="num col-in">Inflow</th>
                <th className="col-cleared">
                  <span className="sr-only">Cleared</span>
                </th>
                {running && <th className="num col-balance">Balance</th>}
              </tr>
            </thead>
            <tbody>
              {visible.map((t) => (
                <TxnRow
                  key={t.id}
                  t={t}
                  state={state}
                  accounts={accounts}
                  showAccount={all}
                  balance={running?.get(t.id)}
                  selected={selected.has(t.id)}
                  onSelect={() => toggle(t.id)}
                />
              ))}
            </tbody>
          </table>
          {rows.length > limit && (
            <button type="button" className="btn btn-secondary show-more" onClick={() => setLimit(limit + PAGE)}>
              Show {Math.min(PAGE, rows.length - limit)} more of {rows.length - limit}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function isReconciled(s: BudgetState, id: ID) {
  return s.transactions.find((t) => t.id === id)?.cleared === 'reconciled';
}

function Balance({ label, cents, hint, strong }: { label: string; cents: number; hint?: string; strong?: boolean }) {
  return (
    <div className={`balance${strong ? ' strong' : ''}`} title={hint}>
      <span className="balance-label">{label}</span>
      <Money cents={cents} className={cents < 0 ? 'neg' : ''} />
    </div>
  );
}

function transferLabel(t: Transaction, accounts: Map<ID, { name: string }>): string {
  if (!t.transferAccountId) return '';
  const name = accounts.get(t.transferAccountId)?.name ?? 'account';
  return t.amount < 0 ? `Transfer to ${name}` : `Transfer from ${name}`;
}

function TxnRow({
  t,
  state,
  accounts,
  showAccount,
  balance,
  selected,
  onSelect,
}: {
  t: Transaction;
  state: BudgetState;
  accounts: Map<ID, BudgetState['accounts'][number]>;
  showAccount: boolean;
  balance?: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const { act, openDialog } = useApp();
  const payee = t.transferAccountId ? transferLabel(t, accounts) : t.payee || '(no payee)';
  const needsCategory = t.categoryId === null && !t.splits && canHaveCategory(t, accounts);
  const category = t.splits
    ? `Split (${t.splits.length})`
    : t.categoryId === READY_TO_ASSIGN
      ? 'Ready to Assign'
      : t.categoryId
        ? categoryName(state, t.categoryId)
        : needsCategory
          ? 'Needs a category'
          : '';
  const open = () => openDialog({ kind: 'transaction', transactionId: t.id });
  const cycle = () => {
    if (t.cleared === 'reconciled') return;
    act(t.cleared === 'cleared' ? 'Marked uncleared' : 'Marked cleared', (s) => setCleared(s, [t.id], t.cleared === 'cleared' ? 'uncleared' : 'cleared'));
  };
  return (
    <tr
      className={`${selected ? 'selected ' : ''}${t.cleared === 'uncleared' ? 'uncleared' : ''}`}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('input, button')) return;
        open();
      }}
    >
      <td className="col-check">
        <input type="checkbox" checked={selected} onChange={onSelect} aria-label={`Select ${payee} on ${formatDate(t.date)}`} />
      </td>
      <td className="col-date">{formatDate(t.date, false)}</td>
      {showAccount && <td className="col-account">{accounts.get(t.accountId)?.name}</td>}
      <td className="col-payee">
        <button type="button" className="link-cell" onClick={open}>
          {t.transferAccountId && <Icon name="transfer" size={14} />}
          {payee}
        </button>
        <span className="m-meta">
          {formatDate(t.date, false)}
          {category ? ` · ${category}` : ''}
          {showAccount ? ` · ${accounts.get(t.accountId)?.name ?? ''}` : ''}
        </span>
      </td>
      <td className={`col-category${needsCategory ? ' needs' : ''}`}>{category}</td>
      <td className="col-memo">{t.memo}</td>
      <td className="num col-out">{t.amount < 0 ? formatMoney(-t.amount) : ''}</td>
      <td className="num col-in">{t.amount > 0 ? formatMoney(t.amount) : ''}</td>
      <td className="col-cleared">
        <button
          type="button"
          className={`cleared-btn ${t.cleared}`}
          onClick={cycle}
          aria-label={t.cleared === 'reconciled' ? 'Reconciled' : t.cleared === 'cleared' ? 'Cleared; mark uncleared' : 'Uncleared; mark cleared'}
          title={t.cleared === 'reconciled' ? 'Reconciled' : t.cleared === 'cleared' ? 'Cleared' : 'Not cleared yet'}
        >
          {t.cleared === 'reconciled' ? <Icon name="lock" size={13} /> : 'C'}
        </button>
      </td>
      {balance !== undefined && <td className={`num col-balance${balance < 0 ? ' neg' : ''}`}>{formatMoney(balance)}</td>}
      <td className="m-amount">
        <Money cents={t.amount} className={t.amount > 0 ? 'pos' : ''} />
      </td>
    </tr>
  );
}
