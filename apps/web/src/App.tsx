import { useEffect, useState, type ComponentType } from 'react';
import {
  Bot,
  Boxes,
  CalendarClock,
  CheckSquare,
  FileText,
  Gauge,
  Inbox,
  KanbanSquare,
  LineChart,
  LogOut,
  Menu,
  Moon,
  Radio,
  RefreshCcw,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Sun,
  Users,
} from 'lucide-react';
import { api, hasToken, setToken } from '@/api';
import { useTheme } from '@/lib/theme';
import { cn } from '@/lib/utils';
import { type Me, type Page, SessionProvider, useSession } from '@/lib/session';
import { DotPattern } from '@/components/magicui/dot-pattern';
import { AnimatedGradientText } from '@/components/magicui/animated-gradient-text';
import { ShineBorder } from '@/components/magicui/shine-border';
import { DealDrawer } from '@/components/deal/DealDrawer';
import { Home } from '@/pages/Home';
import { Pipeline } from '@/pages/Pipeline';
import { Ask } from '@/pages/Ask';
import { Accounts } from '@/pages/Accounts';
import { Quotes } from '@/pages/Quotes';
import { Supply } from '@/pages/Supply';
import { Compliance } from '@/pages/Compliance';
import { Forecast } from '@/pages/Forecast';
import { Renewals } from '@/pages/Renewals';
import { Approvals } from '@/pages/Approvals';
import { Tasks } from '@/pages/Tasks';
import { Agents } from '@/pages/Agents';
import { Simulator } from '@/pages/Simulator';
import { SettingsPage } from '@/pages/Settings';

const USERS: [string, string, string][] = [
  ['vp.sales@uvation.com', 'VP Sales', 'Dashboards, forecast, approvals over 15%'],
  ['asha.rep@uvation.com', 'Asha, Account Executive', 'Own pipeline, quotes, customer email'],
  ['marco.rep@uvation.com', 'Marco, Account Executive', 'Own pipeline'],
  ['presales@uvation.com', 'Presales Architect', 'Configurations and site readiness'],
  ['dealdesk@uvation.com', 'Deal Desk', 'Discount and margin approvals'],
  ['trade.compliance@uvation.com', 'Trade Compliance', 'Screening, licences, end-user statements'],
  ['finance.ops@uvation.com', 'Finance Ops', 'Close confirmation (NetSuite reference)'],
  ['admin@uvation.com', 'Sales Ops Admin', 'Settings, custom fields, everything'],
];

const NAV: { group: string; items: [Page, string, ComponentType<{ className?: string }>][] }[] = [
  {
    group: 'Sell',
    items: [
      ['home', 'Home', Gauge],
      ['pipeline', 'Pipeline', KanbanSquare],
      ['ask', 'Ask ATLAS', Sparkles],
      ['accounts', 'Accounts', Users],
      ['quotes', 'Quotes', FileText],
    ],
  },
  {
    group: 'Operate',
    items: [
      ['supply', 'Supply', Boxes],
      ['compliance', 'Compliance', ShieldCheck],
      ['forecast', 'Forecast', LineChart],
      ['renewals', 'Renewals', RefreshCcw],
    ],
  },
  {
    group: 'Govern',
    items: [
      ['approvals', 'Approvals', Inbox],
      ['tasks', 'Tasks', CheckSquare],
      ['agents', 'Agents', Bot],
      ['simulator', 'Channel simulator', Radio],
      ['settings', 'Settings', Settings],
    ],
  },
];

const VIEWS: Record<Page, ComponentType> = {
  home: Home,
  pipeline: Pipeline,
  ask: Ask,
  accounts: Accounts,
  quotes: Quotes,
  supply: Supply,
  compliance: Compliance,
  forecast: Forecast,
  renewals: Renewals,
  approvals: Approvals,
  tasks: Tasks,
  agents: Agents,
  simulator: Simulator,
  settings: SettingsPage,
};

export function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [checked, setChecked] = useState(!hasToken());
  const [deal, setDeal] = useState<string | null>(null);

  useEffect(() => {
    if (!hasToken()) return;
    api<Me>('/v1/auth/me')
      .then(setMe)
      .catch(() => setMe(null))
      .finally(() => setChecked(true));
  }, []);

  if (!checked) return null;
  if (!me) return <SignIn onSignedIn={setMe} />;
  return (
    <SessionProvider me={me} onDeal={setDeal}>
      <Shell
        onSignOut={() => {
          setToken('');
          setMe(null);
        }}
      />
      <DealDrawer id={deal} onClose={() => setDeal(null)} />
    </SessionProvider>
  );
}

