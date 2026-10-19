import { useEffect, useMemo, useRef, useState } from 'react';
import { addMonths, currentMonth, formatMonth, formatMonthName } from '../lib/dates';
import { formatMoney } from '../lib/money';
import { clampRange, incomeVsSpending, netWorthByMonth, spendingByCategory } from '../lib/reports';
import type { Cents, Month } from '../lib/types';
import { useApp } from '../state';
import { categoryName } from './pickers';
import { EmptyState, Money, Segmented } from './ui';

type Tab = 'spending' | 'cashflow' | 'networth';
type Range = '1' | '3' | '6' | '12' | 'ytd' | 'all';

const RANGES: { value: Range; label: string }[] = [
  { value: '1', label: 'This month' },
  { value: '3', label: '3 months' },
  { value: '6', label: '6 months' },
  { value: '12', label: '12 months' },
  { value: 'ytd', label: 'This year' },
  { value: 'all', label: 'All time' },
];

export function ReportsView() {
  const { state } = useApp();
  const [tab, setTab] = useState<Tab>('spending');
  const [range, setRange] = useState<Range>('6');
  const to = currentMonth();
  const [from] = useMemo((): [Month, Month] => {
    if (range === 'ytd') return clampRange(state, to, Number(to.slice(5, 7)));
    if (range === 'all') return clampRange(state, to, 1200);
    return clampRange(state, to, Number(range));
  }, [range, state, to]);

  const rangeLabel = from === to ? formatMonth(to) : `${formatMonth(from, 'short')} – ${formatMonth(to, 'short')}`;

  return (
    <div className="page reports">
      <header className="page-head">
        <div>
          <p className="eyebrow">Reports</p>
          <h1>Where your money went</h1>
        </div>
      </header>
      <div className="report-controls">
        <label className="sr-only" htmlFor="report-range">
          Time range
        </label>
        <select id="report-range" className="field field-sm" value={range} onChange={(e) => setRange(e.target.value as Range)}>
          {RANGES.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
        <Segmented
          label="Report"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'spending', label: 'Spending' },
            { value: 'cashflow', label: 'Income vs spending' },
            { value: 'networth', label: 'Net worth' },
          ]}
        />
        <span className="range-label">{rangeLabel}</span>
      </div>
      {tab === 'spending' && <SpendingReport from={from} to={to} />}
      {tab === 'cashflow' && <CashFlowReport from={from} to={to} />}
      {tab === 'networth' && <NetWorthReport from={from} to={to} />}
    </div>
  );
}

/* ---------------------------------------------------------------- spending */

