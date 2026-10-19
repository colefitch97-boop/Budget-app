import { monthOf } from './dates';
import type { BudgetState, Month } from './types';

/*
 * Where the budget lives.
 *
 * On claude.ai the app saves to the artifact's private per-person store,
 * so a budget follows its owner across devices and nobody else can read
 * it. Anywhere else (running locally, or a saved copy) it falls back to
 * this browser's localStorage.
 *
 * The cloud store caps documents at 256 KiB, so the budget is split into
 * one document for its structure (accounts, categories, schedules) and one
 * per month for that month's transactions and assignments. Only documents
 * whose contents changed are written.
 */

export type SaveStatus =
  | { state: 'idle' }
  | { state: 'saving' }
  | { state: 'saved'; at: number }
  | { state: 'error'; message: string };

export interface Persistence {
  /** 'cloud' syncs to the person's account; 'device' stays in this browser. */
  where: 'cloud' | 'device';
  load(): Promise<BudgetState | null>;
  save(state: BudgetState): void;
  /** Wipes every stored document (used when someone starts over). */
  clear(): Promise<void>;
  onRemoteChange(cb: (state: BudgetState) => void): () => void;
  onStatus(cb: (status: SaveStatus) => void): () => void;
  flush(): Promise<void>;
}

type Shards = Record<string, Record<string, unknown>>;
const META = 'meta';
const monthKey = (m: Month) => `m:${m}`;

export function toShards(state: BudgetState): Shards {
  const { transactions, assigned, ...meta } = state;
  const shards: Shards = { [META]: meta as unknown as Record<string, unknown> };
  const ensure = (m: Month) =>
    (shards[monthKey(m)] ??= { month: m, transactions: [], assigned: {} }) as {
      transactions: unknown[];
      assigned: Record<string, number>;
    };
  for (const t of transactions) ensure(monthOf(t.date)).transactions.push(t);
  for (const [m, byCat] of Object.entries(assigned)) {
    if (Object.keys(byCat).length) ensure(m).assigned = byCat;
  }
  return shards;
}

export function fromShards(shards: Shards): BudgetState | null {
  const meta = shards[META] as Partial<BudgetState> | undefined;
  if (!meta) return null;
  const transactions: BudgetState['transactions'] = [];
  const assigned: BudgetState['assigned'] = {};
  for (const key of Object.keys(shards).sort()) {
    if (!key.startsWith('m:')) continue;
    const shard = shards[key] as { month?: Month; transactions?: BudgetState['transactions']; assigned?: Record<string, number> };
    if (Array.isArray(shard.transactions)) transactions.push(...shard.transactions);
    if (shard.assigned && Object.keys(shard.assigned).length) assigned[shard.month ?? key.slice(2)] = shard.assigned;
  }
  return normalize({ ...meta, transactions, assigned });
}

/** Fills in anything missing from older or hand-edited data. */
export function normalize(raw: Partial<BudgetState>): BudgetState | null {
  if (!raw || typeof raw !== 'object') return null;
  return {
    version: 1,
    name: typeof raw.name === 'string' ? raw.name : 'My Budget',
    settings: { currency: raw.settings?.currency || 'USD' },
    accounts: Array.isArray(raw.accounts) ? raw.accounts : [],
    groups: Array.isArray(raw.groups) ? raw.groups : [],
    categories: Array.isArray(raw.categories) ? raw.categories : [],
    transactions: Array.isArray(raw.transactions) ? raw.transactions : [],
    scheduled: Array.isArray(raw.scheduled) ? raw.scheduled : [],
    assigned: raw.assigned && typeof raw.assigned === 'object' ? raw.assigned : {},
    ...(raw.isSample ? { isSample: true } : {}),
  };
}

function emitter<T>() {
  const subs = new Set<(v: T) => void>();
  return {
    on(cb: (v: T) => void) {
      subs.add(cb);
      return () => void subs.delete(cb);
    },
    emit(v: T) {
      subs.forEach((cb) => cb(v));
    },
  };
}

/* ----------------------------------------------------------- this browser */

const LOCAL_KEY = 'allot-budget:v1';

