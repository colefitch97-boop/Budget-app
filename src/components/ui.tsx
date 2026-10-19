import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { applyMoneyInput, formatMoney, formatPlain, parseMoney } from '../lib/money';
import type { Cents } from '../lib/types';

/* ------------------------------------------------------------------- icons */

const PATHS = {
  budget: 'M3 7.5 12 3l9 4.5M4.5 9v8.25M19.5 9v8.25M9 9v8.25M15 9v8.25M3 20.25h18',
  reports: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  accounts: 'M3 6.75h18v10.5H3zM3 10.5h18M7 14.25h3',
  settings:
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM19.4 13.5a7.7 7.7 0 0 0 0-3l2-1.6-2-3.4-2.4 1a7.5 7.5 0 0 0-2.6-1.5L14 2.5h-4l-.4 2.5A7.5 7.5 0 0 0 7 6.5l-2.4-1-2 3.4 2 1.6a7.7 7.7 0 0 0 0 3l-2 1.6 2 3.4 2.4-1a7.5 7.5 0 0 0 2.6 1.5l.4 2.5h4l.4-2.5a7.5 7.5 0 0 0 2.6-1.5l2.4 1 2-3.4z',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  left: 'm15 18-6-6 6-6',
  right: 'm9 18 6-6-6-6',
  down: 'm6 9 6 6 6-6',
  up: 'm18 15-6-6-6 6',
  close: 'M18 6 6 18M6 6l12 12',
  menu: 'M4 7h16M4 12h16M4 17h16',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM20 20l-4-4',
  undo: 'M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11',
  upload: 'M12 16V4M7 9l5-5 5 5M4 20h16',
  download: 'M12 4v12M7 11l5 5 5-5M4 20h16',
  check: 'm5 12.5 4.5 4.5L19 7.5',
  lock: 'M6.5 11h11v9h-11zM8.5 11V8a3.5 3.5 0 0 1 7 0v3',
  edit: 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4',
  trash: 'M4 7h16M9 7V4h6v3M6.5 7l1 13h9l1-13',
  repeat: 'M17 2.5 20.5 6 17 9.5M3.5 11V9.5A3.5 3.5 0 0 1 7 6h13.5M7 21.5 3.5 18 7 14.5M20.5 13v1.5A3.5 3.5 0 0 1 17 18H3.5',
  split: 'M6 3v6a4 4 0 0 0 4 4h8M14 9l4 4-4 4M6 21v-4',
  transfer: 'M7 7h13l-4-4M17 17H4l4 4',
  target: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 16.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9ZM12 12h.01',
  eyeOff: 'M3 3l18 18M10.6 6.1A9.8 9.8 0 0 1 12 6c5 0 8.5 4.5 9.5 6a17 17 0 0 1-2.6 3.2M6.5 7.6C4.4 9 3 11 2.5 12c1 1.5 4.5 6 9.5 6a9.6 9.6 0 0 0 4.4-1.1M9.9 10a3 3 0 0 0 4.2 4.2',
  calendar: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 11v5M12 8h.01',
  move: 'M5 12h14M13 6l6 6-6 6',
  sparkle: 'M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18',
  card: 'M2.5 6h19v12h-19zM2.5 10h19',
  wallet: 'M3 7h15a3 3 0 0 1 3 3v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM3 7l11-3.5V7M16.5 14h.01',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
};

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 18, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      className={className ? `icon ${className}` : 'icon'}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

/* ------------------------------------------------------------------- money */

export function Money({ cents, className, signed }: { cents: Cents; className?: string; signed?: boolean }) {
  return <span className={`money${className ? ` ${className}` : ''}`}>{formatMoney(cents, { signed })}</span>;
}

/**
 * A money field that accepts arithmetic and relative edits ("+20").
 * It commits on blur or Enter and reverts on Escape.
 */
