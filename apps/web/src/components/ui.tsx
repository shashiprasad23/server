import { useCallback, useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Loader2, X } from 'lucide-react';
import { ApiError } from '@/api';
import { cn } from '@/lib/utils';

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  busy,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; size?: 'sm' | 'md'; busy?: boolean }) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-colors disabled:pointer-events-none disabled:opacity-50',
        size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-9 px-3.5 text-sm',
        variant === 'primary' && 'bg-primary text-primary-foreground hover:opacity-90',
        variant === 'secondary' && 'border border-border bg-card hover:bg-muted',
        variant === 'ghost' && 'hover:bg-muted',
        variant === 'danger' && 'bg-bad text-white hover:opacity-90',
        className,
      )}
      disabled={busy || props.disabled}
      {...props}
    >
      {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
      {children}
    </button>
  );
}

const TONES: Record<string, string> = {
  neutral: 'bg-muted text-muted-foreground',
  info: 'bg-accent text-primary',
  good: 'bg-good/15 text-good',
  warn: 'bg-warn/20 text-[color-mix(in_oklch,var(--warn)_70%,var(--foreground))]',
  bad: 'bg-bad/15 text-bad',
};

const STATUS_TONE: Record<string, keyof typeof TONES> = {
  executed: 'good', approved: 'good', accepted: 'good', cleared: 'good', clear: 'good', in_stock: 'good', done: 'good', running: 'good', qualified: 'good', received: 'good', sent: 'info',
  queued: 'warn', pending: 'warn', pending_approval: 'warn', screening: 'warn', partial: 'warn', submitted: 'info', draft: 'neutral', requested: 'warn', flagged: 'warn', potential_match: 'warn', licence_required: 'warn', nurture: 'neutral',
  blocked: 'bad', rejected: 'bad', expired: 'neutral', rolled_back: 'neutral', withdrawn: 'neutral', superseded: 'neutral', lead_time: 'bad', stopped: 'bad', not_screened: 'neutral', failed: 'bad',
};

export function Badge({ children, tone, className }: { children: ReactNode; tone?: keyof typeof TONES; className?: string }) {
  const t = tone ?? STATUS_TONE[String(children)] ?? 'neutral';
  return <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap', TONES[t], className)}>{String(children).replace(/_/g, ' ')}</span>;
}

export function Card({ className, children, title, action }: { className?: string; children: ReactNode; title?: ReactNode; action?: ReactNode }) {
  return (
    <section className={cn('rounded-xl border border-border bg-card p-4 shadow-sm', className)}>
      {(title || action) && (
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">{title}</h3>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">{children}</div>;
}

export function Spinner() {
  return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />;
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: [T, string][]; value: T; onChange: (t: T) => void }) {
  return (
    <div className="flex gap-1 overflow-x-auto border-b border-border">
      {tabs.map(([k, label]) => (
        <button
          key={k}
          onClick={() => onChange(k)}
          className={cn(
            'relative -mb-px px-3 py-2 text-sm whitespace-nowrap transition-colors',
            value === k ? 'border-b-2 border-primary font-medium text-foreground' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export function Drawer({ open, onClose, children, wide }: { open: boolean; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div className="fixed inset-0 z-40 bg-black/30" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.aside
            role="dialog"
            className={cn('fixed top-0 right-0 z-50 h-full w-full overflow-y-auto border-l border-border bg-background shadow-2xl', wide ? 'max-w-4xl' : 'max-w-xl')}
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 32, stiffness: 300 }}
          >
            <button aria-label="Close" onClick={onClose} className="absolute top-3 right-3 rounded-md p-1.5 text-muted-foreground hover:bg-muted">
              <X className="h-4 w-4" />
            </button>
            {children}
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  const e = error as ApiError;
  const details = Array.isArray(e.details) ? (e.details as { message?: string; path?: string }[]).map((d) => d.message ?? d.path).filter(Boolean) : [];
  return (
    <div className="my-2 rounded-md border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">
      {e.message}
      {details.length > 0 && <ul className="mt-1 list-disc pl-5">{details.map((d, i) => <li key={i}>{d}</li>)}</ul>}
    </div>
  );
}

/** Fetch-on-mount with reload and optional polling. */
export function useData<T>(fn: () => Promise<T>, deps: unknown[] = [], pollMs?: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const reload = useCallback(async () => {
    try {
      setData(await fnRef.current());
      setError(null);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    setLoading(true);
    reload();
    if (!pollMs) return;
    const t = setInterval(reload, pollMs);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, reload, pollMs]);
  return { data, error, loading, reload, setData };
}

/** Run an action with busy state and error capture. */
export function useAction() {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const run = useCallback(async <T,>(key: string, fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(key);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError(e);
      return undefined;
    } finally {
      setBusy(null);
    }
  }, []);
  return { busy, error, run, setError };
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="font-medium text-muted-foreground">{label}</span>
      {children}
      {hint && <span className="text-muted-foreground">{hint}</span>}
    </label>
  );
}

export function KeyValue({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[minmax(110px,auto)_1fr] gap-x-4 gap-y-1.5 text-sm">
      {items.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="min-w-0 break-words">{v ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}