export function localPersistence(): Persistence {
  const remote = emitter<BudgetState>();
  const status = emitter<SaveStatus>();
  let pending: BudgetState | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const write = () => {
    timer = undefined;
    if (!pending) return;
    try {
      localStorage.setItem(LOCAL_KEY, JSON.stringify(pending));
      status.emit({ state: 'saved', at: Date.now() });
    } catch {
      status.emit({ state: 'error', message: 'This browser would not save the budget. Download a backup from Settings.' });
    }
    pending = null;
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('storage', (e) => {
      if (e.key !== LOCAL_KEY || !e.newValue) return;
      try {
        const next = normalize(JSON.parse(e.newValue));
        if (next) remote.emit(next);
      } catch {
        /* another tab wrote something unreadable; ignore it */
      }
    });
    window.addEventListener('pagehide', write);
  }

  return {
    where: 'device',
    async load() {
      try {
        const raw = localStorage.getItem(LOCAL_KEY);
        return raw ? normalize(JSON.parse(raw)) : null;
      } catch {
        return null;
      }
    },
    save(state) {
      pending = state;
      status.emit({ state: 'saving' });
      clearTimeout(timer);
      timer = setTimeout(write, 250);
    },
    async clear() {
      clearTimeout(timer);
      pending = null;
      try {
        localStorage.removeItem(LOCAL_KEY);
      } catch {
        /* nothing to clear */
      }
    },
    onRemoteChange: remote.on,
    onStatus: status.on,
    async flush() {
      clearTimeout(timer);
      write();
    },
  };
}

/* ------------------------------------------------------------ claude.ai */

// The subset of the artifact runtime's `db` and `user` capabilities used here.
interface DocSnap {
  id: string;
  exists: boolean;
  data(): Record<string, unknown> | undefined;
  metadata: { hasPendingWrites: boolean };
}
interface DocRef {
  get(): Promise<DocSnap>;
  set(data: Record<string, unknown>): Promise<void>;
  delete(): Promise<void>;
  onSnapshot(next: (s: DocSnap) => void, error?: (e: { code: string }) => void): () => void;
  collection(path: string): CollRef;
}
interface CollRef {
  doc(id: string): DocRef;
  get(): Promise<{ docs: DocSnap[] }>;
  onSnapshot(
    next: (s: { docChanges(): { type: 'added' | 'modified' | 'removed'; doc: DocSnap }[]; metadata: { hasPendingWrites: boolean } }) => void,
    error?: (e: { code: string }) => void,
  ): () => void;
}
interface DB {
  doc(path: string): DocRef;
}
interface UserCap {
  id(): Promise<string | null>;
}
interface ClaudeRuntime {
  use(name: string): Promise<unknown>;
}

const errorMessage = (code: string | undefined) =>
  code === 'quota_exceeded'
    ? 'Your saved budget has reached its storage limit. Download a backup from Settings.'
    : code === 'invalid_argument'
      ? 'This page can’t save changes for you. Ask its owner for edit access, or download a backup from Settings.'
      : 'Changes could not be saved. They will be retried with your next edit.';

