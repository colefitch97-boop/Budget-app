import { useEffect, useState } from 'react';
import { categoryStatus } from '../lib/budget';
import { accountBalances } from '../lib/budget';
import { addDays, addMonths, formatDate, formatMonth, formatMonthName, monthOf, today } from '../lib/dates';
import { formatMoney, formatPlain, parseMoney } from '../lib/money';
import {
  AUTO_ASSIGN_LABELS,
  autoAssign,
  autoAssignPlan,
  setAssigned,
  setTarget,
  updateCategory,
  type AutoAssignStrategy,
} from '../lib/ops';
import { ageOfMoney } from '../lib/reports';
import { occurrencesThrough } from '../lib/schedule';
import type { Category, Cents, Target } from '../lib/types';
import { useApp } from '../state';
import { AvailablePill } from './BudgetView';
import { categoryName } from './pickers';
import { Icon, Money, MoneyInput, ProgressBar, Segmented } from './ui';

const STRATEGIES: AutoAssignStrategy[] = [
  'underfunded',
  'assigned-last-month',
  'spent-last-month',
  'average-assigned',
  'average-spent',
  'reset-available',
  'reset-assigned',
];

export function Inspector({ open, onClose, onBackToSummary }: { open: boolean; onClose: () => void; onBackToSummary: () => void }) {
  const { selectedCategory, state } = useApp();
  const cat = selectedCategory ? state.categories.find((c) => c.id === selectedCategory) : undefined;
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !document.querySelector('.modal') && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  return (
    <>
      {open && <div className="sheet-backdrop" onClick={onClose} aria-hidden="true" />}
      <aside className={`inspector${open ? ' sheet-open' : ''}`} aria-label={cat ? `${cat.name} details` : 'Month summary'}>
        <button type="button" className="icon-btn sheet-close" onClick={onClose} aria-label="Close">
          <Icon name="close" />
        </button>
        {cat ? <CategoryDetail cat={cat} onBack={onBackToSummary} /> : <MonthSummaryPanel />}
      </aside>
    </>
  );
}

