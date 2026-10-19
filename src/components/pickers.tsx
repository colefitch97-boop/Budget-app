import type { MonthSummary } from '../lib/budget';
import { formatMoney } from '../lib/money';
import { READY_TO_ASSIGN, type BudgetState, type ID } from '../lib/types';

/** A category dropdown grouped like the budget. */
export function CategorySelect({
  id,
  state,
  value,
  onChange,
  includeReadyToAssign,
  includeUncategorized,
  includePayments,
  includeHidden,
  exclude,
  summary,
  placeholder,
  ariaLabel,
}: {
  id?: string;
  state: BudgetState;
  value: ID | null;
  onChange: (id: ID | null) => void;
  includeReadyToAssign?: boolean;
  includeUncategorized?: boolean | string;
  includePayments?: boolean;
  includeHidden?: boolean;
  exclude?: ID[];
  /** Shows each category's available amount when given. */
  summary?: MonthSummary;
  placeholder?: string;
  ariaLabel?: string;
}) {
  const skip = new Set(exclude ?? []);
  const label = (name: string, catId: ID) => {
    const available = summary?.categories[catId]?.available;
    return available === undefined ? name : `${name} (${formatMoney(available)})`;
  };
  return (
    <select
      id={id}
      className="field"
      aria-label={ariaLabel}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
    >
      {placeholder !== undefined && (
        <option value="" disabled={!includeUncategorized}>
          {placeholder}
        </option>
      )}
      {includeUncategorized && placeholder === undefined && (
        <option value="">{typeof includeUncategorized === 'string' ? includeUncategorized : 'Uncategorized'}</option>
      )}
      {includeReadyToAssign && !skip.has(READY_TO_ASSIGN) && (
        <option value={READY_TO_ASSIGN}>
          {summary ? `Ready to Assign (${formatMoney(summary.readyToAssign)})` : 'Ready to Assign'}
        </option>
      )}
      {state.groups.map((g) => {
        if (g.isCreditCardPayments && !includePayments) return null;
        const cats = state.categories.filter(
          (c) => c.groupId === g.id && !skip.has(c.id) && (includeHidden || !c.hidden || c.id === value),
        );
        if (!cats.length) return null;
        return (
          <optgroup key={g.id} label={g.name}>
            {cats.map((c) => (
              <option key={c.id} value={c.id}>
                {label(c.name, c.id)}
              </option>
            ))}
          </optgroup>
        );
      })}
    </select>
  );
}

export function categoryName(state: BudgetState, id: ID | null | undefined): string {
  if (id === READY_TO_ASSIGN) return 'Ready to Assign';
  if (!id) return '';
  return state.categories.find((c) => c.id === id)?.name ?? 'Deleted category';
}

export function AccountSelect({
  id,
  state,
  value,
  onChange,
  exclude,
  includeClosed,
  ariaLabel,
  placeholder,
}: {
  id?: string;
  state: BudgetState;
  value: ID | '';
  onChange: (id: ID) => void;
  exclude?: ID[];
  includeClosed?: boolean;
  ariaLabel?: string;
  placeholder?: string;
}) {
  const accounts = state.accounts.filter((a) => (includeClosed || !a.closed || a.id === value) && !exclude?.includes(a.id));
  return (
    <select id={id} className="field" aria-label={ariaLabel} value={value} onChange={(e) => onChange(e.target.value)}>
      {placeholder && (
        <option value="" disabled>
          {placeholder}
        </option>
      )}
      {accounts.map((a) => (
        <option key={a.id} value={a.id}>
          {a.name}
        </option>
      ))}
    </select>
  );
}
