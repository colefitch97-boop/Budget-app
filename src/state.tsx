import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { computeBudget, type BudgetModel } from './lib/budget';
import { currentMonth, today } from './lib/dates';
import { setCurrency } from './lib/money';
import { enterDueScheduled } from './lib/ops';
import type { Persistence, SaveStatus } from './lib/storage';
import type { BudgetState, ID, Month } from './lib/types';

export type Route =
  | { view: 'budget' }
  | { view: 'account'; accountId: ID | 'all'; filter?: 'uncategorized' | 'uncleared' }
  | { view: 'reports' }
  | { view: 'settings' };

export type Dialog =
  | { kind: 'transaction'; transactionId?: ID; accountId?: ID; scheduledId?: ID; preset?: 'payment'; categoryId?: ID }
  | { kind: 'account'; accountId?: ID }
  | { kind: 'reconcile'; accountId: ID }
  | { kind: 'import'; accountId?: ID }
  | { kind: 'category'; categoryId?: ID; groupId?: ID }
  | { kind: 'group'; groupId?: ID }
  | { kind: 'move'; categoryId: ID }
  | { kind: 'setup' }
  | {
      kind: 'confirm';
      title: string;
      body: ReactNode;
      confirmLabel: string;
      danger?: boolean;
      onConfirm: () => void;
    };

export interface Toast {
  id: number;
  message: string;
  undo?: boolean;
}

interface AppContextValue {
  state: BudgetState;
  model: BudgetModel;
  month: Month;
  setMonth: (m: Month) => void;
  /** Applies a change. `label` names it for the undo toast when `toast` is set. */
  act: (label: string, fn: (s: BudgetState) => BudgetState, opts?: { toast?: boolean }) => void;
  undo: () => void;
  canUndo: boolean;
  /** Replaces the whole budget (setup, restore, start over); can't be undone. */
  replace: (next: BudgetState) => Promise<void>;
  route: Route;
  go: (route: Route) => void;
  dialog: Dialog | null;
  openDialog: (d: Dialog) => void;
  closeDialog: () => void;
  toasts: Toast[];
  toast: (message: string, opts?: { undo?: boolean }) => void;
  dismissToast: (id: number) => void;
  selectedCategory: ID | null;
  selectCategory: (id: ID | null) => void;
  saveStatus: SaveStatus;
  where: Persistence['where'];
}

const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
}

const HISTORY_LIMIT = 50;

export function AppProvider({
  initial,
  persistence,
  children,
}: {
  initial: BudgetState;
  persistence: Persistence;
  children: ReactNode;
}) {
  const [state, setState] = useState(initial);
  const history = useRef<BudgetState[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const [month, setMonth] = useState(currentMonth());
  const [route, setRoute] = useState<Route>(() => routeFromHash());
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [selectedCategory, selectCategory] = useState<ID | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>({ state: 'idle' });
  const stateRef = useRef(state);
  stateRef.current = state;

  setCurrency(state.settings.currency);

  useEffect(() => persistence.onStatus(setSaveStatus), [persistence]);
  useEffect(
    () =>
      persistence.onRemoteChange((next) => {
        // Another device or tab changed the budget; show its version.
        history.current = [];
        setCanUndo(false);
        setState(next);
      }),
    [persistence],
  );

  const commit = useCallback(
    (next: BudgetState, prev: BudgetState) => {
      history.current = [...history.current.slice(-(HISTORY_LIMIT - 1)), prev];
      setCanUndo(true);
      setState(next);
      persistence.save(next);
    },
    [persistence],
  );

  const toastSeq = useRef(0);
  const toast = useCallback((message: string, opts: { undo?: boolean } = {}) => {
    const id = ++toastSeq.current;
    setToasts((list) => [...list.slice(-2), { id, message, undo: opts.undo }]);
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), opts.undo ? 7000 : 4000);
  }, []);
  const dismissToast = useCallback((id: number) => setToasts((list) => list.filter((t) => t.id !== id)), []);

  const act = useCallback<AppContextValue['act']>(
    (label, fn, opts) => {
      const prev = stateRef.current;
      const next = fn(prev);
      if (next === prev) return;
      stateRef.current = next;
      commit(next, prev);
      if (opts?.toast) toast(label, { undo: true });
    },
    [commit, toast],
  );

  const undo = useCallback(() => {
    const prev = history.current.pop();
    if (!prev) return;
    setCanUndo(history.current.length > 0);
    stateRef.current = prev;
    setState(prev);
    persistence.save(prev);
    toast('Undone');
  }, [persistence, toast]);

  const replace = useCallback(
    async (next: BudgetState) => {
      history.current = [];
      setCanUndo(false);
      stateRef.current = next;
      setState(next);
      selectCategory(null);
      await persistence.clear();
      persistence.save(next);
    },
    [persistence],
  );

  // Enter scheduled transactions as they come due: now, and whenever the app comes back into view.
  useEffect(() => {
    const run = () => {
      const prev = stateRef.current;
      if (prev.isSample) return;
      const next = enterDueScheduled(prev, today());
      if (next !== prev) {
        stateRef.current = next;
        setState(next);
        persistence.save(next);
      }
    };
    run();
    const onVisible = () => document.visibilityState === 'visible' && run();
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [persistence]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing = target.closest('input, textarea, select, [contenteditable]');
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !e.shiftKey && !typing && !dialog) {
        e.preventDefault();
        undo();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [undo, dialog]);

  const go = useCallback((next: Route) => {
    setRoute(next);
    try {
      const hash = routeToHash(next);
      if (location.hash !== hash) window.history.replaceState(null, '', hash);
    } catch {
      /* the hash is a convenience only */
    }
  }, []);

  const model = useMemo(() => {
    const through = month > currentMonth() ? month : currentMonth();
    return computeBudget(state, through);
  }, [state, month]);

  const value: AppContextValue = {
    state,
    model,
    month,
    setMonth,
    act,
    undo,
    canUndo,
    replace,
    route,
    go,
    dialog,
    openDialog: setDialog,
    closeDialog: () => setDialog(null),
    toasts,
    toast,
    dismissToast,
    selectedCategory,
    selectCategory,
    saveStatus,
    where: persistence.where,
  };
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

function routeToHash(r: Route): string {
  if (r.view === 'account') return r.accountId === 'all' ? '#accounts' : `#account-${r.accountId}`;
  return `#${r.view}`;
}

function routeFromHash(): Route {
  try {
    const h = location.hash.slice(1);
    if (h === 'reports' || h === 'settings') return { view: h };
    if (h === 'accounts') return { view: 'account', accountId: 'all' };
    if (h.startsWith('account-')) return { view: 'account', accountId: h.slice(8) };
  } catch {
    /* fall through */
  }
  return { view: 'budget' };
}
