import { useMemo, useState } from 'react';
import { accountBalances, isPaymentCategory } from '../lib/budget';
import { formatMonth, today } from '../lib/dates';
import { formatMoney, formatPlain, parseMoney } from '../lib/money';
import {
  addAccount,
  addCategory,
  addGroup,
  deleteAccount,
  deleteCategories,
  deleteGroup,
  moveCategory,
  moveGroup,
  moveMoney,
  reconcile,
  updateAccount,
  updateCategory,
  updateGroup,
} from '../lib/ops';
import { ACCOUNT_TYPE_LABELS, READY_TO_ASSIGN, isCredit, isOnBudget, type AccountType, type ID } from '../lib/types';
import { useApp, type Dialog } from '../state';
import { ImportDialog } from './ImportDialog';
import { CategorySelect } from './pickers';
import { SetupWizard } from './SetupWizard';
import { TransactionDialog } from './TransactionDialog';
import { Field, Icon, Modal, Segmented } from './ui';

export function DialogHost() {
  const { dialog } = useApp();
  if (!dialog) return null;
  switch (dialog.kind) {
    case 'transaction':
      return <TransactionDialog key={dialog.transactionId ?? dialog.scheduledId ?? 'new'} dialog={dialog} />;
    case 'account':
      return <AccountDialog accountId={dialog.accountId} />;
    case 'reconcile':
      return <ReconcileDialog accountId={dialog.accountId} />;
    case 'import':
      return <ImportDialog accountId={dialog.accountId} />;
    case 'category':
      return <CategoryDialog dialog={dialog} />;
    case 'group':
      return <GroupDialog groupId={dialog.groupId} />;
    case 'move':
      return <MoveMoneyDialog categoryId={dialog.categoryId} />;
    case 'setup':
      return <SetupWizard />;
    case 'confirm':
      return <ConfirmDialog dialog={dialog} />;
  }
}