/** Resolves to cloud persistence when the page runs inside claude.ai with storage granted. */
export async function cloudPersistence(): Promise<Persistence | null> {
  const runtime = (globalThis as unknown as { claude?: ClaudeRuntime }).claude;
  if (!runtime?.use) return null;
  const [db, user] = (await Promise.all([runtime.use('db'), runtime.use('user')])) as [DB | null, UserCap | null];
  if (!db || !user) return null;
  const uid = await user.id();
  if (!uid) return null;

  const root = db.doc(`data/users/${uid}/budget`);
  const months = root.collection('months');
  const ref = (key: string) => (key === META ? root : months.doc(key.slice(2)));

  const remote = emitter<BudgetState>();
  const status = emitter<SaveStatus>();
  /** What the store holds, as far as we know, per shard. */
  const known = new Map<string, string>();
  /** Our latest local shards. */
  let local = new Map<string, string>();
  const dirty = new Set<string>();
  let writing: Promise<void> | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let failed = false;

  const writeOne = async (key: string) => {
    const json = local.get(key);
    if (json === undefined) await ref(key).delete();
    else await ref(key).set(JSON.parse(json));
    if (json === undefined) known.delete(key);
    else known.set(key, json);
  };

  const drain = async () => {
    status.emit({ state: 'saving' });
    failed = false;
    while (dirty.size) {
      const key = dirty.values().next().value as string;
      dirty.delete(key);
      if (local.get(key) === known.get(key)) continue;
      try {
        await writeOne(key);
      } catch (e) {
        const code = (e as { code?: string })?.code;
        if (code === 'unavailable') {
          await new Promise((r) => setTimeout(r, 800 + Math.random() * 800));
          try {
            await writeOne(key);
            continue;
          } catch {
            /* fall through to report */
          }
        }
        dirty.add(key);
        failed = true;
        status.emit({ state: 'error', message: errorMessage(code) });
        return;
      }
    }
    status.emit({ state: 'saved', at: Date.now() });
  };

  const kick = () => {
    clearTimeout(timer);
    timer = undefined;
    if (writing) return;
    writing = drain().finally(() => {
      writing = null;
      if (dirty.size && !failed) kick();
    });
  };

  const applyRemote = (key: string, data: Record<string, unknown> | undefined) => {
    const json = data === undefined ? undefined : JSON.stringify(data);
    if (json === known.get(key)) return;
    if (json === undefined) known.delete(key);
    else known.set(key, json);
    // Our own unsaved edit to this shard wins; it will overwrite the remote one.
    if (dirty.has(key) || local.get(key) === json) return;
    if (json === undefined) local.delete(key);
    else local.set(key, json);
    const shards: Shards = {};
    for (const [k, v] of local) shards[k] = JSON.parse(v);
    const next = fromShards(shards);
    if (next) remote.emit(next);
  };

  let subscribed = false;
  const subscribe = () => {
    if (subscribed) return;
    subscribed = true;
    root.onSnapshot(
      (snap) => {
        if (!snap.metadata.hasPendingWrites) applyRemote(META, snap.exists ? snap.data() : undefined);
      },
      () => undefined,
    );
    months.onSnapshot(
      (snap) => {
        if (snap.metadata.hasPendingWrites) return;
        for (const change of snap.docChanges()) {
          applyRemote(monthKey(change.doc.id), change.type === 'removed' ? undefined : change.doc.data());
        }
      },
      () => undefined,
    );
  };

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden' && dirty.size) kick();
    });
  }

  return {
    where: 'cloud',
    async load() {
      const [meta, monthDocs] = await Promise.all([root.get(), months.get()]);
      if (!meta.exists) {
        subscribe();
        return null;
      }
      const shards: Shards = { [META]: meta.data()! };
      for (const d of monthDocs.docs) if (d.exists) shards[monthKey(d.id)] = d.data()!;
      for (const [k, v] of Object.entries(shards)) {
        const json = JSON.stringify(v);
        known.set(k, json);
        local.set(k, json);
      }
      subscribe();
      return fromShards(shards);
    },
    save(state) {
      const next = new Map(Object.entries(toShards(state)).map(([k, v]) => [k, JSON.stringify(v)]));
      for (const k of new Set([...next.keys(), ...local.keys()])) {
        if (next.get(k) !== local.get(k)) dirty.add(k);
      }
      local = next;
      if (!dirty.size) return;
      status.emit({ state: 'saving' });
      clearTimeout(timer);
      timer = setTimeout(kick, 700);
    },
    async clear() {
      local = new Map();
      for (const k of known.keys()) dirty.add(k);
      kick();
      await writing;
    },
    onRemoteChange: remote.on,
    onStatus: status.on,
    async flush() {
      if (dirty.size) kick();
      await writing;
    },
  };
}

/** Cloud when available, otherwise this browser. */
export async function choosePersistence(): Promise<Persistence> {
  try {
    const cloud = await cloudPersistence();
    if (cloud) return cloud;
  } catch {
    /* fall back to the browser */
  }
  return localPersistence();
}