function SpendingReport({ from, to }: { from: Month; to: Month }) {
  const { state } = useApp();
  const [by, setBy] = useState<'category' | 'group'>('category');
  const rows = useMemo(() => spendingByCategory(state, from, to).filter((r) => r.amount > 0), [state, from, to]);
  const groups = useMemo(() => {
    const map = new Map<string, Cents>();
    for (const r of rows) {
      const key = r.groupId ?? 'none';
      map.set(key, (map.get(key) ?? 0) + r.amount);
    }
    return [...map]
      .map(([id, amount]) => ({ id, amount, name: state.groups.find((g) => g.id === id)?.name ?? 'Uncategorized' }))
      .sort((a, b) => b.amount - a.amount);
  }, [rows, state.groups]);
  const total = rows.reduce((s, r) => s + r.amount, 0);
  const months = Math.max(1, monthCount(from, to));
  const items =
    by === 'category'
      ? rows.map((r) => ({
          id: r.categoryId,
          name: r.categoryId === 'uncategorized' ? 'Uncategorized' : categoryName(state, r.categoryId),
          sub: state.groups.find((g) => g.id === r.groupId)?.name ?? '',
          amount: r.amount,
        }))
      : groups.map((g) => ({ id: g.id, name: g.name, sub: '', amount: g.amount }));
  const max = Math.max(1, ...items.map((i) => i.amount));

  if (!rows.length) return <EmptyState title="No spending in this range">Spending shows up here once you add transactions with categories.</EmptyState>;

  return (
    <section className="report-card">
      <div className="report-stats">
        <Stat label="Total spending" value={formatMoney(total)} />
        <Stat label="Average per month" value={formatMoney(Math.round(total / months))} />
        <Stat label="Biggest category" value={items[0] ? (by === 'category' ? items[0].name : groups[0].name) : '—'} />
      </div>
      <div className="report-sub-head">
        <h2>Spending by {by}</h2>
        <Segmented
          label="Group spending by"
          value={by}
          onChange={setBy}
          options={[
            { value: 'category', label: 'Category' },
            { value: 'group', label: 'Group' },
          ]}
        />
      </div>
      <ol className="hbar-list">
        {items.map((i) => (
          <li key={i.id} className="hbar" tabIndex={0} aria-label={`${i.name}: ${formatMoney(i.amount)}, ${Math.round((i.amount / total) * 100)}%`}>
            <span className="hbar-label">
              <span className="hbar-name">{i.name}</span>
              {i.sub && <span className="hbar-sub">{i.sub}</span>}
            </span>
            <span className="hbar-track">
              <span className="hbar-fill" style={{ width: `${Math.max(0.5, (i.amount / max) * 100)}%` }} />
            </span>
            <span className="hbar-value">
              <Money cents={i.amount} />
              <span className="hbar-pct">{((i.amount / total) * 100).toFixed(1)}%</span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function monthCount(from: Month, to: Month) {
  let n = 0;
  for (let m = from; m <= to; m = addMonths(m, 1)) n++;
  return n;
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'pos' | 'neg' }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className={`stat-value${tone ? ` ${tone}` : ''}`}>{value}</span>
    </div>
  );
}

/* --------------------------------------------------------------- shared svg */

function useWidth<T extends HTMLElement>(): [React.RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(640);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setWidth(Math.max(280, el.clientWidth));
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

function niceTicks(min: number, max: number, count = 4): number[] {
  const span = max - min || 1;
  const raw = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= count) ?? mag * 10;
  const ticks: number[] = [];
  const end = Math.ceil(max / step) * step;
  for (let v = Math.floor(min / step) * step; v <= end + step * 0.001; v += step) ticks.push(Math.round(v));
  return ticks;
}

const compact = (cents: number) => formatMoney(cents, { compact: true });

interface Tip {
  x: number;
  y: number;
  title: string;
  rows: { label: string; value: string; key?: string }[];
}

function Tooltip({ tip }: { tip: Tip | null }) {
  if (!tip) return null;
  return (
    <div className="chart-tip" style={{ left: tip.x, top: tip.y }} role="status">
      <div className="tip-title">{tip.title}</div>
      {tip.rows.map((r) => (
        <div className="tip-row" key={r.label}>
          {r.key && <span className="tip-key" style={{ background: `var(${r.key})` }} />}
          <span className="tip-value">{r.value}</span>
          <span className="tip-label">{r.label}</span>
        </div>
      ))}
    </div>
  );
}

/* ----------------------------------------------------- income vs spending */

function CashFlowReport({ from, to }: { from: Month; to: Month }) {
  const { state } = useApp();
  const data = useMemo(() => incomeVsSpending(state, from, to), [state, from, to]);
  const [ref, width] = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<Tip | null>(null);
  const [active, setActive] = useState<number | null>(null);

  const income = data.reduce((s, d) => s + d.income, 0);
  const spending = data.reduce((s, d) => s + d.spending, 0);
  if (!income && !spending) return <EmptyState title="Nothing to compare yet">Add income and spending to see how they balance each month.</EmptyState>;

  const height = 260;
  const pad = { top: 16, right: 8, bottom: 28, left: 52 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const maxV = Math.max(1, ...data.map((d) => Math.max(d.income, d.spending)));
  const ticks = niceTicks(0, maxV);
  const top = ticks[ticks.length - 1];
  const y = (v: number) => pad.top + plotH - (Math.max(0, v) / top) * plotH;
  const band = plotW / data.length;
  const barW = Math.min(24, Math.max(4, (band - 14) / 2));
  const gap = 2;
  const showEvery = Math.ceil(data.length / Math.max(1, Math.floor(plotW / 56)));

  const bar = (x: number, v: number) => {
    const h = Math.max(0, y(0) - y(v));
    if (h < 1) return '';
    const r = Math.min(4, h, barW / 2);
    const yt = y(0) - h;
    return `M${x},${y(0)} V${yt + r} Q${x},${yt} ${x + r},${yt} H${x + barW - r} Q${x + barW},${yt} ${x + barW},${yt + r} V${y(0)} Z`;
  };

  return (
    <section className="report-card viz-root">
      <div className="report-stats">
        <Stat label="Income" value={formatMoney(income)} />
        <Stat label="Spending" value={formatMoney(spending)} />
        <Stat label={income - spending >= 0 ? 'Saved' : 'Spent beyond income'} value={formatMoney(Math.abs(income - spending))} tone={income - spending >= 0 ? 'pos' : 'neg'} />
      </div>
      <div className="legend">
        <span>
          <i className="swatch" style={{ background: 'var(--series-1)' }} /> Income
        </span>
        <span>
          <i className="swatch" style={{ background: 'var(--series-2)' }} /> Spending
        </span>
      </div>
      <div className="chart" ref={ref} onPointerLeave={() => (setTip(null), setActive(null))}>
        <svg width={width} height={height} role="img" aria-label={`Income and spending by month, ${formatMonth(from)} to ${formatMonth(to)}`}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.left} x2={width - pad.right} y1={y(t)} y2={y(t)} className="grid" />
              <text x={pad.left - 8} y={y(t)} className="axis" textAnchor="end" dominantBaseline="middle">
                {compact(t)}
              </text>
            </g>
          ))}
          {data.map((d, i) => {
            const cx = pad.left + band * i + band / 2;
            const x1 = cx - barW - gap / 2;
            const x2 = cx + gap / 2;
            const show = (e: { clientX: number; clientY: number } | null) => {
              setActive(i);
              const rect = ref.current!.getBoundingClientRect();
              setTip({
                x: Math.min(width - 170, Math.max(0, (e ? e.clientX - rect.left : cx) + 12)),
                y: e ? e.clientY - rect.top - 10 : y(Math.max(d.income, d.spending)),
                title: formatMonth(d.month),
                rows: [
                  { label: 'Income', value: formatMoney(d.income), key: '--series-1' },
                  { label: 'Spending', value: formatMoney(d.spending), key: '--series-2' },
                  { label: 'Net', value: formatMoney(d.income - d.spending, { signed: true }) },
                ],
              });
            };
            return (
              <g key={d.month} className={active === null || active === i ? '' : 'dimmed'}>
                <rect
                  x={pad.left + band * i}
                  y={pad.top}
                  width={band}
                  height={plotH}
                  className="hit"
                  tabIndex={0}
                  aria-label={`${formatMonth(d.month)}: income ${formatMoney(d.income)}, spending ${formatMoney(d.spending)}`}
                  onPointerMove={(e) => show(e)}
                  onFocus={() => show(null)}
                  onBlur={() => (setTip(null), setActive(null))}
                />
                <path d={bar(x1, d.income)} fill="var(--series-1)" pointerEvents="none" />
                <path d={bar(x2, d.spending)} fill="var(--series-2)" pointerEvents="none" />
                {i % showEvery === 0 && (
                  <text x={cx} y={height - 8} className="axis" textAnchor="middle">
                    {data.length > 12 ? `${formatMonthName(d.month)} ’${d.month.slice(2, 4)}` : formatMonthName(d.month)}
                  </text>
                )}
              </g>
            );
          })}
          <line x1={pad.left} x2={width - pad.right} y1={y(0)} y2={y(0)} className="baseline" />
        </svg>
        <Tooltip tip={tip} />
      </div>
      <div className="table-scroll">
        <table className="mini-table">
          <thead>
            <tr>
              <th>Month</th>
              <th className="num">Income</th>
              <th className="num">Spending</th>
              <th className="num">Net</th>
            </tr>
          </thead>
          <tbody>
            {[...data].reverse().map((d) => (
              <tr key={d.month}>
                <td>{formatMonth(d.month)}</td>
                <td className="num">{formatMoney(d.income)}</td>
                <td className="num">{formatMoney(d.spending)}</td>
                <td className={`num ${d.income - d.spending >= 0 ? 'pos' : 'neg'}`}>{formatMoney(d.income - d.spending, { signed: true })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* --------------------------------------------------------------- net worth */

function NetWorthReport({ from, to }: { from: Month; to: Month }) {
  const { state } = useApp();
  const data = useMemo(() => netWorthByMonth(state, from, to), [state, from, to]);
  const [ref, width] = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<Tip | null>(null);
  const [active, setActive] = useState<number | null>(null);
  if (!state.accounts.length) return <EmptyState title="No accounts yet">Add accounts to track your net worth over time.</EmptyState>;

  const last = data[data.length - 1];
  const first = data[0];
  const height = 260;
  const pad = { top: 20, right: 16, bottom: 28, left: 56 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const values = data.map((d) => d.net);
  const ticks = niceTicks(Math.min(0, ...values), Math.max(0, ...values));
  const lo = ticks[0];
  const hi = ticks[ticks.length - 1];
  const x = (i: number) => pad.left + (data.length === 1 ? plotW / 2 : (i / (data.length - 1)) * plotW);
  const y = (v: number) => pad.top + plotH - ((v - lo) / (hi - lo || 1)) * plotH;
  const line = data.map((d, i) => `${i ? 'L' : 'M'}${x(i)},${y(d.net)}`).join(' ');
  const area = `${line} L${x(data.length - 1)},${y(Math.max(lo, 0))} L${x(0)},${y(Math.max(lo, 0))} Z`;
  const showEvery = Math.ceil(data.length / Math.max(1, Math.floor(plotW / 56)));

  const show = (i: number) => {
    const d = data[i];
    setActive(i);
    setTip({
      x: Math.min(width - 180, x(i) + 12),
      y: Math.max(0, y(d.net) - 40),
      title: formatMonth(d.month),
      rows: [
        { label: 'Net worth', value: formatMoney(d.net) },
        { label: 'What you own', value: formatMoney(d.assets) },
        { label: 'What you owe', value: formatMoney(-d.debts) },
      ],
    });
  };
  const nearest = (clientX: number) => {
    const rect = ref.current!.getBoundingClientRect();
    const px = clientX - rect.left - pad.left;
    return Math.max(0, Math.min(data.length - 1, Math.round((px / plotW) * (data.length - 1))));
  };

  return (
    <section className="report-card viz-root">
      <div className="report-stats">
        <Stat label="Net worth" value={formatMoney(last.net)} tone={last.net < 0 ? 'neg' : undefined} />
        <Stat label="What you own" value={formatMoney(last.assets)} />
        <Stat label="What you owe" value={formatMoney(-last.debts)} />
        {data.length > 1 && (
          <Stat
            label={`Change since ${formatMonth(first.month, 'short')}`}
            value={formatMoney(last.net - first.net, { signed: true })}
            tone={last.net - first.net >= 0 ? 'pos' : 'neg'}
          />
        )}
      </div>
      <div
        className="chart"
        ref={ref}
        tabIndex={0}
        aria-label="Net worth chart. Use the left and right arrow keys to read each month."
        onPointerMove={(e) => show(nearest(e.clientX))}
        onPointerLeave={() => (setTip(null), setActive(null))}
        onBlur={() => (setTip(null), setActive(null))}
        onKeyDown={(e) => {
          if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
          e.preventDefault();
          const i = active === null ? data.length - 1 : Math.max(0, Math.min(data.length - 1, active + (e.key === 'ArrowLeft' ? -1 : 1)));
          show(i);
        }}
      >
        <svg width={width} height={height} role="img" aria-label={`Net worth from ${formatMonth(from)} to ${formatMonth(to)}`}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.left} x2={width - pad.right} y1={y(t)} y2={y(t)} className={t === 0 ? 'baseline' : 'grid'} />
              <text x={pad.left - 8} y={y(t)} className="axis" textAnchor="end" dominantBaseline="middle">
                {compact(t)}
              </text>
            </g>
          ))}
          <path d={area} fill="var(--series-1)" opacity={0.1} />
          <path d={line} fill="none" stroke="var(--series-1)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {active !== null && <line x1={x(active)} x2={x(active)} y1={pad.top} y2={pad.top + plotH} className="crosshair" />}
          {data.map((d, i) =>
            i % showEvery === 0 ? (
              <text key={d.month} x={x(i)} y={height - 8} className="axis" textAnchor="middle">
                {data.length > 12 ? `${formatMonthName(d.month)} ’${d.month.slice(2, 4)}` : formatMonthName(d.month)}
              </text>
            ) : null,
          )}
          <circle cx={x(active ?? data.length - 1)} cy={y(data[active ?? data.length - 1].net)} r={5} fill="var(--series-1)" stroke="var(--surface)" strokeWidth={2} />
        </svg>
        <Tooltip tip={tip} />
      </div>
      <div className="table-scroll">
        <table className="mini-table">
          <thead>
            <tr>
              <th>Month end</th>
              <th className="num">What you own</th>
              <th className="num">What you owe</th>
              <th className="num">Net worth</th>
            </tr>
          </thead>
          <tbody>
            {[...data].reverse().map((d) => (
              <tr key={d.month}>
                <td>{formatMonth(d.month)}</td>
                <td className="num">{formatMoney(d.assets)}</td>
                <td className="num">{formatMoney(-d.debts)}</td>
                <td className={`num${d.net < 0 ? ' neg' : ''}`}>{formatMoney(d.net)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
