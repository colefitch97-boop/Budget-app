import { afterEach, describe, expect, it, vi } from 'vitest';
import { saveTransaction } from './ops';
import { buildSampleBudget } from './sample';
import { cloudPersistence } from './storage';

/** A tiny in-memory stand-in for the artifact runtime's `db` capability. */
function fakeRuntime() {
  const docs = new Map<string, Record<string, unknown>>();
  const writes: string[] = [];
  const snap = (path: string) => ({
    id: path.split('/').pop()!,
    exists: docs.has(path),
    data: () => docs.get(path),
    metadata: { hasPendingWrites: false },
  });
  const docRef = (path: string): unknown => ({
    get: async () => snap(path),
    set: async (data: Record<string, unknown>) => {
      writes.push(`set ${path}`);
      docs.set(path, JSON.parse(JSON.stringify(data)));
    },
    delete: async () => {
      writes.push(`delete ${path}`);
      docs.delete(path);
    },
    onSnapshot: () => () => undefined,
    collection: (name: string) => collRef(`${path}/${name}`),
  });
  const collRef = (path: string) => ({
    doc: (id: string) => docRef(`${path}/${id}`),
    get: async () => ({
      docs: [...docs.keys()].filter((k) => k.startsWith(path + '/') && !k.slice(path.length + 1).includes('/')).map(snap),
    }),
    onSnapshot: () => () => undefined,
  });
  const runtime = {
    use: async (name: string) =>
      name === 'db' ? { doc: docRef } : name === 'user' ? { id: async () => 'u_test' } : null,
  };
  return { runtime, docs, writes };
}

afterEach(() => {
  vi.useRealTimers();
  delete (globalThis as { claude?: unknown }).claude;
});

describe('cloud persistence', () => {
  it('saves only changed months and loads the budget back', async () => {
    vi.useFakeTimers();
    const fake = fakeRuntime();
    (globalThis as { claude?: unknown }).claude = fake.runtime;

    const first = (await cloudPersistence())!;
    expect(first.where).toBe('cloud');
    expect(await first.load()).toBeNull();

    const budget = { ...buildSampleBudget('2026-10-19'), isSample: undefined };
    first.save(budget);
    await vi.advanceTimersByTimeAsync(1000);
    await first.flush();
    expect([...fake.docs.keys()].sort()).toEqual([
      'data/users/u_test/budget',
      'data/users/u_test/budget/months/2026-08',
      'data/users/u_test/budget/months/2026-09',
      'data/users/u_test/budget/months/2026-10',
    ]);

    // One new October transaction rewrites only October.
    fake.writes.length = 0;
    const checking = budget.accounts[0].id;
    const next = saveTransaction(budget, { accountId: checking, date: '2026-10-18', payee: 'Kroger', memo: '', amount: -2_000, categoryId: null }).state;
    first.save(next);
    await vi.advanceTimersByTimeAsync(1000);
    await first.flush();
    expect(fake.writes).toEqual(['set data/users/u_test/budget/months/2026-10']);

    // A fresh session reads the same budget back.
    const second = (await cloudPersistence())!;
    const loaded = await second.load();
    expect(loaded?.transactions).toHaveLength(next.transactions.length);
    expect(loaded?.assigned).toEqual(next.assigned);

    // Starting over deletes the old months.
    await second.clear();
    expect(fake.docs.size).toBe(0);
  });
});
