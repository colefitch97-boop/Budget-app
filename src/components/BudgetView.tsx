import { useMemo, useState } from 'react';
import { categoryStatus, type CategoryMonth, type MonthSummary } from '../lib/budget';
import { addMonths, currentMonth, formatMonth } from '../lib/dates';
import { formatMoney } from '../lib/money';
import { AUTO_ASSIGN_LABELS, autoAssignPlan, setAssigned, autoAssign, updateGroup, type AutoAssignStrategy } from '../lib/ops';
import { UNCATEGORIZED, type Category, type CategoryGroup, type ID } from '../lib/types';
import { useApp } from '../state';
import { Inspector } from './Inspector';
import { Icon, Menu, Money, MoneyInput, ProgressBar } from './ui';

type Filter = 'all' | 'underfunded' | 'overspent' | 'available';

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'underfunded', label: 'Underfunded' },
  { value: 'overspent', label: 'Overspent' },
  { value: 'available', label: 'Money available' },
];

export function BudgetView() {
  const { state, model, month, setMonth, act, selectedCategory, selectCategory, openDialog, go } = useApp();
  const [filter, setFilter] = useState<Filter>('all');
  const [showHidden, setShowHidden] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const summary = model.get(month);
  const thisMonth = currentMonth();

  const uncategorizedCount = useMemo(
    () =>
      state.transactions.filter((t) => {
        if (t.categoryId !== null || t.splits || t.startingBalance) return false;
        const account = state.accounts.find((a) => a.id === t.accountId);
        if (!account || account.type === 'asset' || account.type === 'liability') return false;
        if (t.transferAccountId) {
          const other = state.accounts.find((a) => a.id === t.transferAccountId);
          if (other && other.type !== 'asset' && other.type !== 'liability') return false;
        }
        return true;
      }).length,
    [state],
  );

  const overspent = state.categories.filter((c) => (summary.categories[c.id]?.available ?? 0) < 0);
  const hiddenCount = state.categories.filter((c) => c.hidden).length;

  const matches = (c: Category) => {
    const cm = summary.categories[c.id];
    if (c.hidden && !showHidden) return false;
    switch (filter) {
      case 'underfunded':
        return categoryStatus(cm, c.hidden) === 'underfunded';
      case 'overspent':
        return (cm?.available ?? 0) < 0;
      case 'available':
        return (cm?.available ?? 0) > 0;
      default:
        return true;
    }
  };

  const uncat = summary.categories[UNCATEGORIZED];
  const showUncategorizedRow = uncat && (uncat.activity !== 0 || uncat.available !== 0);

  return (
    <div className="budget-layout">
      <div className="budget-main">
        <header className="budget-header">
          <div className="month-nav">
            <button type="button" className="icon-btn" onClick={() => setMonth(addMonths(month, -1))} aria-label="Previous month">
              <Icon name="left" />
            </button>
            <h1 className="month-title">{formatMonth(month)}</h1>
            <button type="button" className="icon-btn" onClick={() => setMonth(addMonths(month, 1))} aria-label="Next month">
              <Icon name="right" />
            </button>
            {month !== thisMonth && (
              <button type="button" className="btn btn-quiet btn-sm" onClick={() => setMonth(thisMonth)}>
                Back to {formatMonth(thisMonth, 'short').split(' ')[0]}
              </button>
            )}
          </div>
          <ReadyToAssign summary={summary} onShowBreakdown={() => setSummaryOpen(true)} />
        </header>

        <div className="banners">
          {uncategorizedCount > 0 && (
            <button type="button" className="banner banner-warn" onClick={() => go({ view: 'account', accountId: 'all', filter: 'uncategorized' })}>
              <Icon name="info" />
              <span>
                <strong>{uncategorizedCount}</strong> {uncategorizedCount === 1 ? 'transaction needs' : 'transactions need'} a category
              </span>
              <Icon name="right" size={16} />
            </button>
          )}
          {overspent.length > 0 && (
            <button type="button" className="banner banner-neg" onClick={() => setFilter('overspent')}>
              <Icon name="info" />
              <span>
                <strong>{overspent.length}</strong> {overspent.length === 1 ? 'category is' : 'categories are'} overspent. Move money to cover{' '}
                {overspent.length === 1 ? 'it' : 'them'}.
              </span>
              <Icon name="right" size={16} />
            </button>
          )}
        </div>

        <div className="budget-toolbar">
          <div className="chips" role="radiogroup" aria-label="Show categories">
            {FILTERS.map((f) => (
              <button
                key={f.value}
                type="button"
                role="radio"
                aria-checked={filter === f.value}
                className={`chip${filter === f.value ? ' active' : ''}`}
                onClick={() => setFilter(f.value)}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="toolbar-actions">
            <button type="button" className="btn btn-quiet btn-sm summary-btn" onClick={() => setSummaryOpen(true)}>
              Month summary
            </button>
            <button type="button" className="btn btn-quiet btn-sm" onClick={() => openDialog({ kind: 'group' })}>
              <Icon name="plus" size={16} /> Category group
            </button>
          </div>
        </div>

        <div className="budget-table" role="table" aria-label={`Budget for ${formatMonth(month)}`}>
          <div className="bt-row bt-head" role="row">
            <span role="columnheader">Category</span>
            <span role="columnheader" className="num col-assigned">
              Assigned
            </span>
            <span role="columnheader" className="num col-activity">
              Activity
            </span>
            <span role="columnheader" className="num">
              Available
            </span>
          </div>

          {showUncategorizedRow && filter === 'all' && (
            <div className="bt-group" role="rowgroup">
              <div className="bt-row bt-group-row" role="row">
                <span role="cell" className="group-name">
                  Uncategorized
                </span>
              </div>
              <div
                className={`bt-row bt-cat${selectedCategory === UNCATEGORIZED ? ' selected' : ''}`}
                role="row"
                onClick={() => go({ view: 'account', accountId: 'all', filter: 'uncategorized' })}
              >
                <span role="cell" className="cat-cell">
                  <span className="cat-name">Uncategorized transactions</span>
                  <span className="cat-note">Give these a category to budget for them</span>
                </span>
                <span role="cell" className="num col-assigned muted">
                  —
                </span>
                <span role="cell" className="num col-activity">
                  <Money cents={uncat.activity} />
                </span>
                <span role="cell" className="num">
                  <AvailablePill cm={uncat} />
                </span>
              </div>
            </div>
          )}

          {state.groups.map((g) => {
            const cats = state.categories.filter((c) => c.groupId === g.id);
            const visible = cats.filter(matches);
            if (filter !== 'all' && !visible.length) return null;
            if (g.isCreditCardPayments && !cats.length) return null;
            return (
              <GroupRows
                key={g.id}
                group={g}
                cats={visible}
                allCats={cats}
                summary={summary}
                onToggle={() => act('Collapse group', (s) => updateGroup(s, g.id, { collapsed: !g.collapsed }))}
              />
            );
          })}

          {!state.categories.length && (
            <div className="bt-empty">
              <p>Add a category group to start giving your money jobs.</p>
              <button type="button" className="btn btn-primary" onClick={() => openDialog({ kind: 'group' })}>
                Add a category group
              </button>
            </div>
          )}
        </div>

        {hiddenCount > 0 && (
          <button type="button" className="btn btn-quiet btn-sm show-hidden" onClick={() => setShowHidden(!showHidden)}>
            <Icon name="eyeOff" size={16} /> {showHidden ? 'Hide' : 'Show'} hidden categories ({hiddenCount})
          </button>
        )}
      </div>

      <Inspector
        open={summaryOpen || selectedCategory !== null}
        onClose={() => {
          setSummaryOpen(false);
          selectCategory(null);
        }}
        onBackToSummary={() => {
          selectCategory(null);
          setSummaryOpen(true);
        }}
      />
    </div>
  );
}

function ReadyToAssign({ summary, onShowBreakdown }: { summary: MonthSummary; onShowBreakdown: () => void }) {
  const { state, model, month, act } = useApp();
  const rta = summary.readyToAssign;
  const tone = rta > 0 ? 'pos' : rta < 0 ? 'neg' : 'zero';

  const strategies: AutoAssignStrategy[] = ['underfunded', 'assigned-last-month', 'spent-last-month', 'average-assigned', 'average-spent'];
  const items = strategies.map((strategy) => {
    const plan = autoAssignPlan(state, model, month, strategy);
    let delta = 0;
    for (const [id, value] of plan) delta += value - (summary.categories[id]?.assigned ?? 0);
    return {
      label: (
        <span className="menu-row">
          <span>{AUTO_ASSIGN_LABELS[strategy]}</span>
          <span className="money">{formatMoney(delta)}</span>
        </span>
      ),
      disabled: plan.size === 0,
      onSelect: () => act(`Assigned: ${AUTO_ASSIGN_LABELS[strategy].toLowerCase()}`, (s) => autoAssign(s, month, strategy), { toast: true }),
    };
  });

  return (
    <div className={`rta rta-${tone}`}>
      <button type="button" className="rta-figure" onClick={onShowBreakdown} aria-label="Show how Ready to Assign is calculated">
        <span className="rta-amount">{formatMoney(rta)}</span>
        <span className="rta-label">
          {rta > 0 ? 'Ready to Assign' : rta < 0 ? 'Assigned more than you have' : 'All money assigned'}
        </span>
      </button>
      <div className="rta-side">
        <p className="rta-hint">
          {rta > 0
            ? 'Give every dollar a job.'
            : rta < 0
              ? 'Take money back from categories until this reaches zero.'
              : 'Every dollar has a job. Nice work.'}
        </p>
        {rta > 0 && (
          <Menu
            label="Assign money automatically"
            className="rta-menu"
            trigger={
              <span className="btn btn-on-rta">
                Assign <Icon name="down" size={16} />
              </span>
            }
            items={items}
          />
        )}
      </div>
    </div>
  );
}

function GroupRows({
  group,
  cats,
  allCats,
  summary,
  onToggle,
}: {
  group: CategoryGroup;
  cats: Category[];
  allCats: Category[];
  summary: MonthSummary;
  onToggle: () => void;
}) {
  const { openDialog } = useApp();
  let assigned = 0;
  let activity = 0;
  let available = 0;
  for (const c of allCats) {
    const cm = summary.categories[c.id];
    if (!cm) continue;
    assigned += cm.assigned;
    activity += cm.activity;
    available += cm.available;
  }
  return (
    <div className="bt-group" role="rowgroup">
      <div className="bt-row bt-group-row" role="row">
        <span role="cell" className="group-cell">
          <button type="button" className="icon-btn icon-btn-sm" onClick={onToggle} aria-expanded={!group.collapsed} aria-label={`${group.collapsed ? 'Expand' : 'Collapse'} ${group.name}`}>
            <Icon name={group.collapsed ? 'right' : 'down'} size={16} />
          </button>
          <span className="group-name">{group.name}</span>
          {!group.isCreditCardPayments && (
            <span className="group-actions">
              <button type="button" className="icon-btn icon-btn-sm" onClick={() => openDialog({ kind: 'category', groupId: group.id })} aria-label={`Add a category to ${group.name}`}>
                <Icon name="plus" size={16} />
              </button>
              <button type="button" className="icon-btn icon-btn-sm" onClick={() => openDialog({ kind: 'group', groupId: group.id })} aria-label={`Edit ${group.name}`}>
                <Icon name="edit" size={15} />
              </button>
            </span>
          )}
        </span>
        <span role="cell" className="num col-assigned">
          <Money cents={assigned} />
        </span>
        <span role="cell" className="num col-activity">
          <Money cents={activity} />
        </span>
        <span role="cell" className="num">
          <Money cents={available} />
        </span>
      </div>
      {!group.collapsed && cats.map((c) => <CategoryRow key={c.id} cat={c} cm={summary.categories[c.id]} />)}
    </div>
  );
}

function CategoryRow({ cat, cm }: { cat: Category; cm: CategoryMonth | undefined }) {
  const { act, month, selectedCategory, selectCategory, openDialog, state } = useApp();
  if (!cm) return null;
  const status = categoryStatus(cm, cat.hidden);
  const selected = selectedCategory === cat.id;
  const card = cat.creditAccountId ? state.accounts.find((a) => a.id === cat.creditAccountId) : undefined;

  let note: string | null = null;
  if (status === 'cash-overspent') note = `Overspent by ${formatMoney(-cm.available)}. Cover it from another category.`;
  else if (status === 'credit-overspent') note = `${formatMoney(cm.creditOverspent)} of card spending isn’t covered yet`;
  else if (status === 'underfunded' && cm.target) note = `${formatMoney(cm.target.needed)} more needed this month`;
  else if (cm.target && cm.target.needed === 0) note = cm.target.progress >= 1 ? 'Fully funded' : 'On track this month';
  else if (card) note = `Set aside to pay ${card.name}`;

  return (
    <div
      className={`bt-row bt-cat${selected ? ' selected' : ''}${cat.hidden ? ' is-hidden' : ''}`}
      role="row"
      aria-selected={selected}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('input, button')) return;
        selectCategory(selected ? null : cat.id);
      }}
    >
      <span role="cell" className="cat-cell">
        <button type="button" className="cat-name" onClick={() => selectCategory(cat.id)}>
          {cat.name}
        </button>
        {cm.target && <ProgressBar value={cm.target.progress} tone={status === 'underfunded' ? 'warn' : status.includes('overspent') ? 'neg' : 'pos'} />}
        {note && <span className={`cat-note tone-${status}`}>{note}</span>}
      </span>
      <span role="cell" className="num col-assigned">
        <MoneyInput
          value={cm.assigned}
          relative
          ariaLabel={`Assigned to ${cat.name}`}
          className="assigned-input"
          onCommit={(v) => act(`Assigned to ${cat.name}`, (s) => setAssigned(s, month, cat.id, v))}
          onKeyDownExtra={(e) => {
            if (e.key === 'Enter' || (e.key === 'ArrowDown' && !e.shiftKey) || e.key === 'ArrowUp') {
              const inputs = [...document.querySelectorAll<HTMLInputElement>('.assigned-input')];
              const i = inputs.indexOf(e.currentTarget);
              const next = inputs[i + (e.key === 'ArrowUp' ? -1 : 1)];
              if (next) {
                e.preventDefault();
                setTimeout(() => next.focus(), 0);
              }
            }
          }}
        />
      </span>
      <span role="cell" className="num col-activity">
        <Money cents={cm.activity} className={cm.activity === 0 ? 'muted' : ''} />
      </span>
      <span role="cell" className="num">
        <AvailablePill cm={cm} hidden={cat.hidden} onClick={() => openDialog({ kind: 'move', categoryId: cat.id })} />
      </span>
    </div>
  );
}

export function AvailablePill({ cm, hidden, onClick, large }: { cm: CategoryMonth; hidden?: boolean; onClick?: () => void; large?: boolean }) {
  const status = categoryStatus(cm, hidden);
  const content = formatMoney(cm.available);
  const label =
    status === 'cash-overspent'
      ? 'overspent'
      : status === 'credit-overspent'
        ? 'overspent on credit'
        : status === 'underfunded'
          ? 'underfunded'
          : '';
  if (!onClick)
    return (
      <span className={`pill pill-${status}${large ? ' pill-lg' : ''}`}>
        {content}
        {label && <span className="sr-only"> ({label})</span>}
      </span>
    );
  return (
    <button type="button" className={`pill pill-${status}${large ? ' pill-lg' : ''}`} onClick={onClick} title="Move money">
      {content}
      <span className="sr-only">{label ? ` (${label})` : ''}, move money</span>
    </button>
  );
}

export function useCategoryLookup(): (id: ID) => Category | undefined {
  const { state } = useApp();
  const map = useMemo(() => new Map(state.categories.map((c) => [c.id, c])), [state.categories]);
  return (id) => map.get(id);
}