function ConfirmDialog({ dialog }: { dialog: Extract<Dialog, { kind: 'confirm' }> }) {
  const { closeDialog } = useApp();
  return (
    <Modal
      title={dialog.title}
      onClose={closeDialog}
      footer={
        <>
          <span className="spacer" />
          <button type="button" className="btn btn-secondary" onClick={closeDialog}>
            Cancel
          </button>
          <button
            type="button"
            className={`btn ${dialog.danger ? 'btn-danger' : 'btn-primary'}`}
            onClick={() => {
              closeDialog();
              dialog.onConfirm();
            }}
          >
            {dialog.confirmLabel}
          </button>
        </>
      }
    >
      <div className="prose">{dialog.body}</div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ account */

const TYPE_HINTS: Record<AccountType, string> = {
  checking: 'Day-to-day spending money.',
  savings: 'Money you’re saving; it still counts toward your budget.',
  cash: 'Wallet or envelope cash.',
  credit: 'A payment category is added so the bill is always covered.',
  asset: 'Investments, a house or a car. Tracked for net worth, outside the budget.',
  liability: 'A mortgage or loan. Tracked for net worth, outside the budget.',
};

function AccountDialog({ accountId }: { accountId?: ID }) {
  const { state, act, closeDialog, go, openDialog } = useApp();
  const existing = accountId ? state.accounts.find((a) => a.id === accountId) : undefined;
  const [name, setName] = useState(existing?.name ?? '');
  const [type, setType] = useState<AccountType>(existing?.type ?? 'checking');
  const [balance, setBalance] = useState('');
  const [date, setDate] = useState(today());
  const [note, setNote] = useState(existing?.note ?? '');
  const [error, setError] = useState<string | null>(null);
  const balances = useMemo(() => accountBalances(state), [state]);
  const working = existing ? (balances.get(existing.id)?.working ?? 0) : 0;
  const owes = type === 'credit' || type === 'liability';

  const save = () => {
    if (!name.trim()) return setError('Give the account a name.');
    if (existing) {
      act('Account updated', (s) => updateAccount(s, existing.id, { name: name.trim(), note }));
      closeDialog();
      return;
    }
    const cents = parseMoney(balance);
    if (cents === null) return setError('The balance needs to be a number.');
    // People type what they owe as a positive number; store it as a negative balance.
    const signed = owes ? -Math.abs(cents) : cents;
    let newId = '';
    act(`Added ${name.trim()}`, (s) => {
      const r = addAccount(s, { name, type, balance: signed, date, note });
      newId = r.id;
      return r.state;
    });
    closeDialog();
    if (newId) go({ view: 'account', accountId: newId });
  };

  const close = () => {
    if (!existing) return;
    if (!existing.closed && working !== 0) {
      setError(`Bring the balance to zero before closing (it’s ${formatMoney(working)}). Record a transfer or adjustment first.`);
      return;
    }
    act(existing.closed ? 'Account reopened' : 'Account closed', (s) => updateAccount(s, existing.id, { closed: !existing.closed }), { toast: true });
    closeDialog();
  };

  const remove = () => {
    if (!existing) return;
    const count = state.transactions.filter((t) => t.accountId === existing.id).length;
    openDialog({
      kind: 'confirm',
      title: `Delete ${existing.name}?`,
      danger: true,
      confirmLabel: 'Delete account',
      body: (
        <p>
          This removes the account and its {count} {count === 1 ? 'transaction' : 'transactions'}. Transfers to other accounts stay there as uncategorized
          transactions. You can undo right after.
        </p>
      ),
      onConfirm: () => {
        act(`Deleted ${existing.name}`, (s) => deleteAccount(s, existing.id), { toast: true });
        go({ view: 'budget' });
      },
    });
  };

  return (
    <Modal
      title={existing ? 'Edit account' : 'Add account'}
      onClose={closeDialog}
      footer={
        <>
          {existing && (
            <>
              <button type="button" className="btn btn-danger-quiet" onClick={remove}>
                <Icon name="trash" size={16} /> Delete
              </button>
              <button type="button" className="btn btn-quiet" onClick={close}>
                {existing.closed ? 'Reopen' : 'Close account'}
              </button>
            </>
          )}
          <span className="spacer" />
          <button type="button" className="btn btn-secondary" onClick={closeDialog}>
            Cancel
          </button>
          <button type="submit" form="account-form" className="btn btn-primary">
            {existing ? 'Save' : 'Add account'}
          </button>
        </>
      }
    >
      <form
        id="account-form"
        className="form-grid"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <Field label="Name" htmlFor="acct-name">
          <input id="acct-name" className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="Chase Checking" autoFocus />
        </Field>
        {!existing ? (
          <>
            <Field label="Type" htmlFor="acct-type" hint={TYPE_HINTS[type]}>
              <select id="acct-type" className="field" value={type} onChange={(e) => setType(e.target.value as AccountType)}>
                <optgroup label="Budget accounts">
                  {(['checking', 'savings', 'cash', 'credit'] as AccountType[]).map((t) => (
                    <option key={t} value={t}>
                      {ACCOUNT_TYPE_LABELS[t]}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Tracking accounts">
                  {(['asset', 'liability'] as AccountType[]).map((t) => (
                    <option key={t} value={t}>
                      {ACCOUNT_TYPE_LABELS[t]}
                    </option>
                  ))}
                </optgroup>
              </select>
            </Field>
            <div className="form-row">
              <Field label={owes ? 'Amount you owe today' : 'Balance today'} htmlFor="acct-balance">
                <input
                  id="acct-balance"
                  className="field money-field"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={balance}
                  onChange={(e) => setBalance(e.target.value)}
                />
              </Field>
              <Field label="As of" htmlFor="acct-date">
                <input id="acct-date" className="field" type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
              </Field>
            </div>
            {isOnBudget(type) && !isCredit(type) && (
              <p className="field-hint">This balance goes to Ready to Assign, so you can give it a job right away.</p>
            )}
          </>
        ) : (
          <p className="field-hint">
            {ACCOUNT_TYPE_LABELS[existing.type]} · balance {formatMoney(working)}
          </p>
        )}
        <Field label="Note" htmlFor="acct-note">
          <input id="acct-note" className="field" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
        </Field>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}

/* ---------------------------------------------------------------- reconcile */

function ReconcileDialog({ accountId }: { accountId: ID }) {
  const { state, act, closeDialog, toast } = useApp();
  const account = state.accounts.find((a) => a.id === accountId);
  const bal = accountBalances(state).get(accountId);
  const [step, setStep] = useState<'ask' | 'enter'>('ask');
  const [text, setText] = useState('');
  if (!account || !bal) return null;
  const owes = account.type === 'credit' || account.type === 'liability';
  const shown = owes ? -bal.cleared : bal.cleared;
  const entered = parseMoney(text);
  const target = entered === null ? null : owes ? -entered : entered;
  const diff = target === null ? 0 : target - bal.cleared;
  const clearedCount = state.transactions.filter((t) => t.accountId === accountId && t.cleared === 'cleared').length;

  const finish = (balance: number) => {
    act(`Reconciled ${account.name}`, (s) => reconcile(s, accountId, balance));
    toast(`${account.name} is reconciled`);
    closeDialog();
  };

  return (
    <Modal
      title={`Reconcile ${account.name}`}
      onClose={closeDialog}
      footer={
        step === 'ask' ? (
          <>
            <span className="spacer" />
            <button type="button" className="btn btn-secondary" onClick={() => setStep('enter')}>
              No
            </button>
            <button type="button" className="btn btn-primary" onClick={() => finish(bal.cleared)}>
              Yes, it matches
            </button>
          </>
        ) : (
          <>
            <button type="button" className="btn btn-quiet" onClick={() => setStep('ask')}>
              Back
            </button>
            <span className="spacer" />
            <button type="button" className="btn btn-primary" disabled={target === null} onClick={() => target !== null && finish(target)}>
              {diff === 0 ? 'Finish' : 'Add adjustment and finish'}
            </button>
          </>
        )
      }
    >
      {step === 'ask' ? (
        <div className="prose">
          <p>Open your bank’s app or website and look at the current balance, ignoring anything still pending.</p>
          <p className="big-question">
            {owes ? 'Do you owe' : 'Is your balance'} <strong>{formatMoney(shown)}</strong>?
          </p>
          <p className="muted-text">
            Saying yes locks the {clearedCount} cleared {clearedCount === 1 ? 'transaction' : 'transactions'} so they don’t change by accident.
          </p>
        </div>
      ) : (
        <div className="form-grid">
          <p className="muted-text">
            First, check that every transaction the bank shows is marked cleared here. If it still doesn’t match, enter the bank’s figure.
          </p>
          <Field label={owes ? 'Amount the bank says you owe' : 'Balance the bank shows'} htmlFor="rec-balance">
            <input
              id="rec-balance"
              className="field money-field"
              inputMode="decimal"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={formatPlain(shown, false)}
              autoFocus
            />
          </Field>
          {target !== null && diff !== 0 && (
            <p className="callout">
              Allot will add a {formatMoney(Math.abs(diff))} {diff > 0 ? 'inflow' : 'outflow'} called “Reconciliation Balance Adjustment”
              {isOnBudget(account.type) ? ', which changes Ready to Assign by the same amount.' : '.'}
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}

/* ----------------------------------------------------------- move money */

function MoveMoneyDialog({ categoryId }: { categoryId: ID }) {
  const { state, model, month, act, closeDialog } = useApp();
  const cat = state.categories.find((c) => c.id === categoryId);
  const summary = model.get(month);
  const cm = summary.categories[categoryId];
  const overspent = (cm?.available ?? 0) < 0;
  const [direction, setDirection] = useState<'out' | 'in'>(overspent ? 'in' : 'out');
  const [other, setOther] = useState<ID | null>(overspent ? null : READY_TO_ASSIGN);
  const [text, setText] = useState(cm ? formatPlain(Math.abs(cm.available), false) : '');
  const [error, setError] = useState<string | null>(null);
  if (!cat || !cm) return null;
  const amount = parseMoney(text);

  const submit = () => {
    if (amount === null || amount <= 0) return setError('Enter an amount greater than zero.');
    if (!other) return setError('Choose where the money comes from or goes.');
    const [from, to] = direction === 'out' ? [cat.id, other] : [other, cat.id];
    const otherName = other === READY_TO_ASSIGN ? 'Ready to Assign' : state.categories.find((c) => c.id === other)?.name;
    act(direction === 'out' ? `Moved ${formatMoney(amount)} to ${otherName}` : `Moved ${formatMoney(amount)} from ${otherName}`, (s) =>
      moveMoney(s, month, from, to, amount),
    );
    closeDialog();
  };

  return (
    <Modal
      title={cat.name}
      onClose={closeDialog}
      footer={
        <>
          <span className="spacer" />
          <button type="button" className="btn btn-secondary" onClick={closeDialog}>
            Cancel
          </button>
          <button type="submit" form="move-form" className="btn btn-primary">
            Move money
          </button>
        </>
      }
    >
      <form
        id="move-form"
        className="form-grid"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <p className="muted-text">
          {formatMoney(cm.available)} available in {formatMonth(month)}.{' '}
          {overspent ? 'Cover the overspending by moving money in from another category.' : ''}
        </p>
        <Segmented
          label="Direction"
          value={direction}
          onChange={(d) => {
            setDirection(d);
            setOther(d === 'out' ? READY_TO_ASSIGN : null);
          }}
          options={[
            { value: 'in', label: `Move money in` },
            { value: 'out', label: `Move money out` },
          ]}
        />
        <div className="form-row">
          <Field label="Amount" htmlFor="move-amount">
            <input id="move-amount" className="field money-field" inputMode="decimal" value={text} onChange={(e) => setText(e.target.value)} autoFocus />
          </Field>
          <Field label={direction === 'out' ? 'To' : 'From'} htmlFor="move-other">
            <CategorySelect
              id="move-other"
              state={state}
              value={other}
              onChange={setOther}
              includeReadyToAssign
              includePayments
              exclude={[cat.id]}
              summary={summary}
              placeholder="Choose a category…"
            />
          </Field>
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}

/* ---------------------------------------------------------- categories */

function CategoryDialog({ dialog }: { dialog: Extract<Dialog, { kind: 'category' }> }) {
  const { state, act, closeDialog, selectCategory, model, month } = useApp();
  const existing = dialog.categoryId ? state.categories.find((c) => c.id === dialog.categoryId) : undefined;
  const [name, setName] = useState(existing?.name ?? '');
  const [groupId, setGroupId] = useState<ID>(existing?.groupId ?? dialog.groupId ?? state.groups.find((g) => !g.isCreditCardPayments)?.id ?? '');
  const [hidden, setHidden] = useState(existing?.hidden ?? false);
  const [deleting, setDeleting] = useState(false);
  const [replacement, setReplacement] = useState<ID | null>(null);
  const [error, setError] = useState<string | null>(null);
  const payment = isPaymentCategory(existing);
  const used = existing
    ? state.transactions.some((t) => t.categoryId === existing.id || t.splits?.some((x) => x.categoryId === existing.id)) ||
      Object.values(state.assigned).some((m) => m[existing.id])
    : false;
  const groups = state.groups.filter((g) => !g.isCreditCardPayments);

  const save = () => {
    if (!name.trim()) return setError('Give the category a name.');
    if (!groupId) return setError('Choose a group.');
    if (existing) {
      act('Category updated', (s) => {
        let next = updateCategory(s, existing.id, { name: name.trim(), hidden });
        if (!payment && groupId !== existing.groupId) next = moveCategory(next, existing.id, { groupId });
        return next;
      });
    } else {
      let id = '';
      act(`Added ${name.trim()}`, (s) => {
        const r = addCategory(s, groupId, name);
        id = r.id;
        return r.state;
      });
      if (id) selectCategory(id);
    }
    closeDialog();
  };

  const remove = () => {
    if (!existing) return;
    act(`Deleted ${existing.name}`, (s) => deleteCategories(s, [existing.id], replacement), { toast: true });
    selectCategory(null);
    closeDialog();
  };

  if (deleting && existing) {
    return (
      <Modal
        title={`Delete ${existing.name}?`}
        onClose={closeDialog}
        footer={
          <>
            <button type="button" className="btn btn-quiet" onClick={() => setDeleting(false)}>
              Back
            </button>
            <span className="spacer" />
            <button type="button" className="btn btn-danger" onClick={remove}>
              Delete category
            </button>
          </>
        }
      >
        <div className="form-grid">
          {used ? (
            <>
              <p className="muted-text">Its transactions and the money assigned to it need a new home.</p>
              <Field label="Move everything to" htmlFor="del-replacement" hint={replacement ? undefined : 'Transactions become uncategorized and the money goes back to Ready to Assign.'}>
                <CategorySelect
                  id="del-replacement"
                  state={state}
                  value={replacement}
                  onChange={setReplacement}
                  includeUncategorized="Nothing (uncategorize)"
                  exclude={[existing.id]}
                  summary={model.get(month)}
                />
              </Field>
            </>
          ) : (
            <p className="muted-text">It has no transactions or money, so nothing else changes.</p>
          )}
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      title={existing ? 'Edit category' : 'Add category'}
      onClose={closeDialog}
      footer={
        <>
          {existing && !payment && (
            <button type="button" className="btn btn-danger-quiet" onClick={() => setDeleting(true)}>
              <Icon name="trash" size={16} /> Delete
            </button>
          )}
          <span className="spacer" />
          <button type="button" className="btn btn-secondary" onClick={closeDialog}>
            Cancel
          </button>
          <button type="submit" form="cat-form" className="btn btn-primary">
            {existing ? 'Save' : 'Add category'}
          </button>
        </>
      }
    >
      <form
        id="cat-form"
        className="form-grid"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <Field label="Name" htmlFor="cat-name" hint={payment ? 'Payment categories are named after their card. Rename the account to change it.' : undefined}>
          <input id="cat-name" className="field" value={name} disabled={payment} onChange={(e) => setName(e.target.value)} autoFocus placeholder="Groceries" />
        </Field>
        {!payment && (
          <Field label="Group" htmlFor="cat-group">
            <select id="cat-group" className="field" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        {existing && (
          <>
            <label className="check">
              <input type="checkbox" checked={hidden} onChange={(e) => setHidden(e.target.checked)} /> Hide this category
            </label>
            {!payment && (
              <div className="btn-row">
                <button type="button" className="btn btn-quiet btn-sm" onClick={() => act('Moved up', (s) => moveCategory(s, existing.id, { direction: -1 }))}>
                  <Icon name="up" size={16} /> Move up
                </button>
                <button type="button" className="btn btn-quiet btn-sm" onClick={() => act('Moved down', (s) => moveCategory(s, existing.id, { direction: 1 }))}>
                  <Icon name="down" size={16} /> Move down
                </button>
              </div>
            )}
          </>
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

function GroupDialog({ groupId }: { groupId?: ID }) {
  const { state, act, closeDialog, model, month } = useApp();
  const existing = groupId ? state.groups.find((g) => g.id === groupId) : undefined;
  const [name, setName] = useState(existing?.name ?? '');
  const [deleting, setDeleting] = useState(false);
  const [replacement, setReplacement] = useState<ID | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cats = existing ? state.categories.filter((c) => c.groupId === existing.id) : [];

  const save = () => {
    if (!name.trim()) return setError('Give the group a name.');
    if (existing) act('Group renamed', (s) => updateGroup(s, existing.id, { name: name.trim() }));
    else act(`Added ${name.trim()}`, (s) => addGroup(s, name).state);
    closeDialog();
  };

  if (deleting && existing) {
    return (
      <Modal
        title={`Delete ${existing.name}?`}
        onClose={closeDialog}
        footer={
          <>
            <button type="button" className="btn btn-quiet" onClick={() => setDeleting(false)}>
              Back
            </button>
            <span className="spacer" />
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => {
                act(`Deleted ${existing.name}`, (s) => deleteGroup(s, existing.id, replacement), { toast: true });
                closeDialog();
              }}
            >
              Delete group
            </button>
          </>
        }
      >
        <div className="form-grid">
          <p className="muted-text">
            This deletes {cats.length ? `its ${cats.length} ${cats.length === 1 ? 'category' : 'categories'}: ${cats.map((c) => c.name).join(', ')}` : 'the empty group'}.
          </p>
          {cats.length > 0 && (
            <Field label="Move their transactions and money to" htmlFor="grp-replacement">
              <CategorySelect
                id="grp-replacement"
                state={state}
                value={replacement}
                onChange={setReplacement}
                includeUncategorized="Nothing (uncategorize)"
                exclude={cats.map((c) => c.id)}
                summary={model.get(month)}
              />
            </Field>
          )}
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      title={existing ? 'Edit category group' : 'Add category group'}
      onClose={closeDialog}
      footer={
        <>
          {existing && (
            <button type="button" className="btn btn-danger-quiet" onClick={() => setDeleting(true)}>
              <Icon name="trash" size={16} /> Delete
            </button>
          )}
          <span className="spacer" />
          <button type="button" className="btn btn-secondary" onClick={closeDialog}>
            Cancel
          </button>
          <button type="submit" form="group-form" className="btn btn-primary">
            {existing ? 'Save' : 'Add group'}
          </button>
        </>
      }
    >
      <form
        id="group-form"
        className="form-grid"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <Field label="Name" htmlFor="group-name">
          <input id="group-name" className="field" value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="Monthly Bills" />
        </Field>
        {existing && (
          <div className="btn-row">
            <button type="button" className="btn btn-quiet btn-sm" onClick={() => act('Moved up', (s) => moveGroup(s, existing.id, -1))}>
              <Icon name="up" size={16} /> Move up
            </button>
            <button type="button" className="btn btn-quiet btn-sm" onClick={() => act('Moved down', (s) => moveGroup(s, existing.id, 1))}>
              <Icon name="down" size={16} /> Move down
            </button>
          </div>
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
