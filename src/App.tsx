import { useCallback, useEffect, useState } from 'react';
import { AccountView } from './components/AccountView';
import { BudgetView } from './components/BudgetView';
import { DialogHost } from './components/Dialogs';
import { ReportsView } from './components/ReportsView';
import { SettingsView } from './components/SettingsView';
import { Sidebar } from './components/Sidebar';
import { Icon } from './components/ui';
import { buildSampleBudget } from './lib/sample';
import { choosePersistence, type Persistence } from './lib/storage';
import type { BudgetState } from './lib/types';
import { AppProvider, useApp } from './state';

type Boot =
  | { status: 'loading' }
  | { status: 'ready'; initial: BudgetState; persistence: Persistence }
  | { status: 'error' };

export function App() {
  const [boot, setBoot] = useState<Boot>({ status: 'loading' });

  const start = useCallback(async () => {
    setBoot({ status: 'loading' });
    const persistence = await choosePersistence();
    try {
      const saved = await persistence.load();
      setBoot({ status: 'ready', initial: saved ?? buildSampleBudget(), persistence });
    } catch {
      // Never fall back to an empty budget here: saving it would overwrite the real one.
      setBoot({ status: 'error' });
    }
  }, []);

  useEffect(() => {
    start();
  }, [start]);

  if (boot.status === 'loading') {
    return (
      <div className="splash" role="status">
        <span className="splash-mark" aria-hidden="true" />
        <p>Opening your budget…</p>
      </div>
    );
  }
  if (boot.status === 'error') {
    return (
      <div className="splash">
        <h1>Your budget didn’t load</h1>
        <p>Check your internet connection, then try again. Nothing has been changed.</p>
        <button type="button" className="btn btn-primary" onClick={start}>
          Try again
        </button>
      </div>
    );
  }
  return (
    <AppProvider initial={boot.initial} persistence={boot.persistence}>
      <Shell />
    </AppProvider>
  );
}

function Shell() {
  const { route, state, openDialog, canUndo, undo, toasts, dismissToast } = useApp();
  const [drawer, setDrawer] = useState(false);

  useEffect(() => {
    document.querySelector('.main')?.scrollTo(0, 0);
  }, [route]);

  useEffect(() => {
    if (!drawer) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setDrawer(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [drawer]);

  const title =
    route.view === 'budget'
      ? 'Budget'
      : route.view === 'reports'
        ? 'Reports'
        : route.view === 'settings'
          ? 'Settings'
          : route.accountId === 'all'
            ? 'All Accounts'
            : (state.accounts.find((a) => a.id === route.accountId)?.name ?? 'Account');

  return (
    <div className={`app${drawer ? ' drawer-open' : ''}`}>
      <div className="sidebar-wrap">
        <Sidebar onNavigate={() => setDrawer(false)} />
      </div>
      {drawer && <div className="drawer-backdrop" onClick={() => setDrawer(false)} aria-hidden="true" />}

      <div className="main">
        <header className="topbar">
          <button type="button" className="icon-btn" onClick={() => setDrawer(true)} aria-label="Open menu" aria-expanded={drawer}>
            <Icon name="menu" />
          </button>
          <span className="topbar-title">{title}</span>
          <button type="button" className="icon-btn" onClick={undo} disabled={!canUndo} aria-label="Undo">
            <Icon name="undo" />
          </button>
          <button type="button" className="icon-btn topbar-add" onClick={() => openDialog({ kind: 'transaction', accountId: route.view === 'account' && route.accountId !== 'all' ? route.accountId : undefined })} aria-label="Add transaction">
            <Icon name="plus" />
          </button>
        </header>

        {state.isSample && (
          <div className="sample-banner" role="note">
            <span>
              <strong>This is a sample budget.</strong> Explore freely; none of these numbers are yours.
            </span>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => openDialog({ kind: 'setup' })}>
              Start my own budget
            </button>
          </div>
        )}

        <main className="content">
          {route.view === 'budget' && <BudgetView />}
          {route.view === 'account' && <AccountView accountId={route.accountId} initialFilter={route.filter} />}
          {route.view === 'reports' && <ReportsView />}
          {route.view === 'settings' && <SettingsView />}
        </main>

        <div className="desk-undo">
          <button type="button" className="btn btn-quiet btn-sm" onClick={undo} disabled={!canUndo} title="Undo (Ctrl+Z)">
            <Icon name="undo" size={16} /> Undo
          </button>
        </div>
      </div>

      <DialogHost />

      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="toast">
            <span>{t.message}</span>
            {t.undo && canUndo && (
              <button
                type="button"
                className="toast-action"
                onClick={() => {
                  undo();
                  dismissToast(t.id);
                }}
              >
                Undo
              </button>
            )}
            <button type="button" className="icon-btn icon-btn-sm toast-close" onClick={() => dismissToast(t.id)} aria-label="Dismiss">
              <Icon name="close" size={14} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
