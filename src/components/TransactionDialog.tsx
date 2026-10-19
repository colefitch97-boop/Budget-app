import { useMemo, useState } from 'react';
import { accountBalances } from '../lib/budget';
import { today } from '../lib/dates';
import { newId } from '../lib/ids';
import { formatMoney, formatPlain, parseMoney } from '../lib/money';
import { deleteScheduled, deleteTransactions, normalizePayee, payeeCategories, saveScheduled, saveTransaction } from '../lib/ops';
import { FREQUENCY_LABELS } from '../lib/schedule';
import { READY_TO_ASSIGN, isCredit, isOnBudget, type Frequency, type ID } from '../lib/types';
import { useApp, type Dialog } from '../state';
import { AccountSelect, CategorySelect } from './pickers';
import { Field, Icon, Modal, Segmented } from './ui';

type Kind = 'expense' | 'income' | 'transfer';

interface SplitDraft {
  id: ID;
  categoryId: ID | null;
  amount: string;
  memo: string;
}

export function TransactionDialog({ dialog }: { dialog: Extract<Dialog, { kind: 'transaction' }> }) {
  const { state, model, month, act, closeDialog, toast } = useApp();
  const accounts = useMemo(() => new Map(state.accounts.map((a) => [a.id, a])), [state.accounts]);
  const existing = dialog.transactionId ? state.transactions.find((t) => t.id === dialog.transactionId) : undefined;
  const schedule = dialog.scheduledId ? state.scheduled.find((x) => x.id === dialog.scheduledId) : undefined;
  const source = existing ?? schedule;
  const openAccounts = state.accounts.filter((a) => !a.closed);

  const initial = useMemo(() => {
    if (source) {
      const amount = source.amount;
      const transferId = source.transferAccountId;
      let categoryId = source.categoryId;
      if (existing?.transferAccountId && existing.transferId && !isOnBudget(accounts.get(existing.accountId)?.type ?? 'checking')) {
        categoryId = state.transactions.find((t) => t.id === existing.transferId)?.categoryId ?? null;
      }
      const kind: Kind = transferId ? 'transfer' : amount >= 0 ? 'income' : 'expense';
      const sign = kind === 'expense' ? -1 : 1;
      return {
        kind,
        accountId: source.accountId,
        date: existing ? existing.date : schedule!.nextDate,
        amount: formatPlain(Math.abs(amount), false),
        payee: source.payee,
        categoryId,
        memo: source.memo,
        cleared: existing ? existing.cleared !== 'uncleared' : false,
        transferAccountId: transferId ?? '',
        direction: (amount < 0 ? 'to' : 'from') as 'to' | 'from',
        repeat: (schedule ? schedule.frequency : 'never') as Frequency | 'never',
        splits: existing?.splits
          ? existing.splits.map((x) => ({ id: x.id, categoryId: x.categoryId, amount: formatPlain(x.amount * sign, false), memo: x.memo }))
          : null,
      };
    }
    if (dialog.preset === 'payment' && dialog.accountId) {
      const card = dialog.accountId;
      const from = openAccounts.find((a) => isOnBudget(a.type) && !isCredit(a.type));
      const owed = -(accountBalances(state).get(card)?.working ?? 0);
      const payment = state.categories.find((c) => c.creditAccountId === card);
      const available = payment ? (model.get(month).categories[payment.id]?.available ?? 0) : 0;
      const amount = Math.max(0, Math.min(owed, available > 0 ? available : owed));
      return {
        kind: 'transfer' as Kind,
        accountId: from?.id ?? '',
        date: today(),
        amount: amount ? formatPlain(amount, false) : '',
        payee: '',
        categoryId: null,
        memo: '',
        cleared: false,
        transferAccountId: card,
        direction: 'to' as const,
        repeat: 'never' as const,
        splits: null,
      };
    }
    const accountId = dialog.accountId ?? openAccounts.find((a) => isOnBudget(a.type))?.id ?? openAccounts[0]?.id ?? '';
    return {
      kind: 'expense' as Kind,
      accountId,
      date: today(),
      amount: '',
      payee: '',
      categoryId: dialog.categoryId ?? null,
      memo: '',
      cleared: false,
      transferAccountId: '',
      direction: 'to' as const,
      repeat: 'never' as const,
      splits: null,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [kind, setKind] = useState<Kind>(initial.kind);
  const [accountId, setAccountId] = useState<ID>(initial.accountId);
  const [date, setDate] = useState(initial.date);
  const [amount, setAmount] = useState(initial.amount);
  const [payee, setPayee] = useState(initial.payee);
  const [categoryId, setCategoryId] = useState<ID | null>(initial.categoryId);
  const [categoryTouched, setCategoryTouched] = useState(!!source);
  const [memo, setMemo] = useState(initial.memo);
  const [cleared, setClearedFlag] = useState(initial.cleared);
  const [transferAccountId, setTransferAccountId] = useState<ID>(initial.transferAccountId);
  const [direction, setDirection] = useState<'to' | 'from'>(initial.direction);
  const [repeat, setRepeat] = useState<Frequency | 'never'>(initial.repeat);
  const [splits, setSplits] = useState<SplitDraft[] | null>(initial.splits);
  const [error, setError] = useState<string | null>(null);

  const payeeMemory = useMemo(() => payeeCategories(state), [state]);
  const payees = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of state.transactions) if (t.payee && !t.transferAccountId) counts.set(t.payee, (counts.get(t.payee) ?? 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1]).map(([p]) => p).slice(0, 300);
  }, [state.transactions]);

  const account = accounts.get(accountId);
  const other = transferAccountId ? accounts.get(transferAccountId) : undefined;
  const crossesBudget = kind === 'transfer' && account && other && isOnBudget(account.type) !== isOnBudget(other.type);
  const accountOnBudget = account ? isOnBudget(account.type) : true;
  const needsCategory = kind === 'transfer' ? !!crossesBudget : accountOnBudget;
  const isScheduled = !!schedule || (!existing && (repeat !== 'never' || date > today()));
  const cents = parseMoney(amount);

  const sign = kind === 'expense' ? -1 : kind === 'income' ? 1 : direction === 'to' ? -1 : 1;
  const splitTotal = splits?.reduce((sum, x) => sum + (parseMoney(x.amount) ?? 0), 0) ?? 0;

  const onPayee = (value: string) => {
    setPayee(value);
    if (categoryTouched || splits) return;
    const remembered = payeeMemory.get(normalizePayee(value));
    if (remembered === undefined) return;
    if (remembered === READY_TO_ASSIGN && kind === 'expense') return;
    setCategoryId(remembered);
    if (remembered === READY_TO_ASSIGN) setKind('income');
  };

  const changeKind = (k: Kind) => {
    setKind(k);
    if (k === 'income' && !categoryTouched) setCategoryId(READY_TO_ASSIGN);
    if (k === 'expense' && categoryId === READY_TO_ASSIGN) setCategoryId(null);
    if (k === 'transfer') setSplits(null);
  };

  const submit = (another: boolean) => {
    setError(null);
    if (!account) return setError('Choose an account.');
    if (cents === null || cents <= 0) return setError('Enter an amount greater than zero.');
    if (kind === 'transfer' && (!other || other.id === account.id)) return setError('Choose the other account for this transfer.');
    if (splits) {
      if (splits.some((x) => parseMoney(x.amount) === null)) return setError('One of the split amounts isn’t a number.');
      if (splitTotal !== cents) return setError(`The splits add up to ${formatMoney(splitTotal)}, not ${formatMoney(cents)}.`);
    }
    const signed = sign * cents;
    const transfer = kind === 'transfer' ? other!.id : undefined;
    const cat = needsCategory ? categoryId : null;

    if (isScheduled) {
      act(schedule ? 'Schedule updated' : 'Scheduled', (s) =>
        saveScheduled(s, {
          id: schedule?.id,
          accountId: account.id,
          payee: transfer ? '' : payee,
          memo,
          amount: signed,
          categoryId: cat,
          transferAccountId: transfer,
          frequency: repeat === 'never' ? 'once' : repeat,
          nextDate: date,
        }),
      );
      toast(schedule ? 'Schedule updated' : `Scheduled for ${date}`);
      closeDialog();
      return;
    }

    act(existing ? 'Transaction saved' : 'Transaction added', (s) =>
      saveTransaction(s, {
        id: existing?.id,
        accountId: account.id,
        date,
        payee,
        memo,
        amount: signed,
        categoryId: cat,
        splits: splits
          ? splits.map((x) => ({ id: x.id, categoryId: x.categoryId, amount: sign * (parseMoney(x.amount) ?? 0), memo: x.memo.trim() }))
          : undefined,
        cleared: existing?.cleared === 'reconciled' ? 'reconciled' : cleared ? 'cleared' : 'uncleared',
        transferAccountId: transfer,
      }).state,
    );
    if (another) {
      setAmount('');
      setPayee('');
      setMemo('');
      setSplits(null);
      setCategoryTouched(false);
      setCategoryId(kind === 'income' ? READY_TO_ASSIGN : null);
      toast('Transaction added');
      setTimeout(() => document.getElementById('txn-amount')?.focus(), 0);
    } else closeDialog();
  };

  const remove = () => {
    if (schedule) act('Schedule deleted', (s) => deleteScheduled(s, schedule.id), { toast: true });
    else if (existing) act('Transaction deleted', (s) => deleteTransactions(s, [existing.id]), { toast: true });
    closeDialog();
  };

  const title = schedule ? 'Edit scheduled transaction' : existing ? 'Edit transaction' : 'Add transaction';

  return (
    <Modal
      title={title}
      onClose={closeDialog}
      footer={
        <>
          {(existing || schedule) && (
            <button type="button" className="btn btn-danger-quiet" onClick={remove}>
              <Icon name="trash" size={16} /> Delete
            </button>
          )}
          <span className="spacer" />
          {!existing && !isScheduled && (
            <button type="button" className="btn btn-secondary" onClick={() => submit(true)}>
              Save &amp; add another
            </button>
          )}
          <button type="submit" form="txn-form" className="btn btn-primary">
            {isScheduled && !schedule ? 'Schedule' : 'Save'}
          </button>
        </>
      }
    >
      <form
        id="txn-form"
        className="form-grid"
        onSubmit={(e) => {
          e.preventDefault();
          submit(false);
        }}
      >
        <Segmented
          label="Type of transaction"
          value={kind}
          onChange={changeKind}
          options={[
            { value: 'expense', label: 'Expense' },
            { value: 'income', label: 'Income' },
            { value: 'transfer', label: 'Transfer' },
          ]}
        />

        <div className="form-row">
          <Field label="Amount" htmlFor="txn-amount">
            <input
              id="txn-amount"
              className="field money-field"
              inputMode="decimal"
              autoComplete="off"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              autoFocus={!source}
            />
          </Field>
          <Field label="Date" htmlFor="txn-date">
            <input id="txn-date" className="field" type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
          </Field>
        </div>

        {kind === 'transfer' ? (
          <div className="form-row">
            <Field label="From" htmlFor="txn-from">
              <AccountSelect
                id="txn-from"
                state={state}
                value={direction === 'to' ? accountId : transferAccountId}
                placeholder="Choose account"
                onChange={(id) => (direction === 'to' ? setAccountId(id) : setTransferAccountId(id))}
              />
            </Field>
            <button
              type="button"
              className="icon-btn swap-btn"
              aria-label="Swap accounts"
              onClick={() => setDirection(direction === 'to' ? 'from' : 'to')}
            >
              <Icon name="transfer" />
            </button>
            <Field label="To" htmlFor="txn-to">
              <AccountSelect
                id="txn-to"
                state={state}
                value={direction === 'to' ? transferAccountId : accountId}
                placeholder="Choose account"
                onChange={(id) => (direction === 'to' ? setTransferAccountId(id) : setAccountId(id))}
              />
            </Field>
          </div>
        ) : (
          <>
            <Field label="Account" htmlFor="txn-account">
              <AccountSelect id="txn-account" state={state} value={accountId} onChange={setAccountId} placeholder="Choose account" />
            </Field>
            <Field label={kind === 'income' ? 'From (payer)' : 'Payee'} htmlFor="txn-payee">
              <input
                id="txn-payee"
                className="field"
                list="payee-list"
                autoComplete="off"
                value={payee}
                placeholder={kind === 'income' ? 'Employer, client, refund…' : 'Store, person or company'}
                onChange={(e) => onPayee(e.target.value)}
              />
              <datalist id="payee-list">
                {payees.map((p) => (
                  <option key={p} value={p} />
                ))}
              </datalist>
            </Field>
          </>
        )}

        {needsCategory && !splits && (
          <Field
            label="Category"
            htmlFor="txn-category"
            hint={
              kind === 'income' && categoryId === READY_TO_ASSIGN
                ? 'Income goes to Ready to Assign so you can give it a job.'
                : crossesBudget
                  ? 'Money leaving your budget for a tracking account needs a category.'
                  : undefined
            }
          >
            <div className="field-with-btn">
              <CategorySelect
                id="txn-category"
                state={state}
                value={categoryId}
                onChange={(id) => {
                  setCategoryId(id);
                  setCategoryTouched(true);
                }}
                includeReadyToAssign={kind !== 'expense'}
                includeUncategorized="Choose later"
                summary={model.get(date.slice(0, 7) as string)}
              />
              {kind !== 'transfer' && !isScheduled && (
                <button
                  type="button"
                  className="btn btn-quiet btn-sm"
                  onClick={() =>
                    setSplits([
                      { id: newId('x'), categoryId, amount: amount, memo: '' },
                      { id: newId('x'), categoryId: null, amount: '', memo: '' },
                    ])
                  }
                >
                  <Icon name="split" size={16} /> Split
                </button>
              )}
            </div>
          </Field>
        )}

        {splits && (
          <fieldset className="splits">
            <legend>Split between categories</legend>
            {splits.map((x, i) => (
              <div className="split-row" key={x.id}>
                <CategorySelect
                  id={`split-cat-${i}`}
                  state={state}
                  value={x.categoryId}
                  ariaLabel={`Category for split ${i + 1}`}
                  onChange={(id) => setSplits(splits.map((y) => (y.id === x.id ? { ...y, categoryId: id } : y)))}
                  includeReadyToAssign={kind === 'income'}
                  includeUncategorized="Choose later"
                />
                <input
                  id={`split-amt-${i}`}
                  className="field money-field"
                  inputMode="decimal"
                  aria-label={`Amount for split ${i + 1}`}
                  placeholder="0.00"
                  value={x.amount}
                  onChange={(e) => setSplits(splits.map((y) => (y.id === x.id ? { ...y, amount: e.target.value } : y)))}
                />
                <input
                  id={`split-memo-${i}`}
                  className="field"
                  aria-label={`Memo for split ${i + 1}`}
                  placeholder="Memo"
                  value={x.memo}
                  onChange={(e) => setSplits(splits.map((y) => (y.id === x.id ? { ...y, memo: e.target.value } : y)))}
                />
                <button
                  type="button"
                  className="icon-btn icon-btn-sm"
                  aria-label={`Remove split ${i + 1}`}
                  onClick={() => {
                    const next = splits.filter((y) => y.id !== x.id);
                    if (next.length < 2) {
                      setCategoryId(next[0]?.categoryId ?? null);
                      setSplits(null);
                    } else setSplits(next);
                  }}
                >
                  <Icon name="close" size={16} />
                </button>
              </div>
            ))}
            <div className="split-foot">
              <button type="button" className="btn btn-quiet btn-sm" onClick={() => setSplits([...splits, { id: newId('x'), categoryId: null, amount: '', memo: '' }])}>
                <Icon name="plus" size={16} /> Add split
              </button>
              {cents !== null && (
                <span className={`split-left${splitTotal === cents ? ' ok' : ''}`}>
                  {splitTotal === cents ? 'Splits add up' : `${formatMoney(cents - splitTotal)} left to split`}
                </span>
              )}
            </div>
          </fieldset>
        )}

        <Field label="Memo" htmlFor="txn-memo">
          <input id="txn-memo" className="field" value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="Optional note" />
        </Field>

        <div className="form-row">
          {!existing && (
            <Field label="Repeat" htmlFor="txn-repeat">
              <select id="txn-repeat" className="field" value={repeat} onChange={(e) => setRepeat(e.target.value as Frequency | 'never')}>
                {!schedule && <option value="never">Doesn’t repeat</option>}
                {Object.entries(FREQUENCY_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {!isScheduled && (
            <label className="check cleared-check">
              <input type="checkbox" checked={cleared} disabled={existing?.cleared === 'reconciled'} onChange={(e) => setClearedFlag(e.target.checked)} />
              {existing?.cleared === 'reconciled' ? 'Reconciled' : 'Cleared by the bank'}
            </label>
          )}
        </div>

        {isScheduled && !schedule && (
          <p className="callout">
            <Icon name="calendar" size={16} />{' '}
            {repeat === 'never' || repeat === 'once'
              ? 'This is dated in the future, so Allot will enter it on that day.'
              : `Allot will enter this ${FREQUENCY_LABELS[repeat].toLowerCase()}, starting ${date}.`}
          </p>
        )}
        {existing?.cleared === 'reconciled' && (
          <p className="callout callout-warn">This transaction is reconciled. Changing the amount will put the account out of step with your bank.</p>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}
