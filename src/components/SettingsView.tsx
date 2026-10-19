import { useState } from 'react';
import { today } from '../lib/dates';
import { saveFile, toCsv } from '../lib/files';
import { buildSampleBudget } from '../lib/sample';
import { normalize } from '../lib/storage';
import { CURRENCIES } from '../lib/templates';
import { READY_TO_ASSIGN, type BudgetState } from '../lib/types';
import { useApp } from '../state';
import { categoryName } from './pickers';
import { Field, Icon } from './ui';

export function SettingsView() {
  const { state, act, replace, openDialog, toast, where, go } = useApp();
  const [name, setName] = useState(state.name);
  const [restoreError, setRestoreError] = useState<string | null>(null);

  const backup = async () => {
    const result = await saveFile(`${slug(state.name)}-backup-${today()}.json`, JSON.stringify(state, null, 1), 'application/json');
    if (result === 'saved') toast('Backup saved');
    else if (result === 'failed') toast('The backup couldn’t be saved here.');
  };

  const exportCsv = async () => {
    const accounts = new Map(state.accounts.map((a) => [a.id, a.name]));
    const rows: (string | number)[][] = [['Account', 'Date', 'Payee', 'Category', 'Memo', 'Outflow', 'Inflow', 'Cleared']];
    const sorted = [...state.transactions].sort((a, b) => (a.date < b.date ? -1 : 1));
    for (const t of sorted) {
      const payee = t.transferAccountId ? `Transfer : ${accounts.get(t.transferAccountId) ?? ''}` : t.payee;
      const parts = t.splits?.length ? t.splits.map((x) => ({ ...x, memo: x.memo || t.memo })) : [{ categoryId: t.categoryId, amount: t.amount, memo: t.memo }];
      for (const p of parts) {
        rows.push([
          accounts.get(t.accountId) ?? '',
          t.date,
          payee,
          p.categoryId === READY_TO_ASSIGN ? 'Ready to Assign' : categoryName(state, p.categoryId),
          p.memo,
          p.amount < 0 ? (-p.amount / 100).toFixed(2) : '',
          p.amount > 0 ? (p.amount / 100).toFixed(2) : '',
          t.cleared,
        ]);
      }
    }
    const result = await saveFile(`${slug(state.name)}-transactions-${today()}.csv`, toCsv(rows), 'text/csv');
    if (result === 'saved') toast('Transactions exported');
    else if (result === 'failed') toast('The file couldn’t be saved here.');
  };

  const restore = async (file: File) => {
    setRestoreError(null);
    let parsed: BudgetState | null = null;
    try {
      parsed = normalize(JSON.parse(await file.text()));
    } catch {
      parsed = null;
    }
    if (!parsed || (!parsed.accounts.length && !parsed.categories.length)) {
      setRestoreError('That file isn’t an Allot backup. Choose a .json file saved from this page.');
      return;
    }
    const next = parsed;
    openDialog({
      kind: 'confirm',
      title: 'Replace this budget with the backup?',
      confirmLabel: 'Restore backup',
      danger: true,
      body: (
        <p>
          “{next.name}” has {next.accounts.length} accounts and {next.transactions.length} transactions. Everything currently in “{state.name}” will be
          replaced. Download a backup first if you might want it back.
        </p>
      ),
      onConfirm: async () => {
        await replace(next);
        toast('Backup restored');
        go({ view: 'budget' });
      },
    });
  };

  return (
    <div className="page settings">
      <header className="page-head">
        <div>
          <p className="eyebrow">Settings</p>
          <h1>{state.name}</h1>
        </div>
      </header>

      <section className="settings-card">
        <h2>Budget</h2>
        <form
          className="form-grid narrow"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) act('Budget renamed', (s) => ({ ...s, name: name.trim() }), { toast: true });
          }}
        >
          <Field label="Name" htmlFor="set-name">
            <div className="field-with-btn">
              <input id="set-name" className="field" value={name} onChange={(e) => setName(e.target.value)} />
              <button type="submit" className="btn btn-secondary" disabled={!name.trim() || name.trim() === state.name}>
                Rename
              </button>
            </div>
          </Field>
          <Field label="Currency" htmlFor="set-currency" hint="Changes how amounts are shown. It doesn’t convert them.">
            <select
              id="set-currency"
              className="field"
              value={state.settings.currency}
              onChange={(e) => act('Currency changed', (s) => ({ ...s, settings: { ...s.settings, currency: e.target.value } }))}
            >
              {CURRENCIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.label}
                </option>
              ))}
            </select>
          </Field>
        </form>
      </section>

      <section className="settings-card">
        <h2>Where your budget is saved</h2>
        <p className="muted-text">
          {where === 'cloud'
            ? 'Your budget is saved privately to your Claude account, so it follows you to any device where you open this page. Nobody you share the page with can see it.'
            : 'Your budget is saved in this browser on this device. Clearing browsing data deletes it, so download a backup now and then.'}
        </p>
        <div className="btn-row wrap">
          <button type="button" className="btn btn-secondary" onClick={backup}>
            <Icon name="download" size={16} /> Download backup
          </button>
          <label className="btn btn-secondary file-btn">
            <Icon name="upload" size={16} /> Restore from backup
            <input
              id="restore-file"
              type="file"
              accept=".json,application/json"
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) restore(f);
                e.target.value = '';
              }}
            />
          </label>
          <button type="button" className="btn btn-secondary" onClick={exportCsv}>
            <Icon name="download" size={16} /> Export transactions (CSV)
          </button>
        </div>
        {restoreError && (
          <p className="form-error" role="alert">
            {restoreError}
          </p>
        )}
      </section>

      <section className="settings-card">
        <h2>Start fresh</h2>
        <p className="muted-text">Set up a new budget from scratch, or look around the sample budget again. Both replace what’s here now.</p>
        <div className="btn-row wrap">
          <button type="button" className="btn btn-secondary" onClick={() => openDialog({ kind: 'setup' })}>
            Start a new budget
          </button>
          <button
            type="button"
            className="btn btn-danger-quiet"
            onClick={() =>
              openDialog({
                kind: 'confirm',
                title: 'Load the sample budget?',
                confirmLabel: 'Load sample',
                danger: true,
                body: <p>This replaces “{state.name}” with example data. Download a backup first if you want to keep it.</p>,
                onConfirm: async () => {
                  await replace(buildSampleBudget());
                  go({ view: 'budget' });
                },
              })
            }
          >
            Load sample budget
          </button>
        </div>
      </section>

      <section className="settings-card">
        <h2>How Allot works</h2>
        <ol className="rules">
          <li>
            <strong>Give every dollar a job.</strong> When money arrives it lands in Ready to Assign. Assign it to categories until Ready to Assign is
            zero.
          </li>
          <li>
            <strong>Plan for the big, irregular costs.</strong> Car repairs, gifts and annual bills become small monthly amounts with targets.
          </li>
          <li>
            <strong>Roll with the punches.</strong> Overspent? Move money from another category. Changing the plan is part of the plan.
          </li>
          <li>
            <strong>Age your money.</strong> Over time, spend money you earned a month or more ago. Age of Money in the month summary tracks it.
          </li>
        </ol>
      </section>
    </div>
  );
}

function slug(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'budget';
}
