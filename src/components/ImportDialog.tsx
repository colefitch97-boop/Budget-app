import { useMemo, useState } from 'react';
import {
  DATE_FORMAT_LABELS,
  applyMapping,
  guessMapping,
  isOfx,
  parseCsv,
  parseOfx,
  type ColumnMapping,
  type DateFormat,
  type ParsedRow,
} from '../lib/bankImport';
import { formatDate } from '../lib/dates';
import { formatMoney } from '../lib/money';
import { importTransactions, isDuplicate, normalizePayee, payeeCategories } from '../lib/ops';
import { READY_TO_ASSIGN, isOnBudget, type ID } from '../lib/types';
import { useApp } from '../state';
import { AccountSelect, categoryName } from './pickers';
import { Field, Icon, Modal } from './ui';

export function ImportDialog({ accountId: initialAccount }: { accountId?: ID }) {
  const { state, act, closeDialog, go, toast } = useApp();
  const [accountId, setAccountId] = useState<ID>(initialAccount ?? state.accounts.find((a) => !a.closed)?.id ?? '');
  const [fileName, setFileName] = useState('');
  const [text, setText] = useState('');
  const [pasting, setPasting] = useState(false);
  const [mapping, setMapping] = useState<ColumnMapping | null>(null);
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [readError, setReadError] = useState<string | null>(null);

  const ofx = text ? isOfx(text) : false;
  const csvRows = useMemo(() => (text && !ofx ? parseCsv(text) : []), [text, ofx]);

  const load = (content: string, name: string) => {
    setText(content);
    setFileName(name);
    setReadError(null);
    if (!isOfx(content)) {
      const rows = parseCsv(content);
      if (!rows.length) {
        setReadError('That file is empty, or not a CSV or OFX file.');
        setMapping(null);
        return;
      }
      setMapping(guessMapping(rows));
    } else setMapping(null);
  };

  const parsed: { rows: ParsedRow[]; skipped: number } = useMemo(() => {
    if (!text) return { rows: [], skipped: 0 };
    if (ofx) return { rows: parseOfx(text), skipped: 0 };
    if (!mapping) return { rows: [], skipped: 0 };
    return applyMapping(csvRows, mapping);
  }, [text, ofx, csvRows, mapping]);

  const account = state.accounts.find((a) => a.id === accountId);
  const memory = useMemo(() => payeeCategories(state), [state]);
  const preview = useMemo(
    () =>
      parsed.rows.map((r) => {
        let categoryId = memory.get(normalizePayee(r.payee)) ?? null;
        if (categoryId === READY_TO_ASSIGN && r.amount < 0) categoryId = null;
        if (account && !isOnBudget(account.type)) categoryId = null;
        return { ...r, categoryId, duplicate: accountId ? isDuplicate(state, accountId, r) : false };
      }),
    [parsed.rows, memory, account, accountId, state],
  );
  const toImport = preview.filter((r) => !(skipDuplicates && r.duplicate));
  const needCategory = toImport.filter((r) => r.categoryId === null).length;
  const width = Math.max(0, ...csvRows.slice(0, 5).map((r) => r.length));
  const headerNames = mapping?.hasHeader ? csvRows[0] : Array.from({ length: width }, (_, i) => `Column ${i + 1}`);
  const columnOptions = Array.from({ length: width }, (_, i) => ({ value: i, label: headerNames[i] || `Column ${i + 1}` }));

  const run = () => {
    if (!accountId || !toImport.length) return;
    act(`Imported ${toImport.length} transactions`, (s) => importTransactions(s, accountId, toImport));
    toast(
      `Imported ${toImport.length} ${toImport.length === 1 ? 'transaction' : 'transactions'}${needCategory ? ` · ${needCategory} need a category` : ''}`,
      { undo: true },
    );
    closeDialog();
    go({ view: 'account', accountId, filter: needCategory ? 'uncategorized' : undefined });
  };

  const setCol = (key: keyof ColumnMapping, value: string) => {
    if (!mapping) return;
    const n = value === '' ? null : Number(value);
    setMapping({ ...mapping, [key]: n });
  };

  return (
    <Modal
      title="Import from your bank"
      wide
      onClose={closeDialog}
      footer={
        <>
          {parsed.rows.length > 0 && (
            <span className="foot-note">
              {toImport.length} to import
              {preview.length - toImport.length > 0 ? ` · ${preview.length - toImport.length} already here` : ''}
              {parsed.skipped ? ` · ${parsed.skipped} rows unreadable` : ''}
            </span>
          )}
          <span className="spacer" />
          <button type="button" className="btn btn-secondary" onClick={closeDialog}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" disabled={!toImport.length || !accountId} onClick={run}>
            {preview.length && !toImport.length
              ? 'Nothing new to import'
              : `Import ${toImport.length || ''} ${toImport.length === 1 ? 'transaction' : 'transactions'}`}
          </button>
        </>
      }
    >
      <div className="form-grid">
        <div className="form-row">
          <Field label="Into account" htmlFor="imp-account">
            <AccountSelect id="imp-account" state={state} value={accountId} onChange={setAccountId} placeholder="Choose account" />
          </Field>
          <Field
            label="Bank file"
            htmlFor="imp-file"
            hint="Download a CSV, OFX or QFX file from your bank’s website, usually under Statements or Download transactions."
          >
            <input
              id="imp-file"
              className="field"
              type="file"
              accept=".csv,.ofx,.qfx,.qbo,.txt,text/csv"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                try {
                  load(await file.text(), file.name);
                } catch {
                  setReadError('That file couldn’t be read. Try downloading it again.');
                }
              }}
            />
          </Field>
        </div>
        <button type="button" className="btn btn-quiet btn-sm self-start" onClick={() => setPasting(!pasting)}>
          {pasting ? 'Hide' : 'Or paste'} CSV text
        </button>
        {pasting && (
          <textarea
            id="imp-paste"
            className="field mono"
            rows={5}
            placeholder={'Date,Description,Amount\n10/01/2026,H-E-B,-82.14'}
            onChange={(e) => load(e.target.value, 'Pasted text')}
          />
        )}
        {readError && (
          <p className="form-error" role="alert">
            {readError}
          </p>
        )}

        {mapping && csvRows.length > 0 && (
          <fieldset className="mapping">
            <legend>Match the columns in {fileName}</legend>
            <div className="mapping-grid">
              <MapSelect id="map-date" label="Date" value={mapping.date} options={columnOptions} onChange={(v) => setCol('date', v)} />
              <MapSelect id="map-payee" label="Payee" value={mapping.payee} options={columnOptions} onChange={(v) => setCol('payee', v)} />
              <MapSelect id="map-memo" label="Memo" value={mapping.memo} options={columnOptions} onChange={(v) => setCol('memo', v)} optional />
              {mapping.amount !== null || (mapping.outflow === null && mapping.inflow === null) ? (
                <MapSelect id="map-amount" label="Amount" value={mapping.amount} options={columnOptions} onChange={(v) => setCol('amount', v)} />
              ) : (
                <>
                  <MapSelect id="map-out" label="Outflow" value={mapping.outflow} options={columnOptions} onChange={(v) => setCol('outflow', v)} optional />
                  <MapSelect id="map-in" label="Inflow" value={mapping.inflow} options={columnOptions} onChange={(v) => setCol('inflow', v)} optional />
                </>
              )}
              <Field label="Dates look like" htmlFor="map-datefmt">
                <select
                  id="map-datefmt"
                  className="field field-sm"
                  value={mapping.dateFormat}
                  onChange={(e) => setMapping({ ...mapping, dateFormat: e.target.value as DateFormat })}
                >
                  {Object.entries(DATE_FORMAT_LABELS).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <div className="btn-row wrap">
              <label className="check">
                <input type="checkbox" checked={mapping.hasHeader} onChange={(e) => setMapping({ ...mapping, hasHeader: e.target.checked })} /> First row is
                column names
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={mapping.amount === null && (mapping.outflow !== null || mapping.inflow !== null)}
                  onChange={(e) =>
                    setMapping(
                      e.target.checked
                        ? { ...mapping, amount: null, outflow: mapping.amount ?? 0, inflow: null }
                        : { ...mapping, amount: mapping.outflow ?? mapping.inflow ?? 0, outflow: null, inflow: null },
                    )
                  }
                />{' '}
                Separate columns for money in and out
              </label>
              <label className="check">
                <input type="checkbox" checked={mapping.flipSign} onChange={(e) => setMapping({ ...mapping, flipSign: e.target.checked })} /> Purchases are
                positive numbers (flip signs)
              </label>
            </div>
          </fieldset>
        )}

        {preview.length > 0 && (
          <>
            <div className="btn-row wrap">
              <label className="check">
                <input type="checkbox" checked={skipDuplicates} onChange={(e) => setSkipDuplicates(e.target.checked)} /> Skip transactions already in this
                account
              </label>
            </div>
            <div className="table-scroll preview">
              <table className="mini-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Payee</th>
                    <th>Category</th>
                    <th className="num">Amount</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.slice(0, 60).map((r, i) => (
                    <tr key={i} className={r.duplicate && skipDuplicates ? 'dim' : ''}>
                      <td>{formatDate(r.date)}</td>
                      <td>{r.payee}</td>
                      <td className={r.categoryId ? '' : 'muted'}>{r.categoryId ? categoryName(state, r.categoryId) : 'Needs a category'}</td>
                      <td className={`num${r.amount > 0 ? ' pos' : ''}`}>{formatMoney(r.amount)}</td>
                      <td>{r.duplicate ? <span className="tag">Already here</span> : <span className="tag tag-new">New</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {preview.length > 60 && <p className="muted-text">…and {preview.length - 60} more.</p>}
            </div>
            <p className="field-hint">
              <Icon name="sparkle" size={14} /> Categories are filled in from payees you’ve used before. Imported transactions are marked cleared.
            </p>
          </>
        )}
        {text && !preview.length && !readError && (
          <p className="callout callout-warn">No transactions could be read. Check the column choices and date format above.</p>
        )}
      </div>
    </Modal>
  );
}

function MapSelect({
  id,
  label,
  value,
  options,
  onChange,
  optional,
}: {
  id: string;
  label: string;
  value: number | null;
  options: { value: number; label: string }[];
  onChange: (v: string) => void;
  optional?: boolean;
}) {
  return (
    <Field label={label} htmlFor={id}>
      <select id={id} className="field field-sm" value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
        {optional && <option value="">None</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  );
}