export function MoneyInput({
  value,
  onCommit,
  id,
  className,
  placeholder = '0.00',
  relative = false,
  autoFocus,
  ariaLabel,
  onKeyDownExtra,
}: {
  value: Cents;
  onCommit: (cents: Cents) => void;
  id?: string;
  className?: string;
  placeholder?: string;
  /** Lets "+20" / "-20" adjust the current value instead of replacing it. */
  relative?: boolean;
  autoFocus?: boolean;
  ariaLabel?: string;
  onKeyDownExtra?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
}) {
  const [text, setText] = useState(formatPlain(value));
  const [focused, setFocused] = useState(false);
  const [invalid, setInvalid] = useState(false);
  useEffect(() => {
    if (!focused) setText(formatPlain(value));
  }, [value, focused]);

  const commit = () => {
    const next = relative ? applyMoneyInput(value, text) : parseMoney(text);
    if (next === null) {
      setInvalid(true);
      return false;
    }
    setInvalid(false);
    if (next !== value) onCommit(next);
    setText(formatPlain(next));
    return true;
  };

  return (
    <input
      id={id}
      className={`money-input${invalid ? ' invalid' : ''}${className ? ` ${className}` : ''}`}
      inputMode="decimal"
      autoComplete="off"
      aria-label={ariaLabel}
      aria-invalid={invalid || undefined}
      placeholder={placeholder}
      value={text}
      autoFocus={autoFocus}
      onFocus={(e) => {
        setFocused(true);
        e.currentTarget.select();
      }}
      onBlur={() => {
        setFocused(false);
        if (!commit()) setText(formatPlain(value));
        setInvalid(false);
      }}
      onChange={(e) => {
        setText(e.target.value);
        setInvalid(false);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          commit();
        } else if (e.key === 'Escape') {
          setText(formatPlain(value));
          setInvalid(false);
          e.currentTarget.blur();
        }
        onKeyDownExtra?.(e);
      }}
    />
  );
}

/** A controlled money field for forms: keeps the typed text and reports the parsed value. */
export function AmountField({
  id,
  value,
  onChange,
  autoFocus,
  ariaLabel,
}: {
  id?: string;
  value: string;
  onChange: (text: string, cents: Cents | null) => void;
  autoFocus?: boolean;
  ariaLabel?: string;
}) {
  return (
    <input
      id={id}
      className="field money-field"
      inputMode="decimal"
      autoComplete="off"
      placeholder="0.00"
      aria-label={ariaLabel}
      value={value}
      autoFocus={autoFocus}
      onChange={(e) => onChange(e.target.value, parseMoney(e.target.value))}
    />
  );
}

/* ----------------------------------------------------------------- dialogs */

export function Modal({
  title,
  onClose,
  children,
  footer,
  wide,
  labelledBy,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  labelledBy?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const el = ref.current;
    const first = el?.querySelector<HTMLElement>('[autofocus], input, select, textarea, button:not(.modal-close)');
    (first ?? el)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
      if (e.key === 'Tab' && el) {
        const items = [...el.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter(
          (x) => !x.hasAttribute('disabled') && x.offsetParent !== null,
        );
        if (!items.length) return;
        const firstItem = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === firstItem) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          firstItem.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      prev?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        className={`modal${wide ? ' modal-wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy ?? titleId}
        tabIndex={-1}
      >
        <header className="modal-head">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="icon-btn modal-close" onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>
  );
}

export function Field({ label, htmlFor, hint, error, children }: { label: string; htmlFor?: string; hint?: ReactNode; error?: string | null; children: ReactNode }) {
  return (
    <div className={`form-field${error ? ' has-error' : ''}`}>
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {error ? <p className="field-error">{error}</p> : hint ? <p className="field-hint">{hint}</p> : null}
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          className={value === o.value ? 'active' : ''}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** A small dropdown menu anchored to its trigger button. */
export function Menu({
  label,
  trigger,
  items,
  align = 'right',
  className,
}: {
  label: string;
  trigger: ReactNode;
  items: { label: ReactNode; onSelect: () => void; danger?: boolean; disabled?: boolean }[];
  align?: 'left' | 'right';
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);
  return (
    <div className={`menu-wrap${className ? ` ${className}` : ''}`} ref={ref}>
      <button type="button" className="menu-trigger" aria-haspopup="menu" aria-expanded={open} aria-label={label} onClick={() => setOpen(!open)}>
        {trigger}
      </button>
      {open && (
        <div className={`menu menu-${align}`} role="menu">
          {items.map((item, i) => (
            <button
              key={i}
              type="button"
              role="menuitem"
              className={item.danger ? 'danger' : ''}
              disabled={item.disabled}
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty-state">
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function ProgressBar({ value, tone }: { value: number; tone: string }) {
  return (
    <span className={`progress tone-${tone}`} aria-hidden="true">
      <span style={{ width: `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%` }} />
    </span>
  );
}
