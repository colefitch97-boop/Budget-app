import { useMemo, useState } from 'react';
import { accountBalances } from '../lib/budget';
import { formatMoney } from '../lib/money';
import { isOnBudget, type Account } from '../lib/types';
import { useApp, type Route } from '../state';
import { Icon, type IconName } from './ui';

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { state, route, go, openDialog, saveStatus, where } = useApp();
  const [showClosed, setShowClosed] = useState(false);
  const balances = useMemo(() => accountBalances(state), [state]);

  const open = state.accounts.filter((a) => !a.closed);
  const budget = open.filter((a) => isOnBudget(a.type));
  const tracking = open.filter((a) => !isOnBudget(a.type));
  const closed = state.accounts.filter((a) => a.closed);
  const total = (list: Account[]) => list.reduce((sum, a) => sum + (balances.get(a.id)?.working ?? 0), 0);

  const nav = (r: Route) => {
    go(r);
    onNavigate?.();
  };
  const isActive = (r: Route) =>
    r.view === route.view && (r.view !== 'account' || (route.view === 'account' && route.accountId === r.accountId));

  const navItem = (r: Route, icon: IconName, label: string) => (
    <button key={label} type="button" className={`nav-item${isActive(r) ? ' active' : ''}`} onClick={() => nav(r)} aria-current={isActive(r) ? 'page' : undefined}>
      <Icon name={icon} />
      <span>{label}</span>
    </button>
  );

  const accountItem = (a: Account) => {
    const r: Route = { view: 'account', accountId: a.id };
    const bal = balances.get(a.id)?.working ?? 0;
    return (
      <button key={a.id} type="button" className={`account-item${isActive(r) ? ' active' : ''}`} onClick={() => nav(r)} aria-current={isActive(r) ? 'page' : undefined}>
        <span className="account-name">{a.name}</span>
        <span className={`account-bal${bal < 0 ? ' neg' : ''}`}>{formatMoney(bal)}</span>
      </button>
    );
  };

  const status =
    saveStatus.state === 'saving'
      ? 'Saving…'
      : saveStatus.state === 'error'
        ? saveStatus.message
        : state.isSample
          ? 'Sample data isn’t saved until you change it'
          : where === 'cloud'
            ? 'Saved privately to your account'
            : 'Saved in this browser';

  return (
    <nav className="sidebar" aria-label="Main">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true">
          <svg viewBox="0 0 32 32" width="28" height="28">
            <rect x="3" y="8" width="26" height="18" rx="3" fill="var(--brand-env)" />
            <path d="M3.8 9.2 16 18.5l12.2-9.3" fill="none" stroke="var(--sidebar-bg)" strokeWidth="2.2" strokeLinejoin="round" />
            <circle cx="24" cy="8" r="5" fill="var(--accent)" stroke="var(--sidebar-bg)" strokeWidth="2" />
          </svg>
        </span>
        <div className="brand-text">
          <span className="brand-name">Allot</span>
          <span className="brand-budget">{state.name}</span>
        </div>
      </div>

      <div className="nav-group">
        {navItem({ view: 'budget' }, 'budget', 'Budget')}
        {navItem({ view: 'reports' }, 'reports', 'Reports')}
        {navItem({ view: 'account', accountId: 'all' }, 'accounts', 'All Accounts')}
      </div>

      <div className="accounts">
        {budget.length > 0 && (
          <section>
            <h2 className="side-heading">
              <span>Budget</span>
              <span className={total(budget) < 0 ? 'neg' : ''}>{formatMoney(total(budget))}</span>
            </h2>
            {budget.map(accountItem)}
          </section>
        )}
        {tracking.length > 0 && (
          <section>
            <h2 className="side-heading">
              <span>Tracking</span>
              <span className={total(tracking) < 0 ? 'neg' : ''}>{formatMoney(total(tracking))}</span>
            </h2>
            {tracking.map(accountItem)}
          </section>
        )}
        {closed.length > 0 && (
          <section>
            <button type="button" className="side-heading side-toggle" onClick={() => setShowClosed(!showClosed)} aria-expanded={showClosed}>
              <span>Closed ({closed.length})</span>
              <Icon name={showClosed ? 'up' : 'down'} size={14} />
            </button>
            {showClosed && closed.map(accountItem)}
          </section>
        )}
        <button
          type="button"
          className="add-account"
          onClick={() => {
            openDialog({ kind: 'account' });
            onNavigate?.();
          }}
        >
          <Icon name="plus" size={16} />
          Add account
        </button>
      </div>

      <div className="sidebar-foot">
        <p className={`save-status${saveStatus.state === 'error' ? ' error' : ''}`} role="status">
          <span className={`dot dot-${saveStatus.state === 'error' ? 'error' : saveStatus.state === 'saving' ? 'saving' : 'ok'}`} aria-hidden="true" />
          {status}
        </p>
        {navItem({ view: 'settings' }, 'settings', 'Settings & backup')}
      </div>
    </nav>
  );
}