function SignIn({ onSignedIn }: { onSignedIn: (me: Me) => void }) {
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4">
      <DotPattern className="text-primary/25 [mask-image:radial-gradient(500px_circle_at_center,white,transparent)]" />
      <div className="relative w-full max-w-lg overflow-hidden rounded-2xl border border-border bg-card/90 p-6 shadow-xl backdrop-blur">
        <ShineBorder shineColor={['#2a78d6', '#eb6834']} />
        <AnimatedGradientText className="text-xs font-medium">AI-native sales for AI servers</AnimatedGradientText>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">ATLAS-I</h1>
        <p className="mt-1 text-sm text-muted-foreground">Uvation Marketplace and USP in one pipeline, with governed AI agents. Development sign-in: pick a persona.</p>
        <div className="mt-5 grid gap-2 sm:grid-cols-2">
          {USERS.map(([email, name, hint]) => (
            <button
              key={email}
              className="rounded-lg border border-border bg-background p-3 text-left transition hover:border-primary hover:bg-accent"
              onClick={async () => {
                setError(null);
                try {
                  const r = await api<{ token: string }>('/v1/auth/dev-token', { body: { email } });
                  setToken(r.token);
                  onSignedIn(await api<Me>('/v1/auth/me'));
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              <div className="text-sm font-medium">{name}</div>
              <div className="text-xs text-muted-foreground">{hint}</div>
            </button>
          ))}
        </div>
        {error && <p className="mt-3 text-sm text-bad">{error}</p>}
      </div>
    </div>
  );
}

function Shell({ onSignOut }: { onSignOut: () => void }) {
  const { page, go, me, version } = useSession();
  const { resolved, setTheme } = useTheme();
  const [pending, setPending] = useState(0);
  const [q, setQ] = useState('');
  const [navOpen, setNavOpen] = useState(false);
  const View = VIEWS[page];

  useEffect(() => {
    const load = () =>
      Promise.all([api<unknown[]>('/v1/approvals'), api<unknown[]>('/v1/quotes?status=pending_approval')])
        .then(([a, qs]) => setPending(a.length + qs.length))
        .catch(() => undefined);
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [version]);

  useEffect(() => setNavOpen(false), [page]);

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-30 flex w-60 flex-col border-r border-border bg-card px-3 py-4 transition-transform lg:sticky lg:top-0 lg:h-screen lg:translate-x-0',
          navOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <button className="mb-4 flex items-center gap-2 px-2 text-left" onClick={() => go('home')}>
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">A</div>
          <div>
            <div className="text-sm font-semibold">ATLAS-I</div>
            <div className="text-[11px] text-muted-foreground">Uvation AI-server CRM</div>
          </div>
        </button>
        <nav className="flex-1 space-y-4 overflow-y-auto">
          {NAV.map((g) => (
            <div key={g.group}>
              <div className="mb-1 px-2 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{g.group}</div>
              {g.items.map(([key, label, Icon]) => (
                <button
                  key={key}
                  onClick={() => go(key)}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors',
                    page === key ? 'bg-accent font-medium text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                  )}
                >
                  <Icon className="h-4 w-4" />
                  <span className="flex-1 text-left">{label}</span>
                  {key === 'approvals' && pending > 0 && <span className="rounded-full bg-primary px-1.5 text-[11px] text-primary-foreground">{pending}</span>}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="mt-3 border-t border-border pt-3 text-xs text-muted-foreground">
          <div className="px-2">Signed in as {me.roles.map((r) => r.replace(/_/g, ' ')).join(', ')}</div>
          <button className="mt-1 flex w-full items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted hover:text-foreground" onClick={onSignOut}>
            <LogOut className="h-3.5 w-3.5" /> Switch persona
          </button>
        </div>
      </aside>
      {navOpen && <div className="fixed inset-0 z-20 bg-black/30 lg:hidden" onClick={() => setNavOpen(false)} />}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-background/80 px-4 py-2.5 backdrop-blur md:px-6">
          <button className="rounded-md p-1.5 hover:bg-muted lg:hidden" aria-label="Menu" onClick={() => setNavOpen(true)}>
            <Menu className="h-4 w-4" />
          </button>
          <form
            className="relative max-w-xl flex-1"
            onSubmit={(e) => {
              e.preventDefault();
              if (q.trim().length >= 3) go('ask', { q: q.trim() });
            }}
          >
            <Search className="absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Ask ATLAS: which liquid-cooled deals ship next quarter?"
              className="h-9 w-full rounded-lg border border-border bg-card pr-3 pl-8 text-sm outline-none focus:border-ring"
            />
          </form>
          <div className="hidden flex-1 sm:block" />
          <button
            aria-label="Toggle theme"
            className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={() => setTheme(resolved === 'dark' ? 'light' : 'dark')}
          >
            {resolved === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
          <CalendarClock className="hidden h-4 w-4 text-muted-foreground sm:block" />
          <span className="hidden text-xs text-muted-foreground sm:block">{new Date().toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}</span>
        </header>
        <main className="mx-auto w-full max-w-[1500px] flex-1 px-4 py-6 md:px-6">
          <View key={page} />
        </main>
      </div>
    </div>
  );
}
