import { useState } from 'react';
import { today } from '../lib/dates';
import { newId } from '../lib/ids';
import { parseMoney } from '../lib/money';
import { addAccount, addCategory, addGroup, emptyBudget } from '../lib/ops';
import { CURRENCIES, STARTER_CATEGORIES } from '../lib/templates';
import { ACCOUNT_TYPE_LABELS, type AccountType, type BudgetState } from '../lib/types';
import { useApp } from '../state';
import { Field, Icon, Modal } from './ui';

interface AccountDraft {
  id: string;
  name: string;
  type: AccountType;
  balance: string;
}

const STEPS = ['Your budget', 'Accounts', 'Categories'] as const;

export function SetupWizard() {
  const { closeDialog, replace, go, toast, setMonth } = useApp();
  const [step, setStep] = useState(0);
  const [name, setName] = useState('My Budget');
  const [currency, setCurrency] = useState('USD');
  const [accounts, setAccounts] = useState<AccountDraft[]>([
    { id: newId('d'), name: 'Checking', type: 'checking', balance: '' },
    { id: newId('d'), name: 'Savings', type: 'savings', balance: '' },
  ]);
  const [picked, setPicked] = useState<Set<string>>(
    () => new Set(STARTER_CATEGORIES.flatMap((g) => g.categories.map((c) => `${g.name}/${c}`)).filter((k) => !k.endsWith('Car Payment') && !k.endsWith('Next Car'))),
  );
  const [error, setError] = useState<string | null>(null);

  const next = () => {
    setError(null);
    if (step === 1) {
      const bad = accounts.find((a) => a.name.trim() && parseMoney(a.balance) === null);
      if (bad) return setError(`The balance for ${bad.name} isn’t a number.`);
    }
    setStep(step + 1);
  };

  const finish = async () => {
    let s: BudgetState = emptyBudget(name.trim() || 'My Budget');
    s.settings.currency = currency;
    for (const a of accounts) {
      if (!a.name.trim()) continue;
      const cents = parseMoney(a.balance) ?? 0;
      const owes = a.type === 'credit' || a.type === 'liability';
      s = addAccount(s, { name: a.name, type: a.type, balance: owes ? -Math.abs(cents) : cents, date: today() }).state;
    }
    for (const g of STARTER_CATEGORIES) {
      const cats = g.categories.filter((c) => picked.has(`${g.name}/${c}`));
      if (!cats.length) continue;
      const gr = addGroup(s, g.name);
      s = gr.state;
      for (const c of cats) s = addCategory(s, gr.id, c).state;
    }
    await replace(s);
    closeDialog();
    setMonth(today().slice(0, 7));
    go({ view: 'budget' });
    toast('Your budget is ready. Start by giving each dollar in Ready to Assign a job.');
  };

  const toggle = (key: string) => {
    const nextSet = new Set(picked);
    if (nextSet.has(key)) nextSet.delete(key);
    else nextSet.add(key);
    setPicked(nextSet);
  };

  return (
    <Modal
      title="Start your own budget"
      wide
      onClose={closeDialog}
      footer={
        <>
          {step > 0 && (
            <button type="button" className="btn btn-quiet" onClick={() => setStep(step - 1)}>
              Back
            </button>
          )}
          <span className="spacer" />
          {step < STEPS.length - 1 ? (
            <button type="button" className="btn btn-primary" onClick={next}>
              Next
            </button>
          ) : (
            <button type="button" className="btn btn-primary" onClick={finish}>
              Create my budget
            </button>
          )}
        </>
      }
    >
      <ol className="steps" aria-label="Setup steps">
        {STEPS.map((label, i) => (
          <li key={label} className={i === step ? 'current' : i < step ? 'done' : ''} aria-current={i === step ? 'step' : undefined}>
            <span className="step-num">{i < step ? <Icon name="check" size={14} /> : i + 1}</span>
            {label}
          </li>
        ))}
      </ol>

      {step === 0 && (
        <div className="form-grid">
          <p className="lede">
            Allot works one way: you give every dollar you have a job before you spend it. When plans change, you move money between jobs. Nothing
            is tied to your bank, so you’re always in control.
          </p>
          <p className="muted-text">This replaces the sample budget. Your budget is private to you.</p>
          <Field label="Budget name" htmlFor="setup-name">
            <input id="setup-name" className="field" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </Field>
          <Field label="Currency" htmlFor="setup-currency">
            <select id="setup-currency" className="field" value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {CURRENCIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.label}
                </option>
              ))}
            </select>
          </Field>
        </div>
      )}

      {step === 1 && (
        <div className="form-grid">
          <p className="muted-text">
            Add the accounts you spend from and save in, with today’s balance. For credit cards, enter what you owe. You can add more later.
          </p>
          <div className="setup-accounts">
            {accounts.map((a, i) => (
              <div className="setup-account" key={a.id}>
                <input
                  id={`setup-acct-name-${i}`}
                  className="field"
                  aria-label={`Account ${i + 1} name`}
                  value={a.name}
                  placeholder="Account name"
                  onChange={(e) => setAccounts(accounts.map((x) => (x.id === a.id ? { ...x, name: e.target.value } : x)))}
                />
                <select
                  id={`setup-acct-type-${i}`}
                  className="field"
                  aria-label={`Account ${i + 1} type`}
                  value={a.type}
                  onChange={(e) => setAccounts(accounts.map((x) => (x.id === a.id ? { ...x, type: e.target.value as AccountType } : x)))}
                >
                  {(Object.keys(ACCOUNT_TYPE_LABELS) as AccountType[]).map((t) => (
                    <option key={t} value={t}>
                      {ACCOUNT_TYPE_LABELS[t]}
                    </option>
                  ))}
                </select>
                <input
                  id={`setup-acct-bal-${i}`}
                  className="field money-field"
                  inputMode="decimal"
                  aria-label={a.type === 'credit' || a.type === 'liability' ? `Amount owed on account ${i + 1}` : `Balance of account ${i + 1}`}
                  placeholder={a.type === 'credit' || a.type === 'liability' ? 'Owed' : 'Balance'}
                  value={a.balance}
                  onChange={(e) => setAccounts(accounts.map((x) => (x.id === a.id ? { ...x, balance: e.target.value } : x)))}
                />
                <button
                  type="button"
                  className="icon-btn icon-btn-sm"
                  aria-label={`Remove account ${i + 1}`}
                  onClick={() => setAccounts(accounts.filter((x) => x.id !== a.id))}
                >
                  <Icon name="close" size={16} />
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            className="btn btn-quiet btn-sm self-start"
            onClick={() => setAccounts([...accounts, { id: newId('d'), name: '', type: 'credit', balance: '' }])}
          >
            <Icon name="plus" size={16} /> Add another account
          </button>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
        </div>
      )}

      {step === 2 && (
        <div className="form-grid">
          <p className="muted-text">
            Pick the categories that fit your life. “True Expenses” are the bills that don’t come every month; saving a little toward them each month
            means they never catch you off guard.
          </p>
          <div className="template-groups">
            {STARTER_CATEGORIES.map((g) => (
              <fieldset key={g.name} className="template-group">
                <legend>{g.name}</legend>
                {g.categories.map((c) => {
                  const key = `${g.name}/${c}`;
                  return (
                    <label key={key} className="check">
                      <input type="checkbox" checked={picked.has(key)} onChange={() => toggle(key)} /> {c}
                    </label>
                  );
                })}
              </fieldset>
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
}