function MonthSummaryPanel() {
  const { state, model, month, act } = useApp();
  const s = model.get(month);
  const aom = ageOfMoney(state);
  const name = formatMonthName(month, 'long');
  const horizon = addDays(today(), 30);
  const upcoming = state.scheduled
    .flatMap((x) => occurrencesThrough(x, horizon, 6).map((date) => ({ x, date })))
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .slice(0, 6);

  return (
    <div className="insp">
      <h2 className="insp-title">{name} summary</h2>
      <dl className="insp-list">
        <Row label={`Left over from ${formatMonthName(addMonths(month, -1), 'long')}`} cents={s.leftOverFromLastMonth} />
        <Row label={`Income in ${name}`} cents={s.incomeThisMonth} />
        <Row label={`Assigned in ${name}`} cents={-s.assignedThisMonth} />
        {s.overspentLastMonth !== 0 && <Row label="Overspent last month" cents={-s.overspentLastMonth} />}
        {s.assignedInFuture !== 0 && <Row label="Held for future months" cents={-s.assignedInFuture} />}
        <Row label="Ready to Assign" cents={s.readyToAssign} strong />
      </dl>

      <dl className="insp-list">
        <Row label="Total available in categories" cents={s.totalAvailable} />
        <Row label={`Activity in ${name}`} cents={s.activityThisMonth} />
        <div className="insp-row aom-row">
          <dt>Age of Money</dt>
          <dd className="aom">{aom === null ? 'Not enough history yet' : `${aom} ${aom === 1 ? 'day' : 'days'}`}</dd>
          <p className="hint">How long, on average, your money sits before you spend it. Higher is calmer.</p>
        </div>
      </dl>

      <section className="insp-section">
        <h3>Auto-assign</h3>
        <p className="muted-text">Each option shows how much it would add to, or take back from, this month’s categories.</p>
        <div className="auto-list">
          {STRATEGIES.map((strategy) => {
            const plan = autoAssignPlan(state, model, month, strategy);
            let delta = 0;
            for (const [id, value] of plan) delta += value - (s.categories[id]?.assigned ?? 0);
            return (
              <button
                key={strategy}
                type="button"
                className="auto-btn"
                disabled={plan.size === 0}
                onClick={() => act(`Assigned: ${AUTO_ASSIGN_LABELS[strategy].toLowerCase()}`, (st) => autoAssign(st, month, strategy), { toast: true })}
              >
                <span>{AUTO_ASSIGN_LABELS[strategy]}</span>
                <Money cents={delta} />
              </button>
            );
          })}
        </div>
      </section>

      {upcoming.length > 0 && (
        <section className="insp-section">
          <h3>Coming up in the next 30 days</h3>
          <ul className="upcoming">
            {upcoming.map(({ x, date }) => (
              <li key={x.id + date}>
                <span className="up-date">{formatDate(date, false)}</span>
                <span className="up-payee">{x.payee || (x.transferAccountId ? `Transfer` : 'Scheduled')}</span>
                <Money cents={x.amount} className={x.amount > 0 ? 'pos' : ''} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Row({ label, cents, strong }: { label: string; cents: Cents; strong?: boolean }) {
  return (
    <div className={`insp-row${strong ? ' strong' : ''}`}>
      <dt>{label}</dt>
      <dd>
        <Money cents={cents} />
      </dd>
    </div>
  );
}

function CategoryDetail({ cat, onBack }: { cat: Category; onBack: () => void }) {
  const { state, model, month, act, openDialog, go } = useApp();
  const s = model.get(month);
  const cm = s.categories[cat.id];
  const [editingTarget, setEditingTarget] = useState(false);
  const [note, setNote] = useState(cat.note);
  useEffect(() => setNote(cat.note), [cat.id, cat.note]);
  useEffect(() => setEditingTarget(false), [cat.id]);
  if (!cm) return null;

  const card = cat.creditAccountId ? state.accounts.find((a) => a.id === cat.creditAccountId) : undefined;
  const cardBalance = card ? (accountBalances(state).get(card.id)?.working ?? 0) : 0;
  const status = categoryStatus(cm, cat.hidden);
  const recent = state.transactions
    .filter(
      (t) =>
        monthOf(t.date) === month && (t.categoryId === cat.id || t.splits?.some((x) => x.categoryId === cat.id)),
    )
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, 6);

  return (
    <div className="insp">
      <button type="button" className="back-link" onClick={onBack}>
        <Icon name="left" size={16} /> {formatMonthName(month, 'long')} summary
      </button>
      <div className="insp-head">
        <h2 className="insp-title">{cat.name}</h2>
        <button type="button" className="icon-btn" onClick={() => openDialog({ kind: 'category', categoryId: cat.id })} aria-label={`Edit ${cat.name}`}>
          <Icon name="edit" />
        </button>
      </div>

      <div className="insp-available">
        <span className="label">Available</span>
        <AvailablePill cm={cm} hidden={cat.hidden} large onClick={() => openDialog({ kind: 'move', categoryId: cat.id })} />
      </div>
      {status === 'cash-overspent' && (
        <p className="callout callout-neg">
          You spent {formatMoney(-cm.available)} more than you had here. Cover it by moving money from another category, or it comes out of next
          month’s Ready to Assign.
        </p>
      )}
      {status === 'credit-overspent' && (
        <p className="callout callout-warn">
          {formatMoney(cm.creditOverspent)} of credit card spending isn’t covered. Move money here so you can pay it off, or it stays on the card as
          debt.
        </p>
      )}

      <dl className="insp-list">
        <Row label={`Left over from ${formatMonthName(addMonths(month, -1), 'long')}`} cents={cm.carryover} />
        <div className="insp-row">
          <dt>
            <label htmlFor="insp-assigned">Assigned in {formatMonthName(month, 'long')}</label>
          </dt>
          <dd>
            <MoneyInput
              id="insp-assigned"
              value={cm.assigned}
              relative
              className="insp-input"
              onCommit={(v) => act(`Assigned to ${cat.name}`, (st) => setAssigned(st, month, cat.id, v))}
            />
          </dd>
        </div>
        {card ? (
          <Row label="Card spending and payments" cents={cm.activity} />
        ) : (
          <>
            <Row label="Cash spending" cents={-cm.cashSpending} />
            <Row label="Credit card spending" cents={-cm.creditSpending} />
          </>
        )}
        <Row label="Available" cents={cm.available} strong />
      </dl>

      {card && (
        <section className="insp-section">
          <h3>Paying {card.name}</h3>
          <p className="muted-text">
            When you spend on this card from a funded category, that money moves here so the bill is covered. The card balance is{' '}
            <strong>{formatMoney(Math.abs(cardBalance))}</strong>
            {cardBalance < 0 ? ' owed' : ' in credit'}.
          </p>
          {cardBalance < 0 && cm.available < -cardBalance && (
            <p className="muted-text">
              {formatMoney(-cardBalance - Math.max(0, cm.available))} of the balance isn’t covered yet. Assign money here to pay it down.
            </p>
          )}
          <button type="button" className="btn btn-secondary" onClick={() => openDialog({ kind: 'transaction', accountId: card.id, preset: 'payment' })}>
            Record a payment
          </button>
        </section>
      )}

      {!card && (
        <section className="insp-section">
          <h3>Target</h3>
          {editingTarget ? (
            <TargetEditor
              cat={cat}
              onDone={(target) => {
                act(target ? `Target set for ${cat.name}` : `Target removed from ${cat.name}`, (st) => setTarget(st, cat.id, target));
                setEditingTarget(false);
              }}
              onCancel={() => setEditingTarget(false)}
            />
          ) : cm.target ? (
            <div className="target-card">
              <p className="target-summary">{cm.target.summary}</p>
              <ProgressBar value={cm.target.progress} tone={cm.target.needed > 0 ? 'warn' : 'pos'} />
              <p className="target-status">
                {cm.target.needed > 0 ? (
                  <>
                    Assign <strong>{formatMoney(cm.target.needed)}</strong> more this month to stay on track.
                  </>
                ) : (
                  <>On track for {formatMonthName(month, 'long')}.</>
                )}
              </p>
              <div className="btn-row">
                {cm.target.needed > 0 && (
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={() => act(`Assigned to ${cat.name}`, (st) => setAssigned(st, month, cat.id, cm.assigned + cm.target!.needed))}
                  >
                    Assign {formatMoney(cm.target.needed)}
                  </button>
                )}
                <button type="button" className="btn btn-quiet btn-sm" onClick={() => setEditingTarget(true)}>
                  Edit target
                </button>
              </div>
            </div>
          ) : (
            <>
              <p className="muted-text">Tell Allot what this category needs and it will show what to assign each month.</p>
              <button type="button" className="btn btn-secondary" onClick={() => setEditingTarget(true)}>
                <Icon name="target" size={16} /> Create target
              </button>
            </>
          )}
        </section>
      )}

      <section className="insp-section">
        <h3>Auto-assign</h3>
        <div className="auto-list">
          {STRATEGIES.filter((x) => x !== 'underfunded' || cm.target).map((strategy) => {
            const value = autoAssignPlan(state, model, month, strategy, [cat.id]).get(cat.id);
            return (
              <button
                key={strategy}
                type="button"
                className="auto-btn"
                disabled={value === undefined}
                onClick={() => act(`Assigned to ${cat.name}`, (st) => setAssigned(st, month, cat.id, value!))}
              >
                <span>{AUTO_ASSIGN_LABELS[strategy]}</span>
                <Money cents={value ?? cm.assigned} />
              </button>
            );
          })}
        </div>
      </section>

      <section className="insp-section">
        <h3>
          <label htmlFor="cat-note">Notes</label>
        </h3>
        <textarea
          id="cat-note"
          className="field"
          rows={2}
          value={note}
          placeholder="Due dates, account numbers, reminders…"
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => note !== cat.note && act('Note saved', (st) => updateCategory(st, cat.id, { note }))}
        />
      </section>

      <section className="insp-section">
        <h3>Activity in {formatMonth(month)}</h3>
        {recent.length ? (
          <ul className="recent">
            {recent.map((t) => {
              const part = t.splits?.find((x) => x.categoryId === cat.id);
              return (
                <li key={t.id}>
                  <button type="button" onClick={() => openDialog({ kind: 'transaction', transactionId: t.id })}>
                    <span className="up-date">{formatDate(t.date, false)}</span>
                    <span className="up-payee">{t.payee || categoryName(state, t.categoryId)}</span>
                    <Money cents={part ? part.amount : t.amount} />
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="muted-text">No transactions this month.</p>
        )}
        {recent.length > 0 && (
          <button type="button" className="btn btn-quiet btn-sm" onClick={() => go({ view: 'account', accountId: 'all' })}>
            See all transactions
          </button>
        )}
      </section>
    </div>
  );
}

function TargetEditor({ cat, onDone, onCancel }: { cat: Category; onDone: (t: Target | undefined) => void; onCancel: () => void }) {
  const { month } = useApp();
  const existing = cat.target;
  const [kind, setKind] = useState<'monthly' | 'balance'>(existing?.type ?? 'monthly');
  const [mode, setMode] = useState<'set-aside' | 'refill'>(existing?.type === 'monthly' ? existing.mode : 'set-aside');
  const [amount, setAmount] = useState(existing ? formatPlain(existing.amount) : '');
  const [hasDate, setHasDate] = useState(existing?.type === 'balance' ? !!existing.by : false);
  const [by, setBy] = useState(existing?.type === 'balance' && existing.by ? existing.by : addMonths(month, 6));
  const cents = parseMoney(amount);
  const valid = cents !== null && cents > 0;

  const save = () => {
    if (!valid) return;
    onDone(kind === 'monthly' ? { type: 'monthly', amount: cents, mode } : { type: 'balance', amount: cents, ...(hasDate ? { by } : {}) });
  };

  return (
    <form
      className="target-editor"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <Segmented
        label="Kind of target"
        value={kind}
        onChange={setKind}
        options={[
          { value: 'monthly', label: 'Every month' },
          { value: 'balance', label: 'Save up' },
        ]}
      />
      <div className="form-field">
        <label htmlFor="target-amount">{kind === 'monthly' ? 'Amount needed each month' : 'Balance to reach'}</label>
        <input
          id="target-amount"
          className="field money-field"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0.00"
          autoFocus
        />
      </div>
      {kind === 'monthly' ? (
        <fieldset className="radio-list">
          <legend className="sr-only">How the monthly amount works</legend>
          <label>
            <input type="radio" name="target-mode" checked={mode === 'set-aside'} onChange={() => setMode('set-aside')} />
            <span>
              <strong>Set aside</strong> this much every month
              <span className="hint">For bills: rent, phone, subscriptions.</span>
            </span>
          </label>
          <label>
            <input type="radio" name="target-mode" checked={mode === 'refill'} onChange={() => setMode('refill')} />
            <span>
              <strong>Refill up to</strong> this much every month
              <span className="hint">Leftovers count, so you only top up what you spent.</span>
            </span>
          </label>
        </fieldset>
      ) : (
        <div className="form-field">
          <label className="check">
            <input type="checkbox" checked={hasDate} onChange={(e) => setHasDate(e.target.checked)} /> By a certain month
          </label>
          {hasDate && (
            <input
              id="target-by"
              className="field"
              type="month"
              value={by}
              min={month}
              onChange={(e) => e.target.value && setBy(e.target.value)}
              aria-label="Target month"
            />
          )}
          {hasDate && valid && <p className="field-hint">Allot spreads what’s left over the months until {formatMonth(by)}.</p>}
        </div>
      )}
      <div className="btn-row">
        <button type="submit" className="btn btn-primary btn-sm" disabled={!valid}>
          Save target
        </button>
        <button type="button" className="btn btn-quiet btn-sm" onClick={onCancel}>
          Cancel
        </button>
        {existing && (
          <button type="button" className="btn btn-danger-quiet btn-sm" onClick={() => onDone(undefined)}>
            Remove
          </button>
        )}
      </div>
    </form>
  );
}
