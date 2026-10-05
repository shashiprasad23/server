import { useEffect, useState } from 'react';
import { api, hasToken, setToken } from './api';
import { Pipeline } from './pages/Pipeline';
import { Accounts } from './pages/Accounts';
import { Approvals } from './pages/Approvals';
import { Agents } from './pages/Agents';
import { Simulator } from './pages/Simulator';

const USERS = [
  ['asha.rep@uvation.com', 'Asha, Account Executive'],
  ['vp.sales@uvation.com', 'VP Sales'],
  ['dealdesk@uvation.com', 'Deal Desk'],
  ['finance.ops@uvation.com', 'Finance Ops'],
  ['trade.compliance@uvation.com', 'Trade Compliance'],
  ['admin@uvation.com', 'Sales Ops Admin'],
];

const PAGES = { pipeline: 'Pipeline', accounts: 'Accounts', approvals: 'Approvals', agents: 'Agents', simulator: 'Channel simulator' } as const;
type Page = keyof typeof PAGES;

export function App() {
  const [me, setMe] = useState<{ actorId: string; roles: string[] } | null>(null);
  const [page, setPage] = useState<Page>((localStorage.getItem('atlas.page') as Page) || 'pipeline');
  const [pending, setPending] = useState(0);

  useEffect(() => {
    if (hasToken()) api('/v1/auth/me').then(setMe).catch(() => setMe(null));
  }, []);
  useEffect(() => {
    localStorage.setItem('atlas.page', page);
  }, [page]);
  useEffect(() => {
    if (!me) return;
    const load = () => api<any[]>('/v1/approvals').then((a) => setPending(a.length)).catch(() => undefined);
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [me]);

  if (!me) {
    return (
      <div className="signin">
        <h1>ATLAS-I</h1>
        <p className="muted">AI-native sales CRM · development sign-in</p>
        {USERS.map(([email, label]) => (
          <button
            key={email}
            onClick={async () => {
              const r = await api('/v1/auth/dev-token', { body: { email } });
              setToken(r.token);
              setMe(await api('/v1/auth/me'));
            }}
          >
            {label}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="shell">
      <nav>
        <div className="brand">ATLAS-I</div>
        {(Object.keys(PAGES) as Page[]).map((p) => (
          <a key={p} className={page === p ? 'active' : ''} onClick={() => setPage(p)}>
            {PAGES[p]}
            {p === 'approvals' && pending > 0 && <span className="badge">{pending}</span>}
          </a>
        ))}
        <div className="spacer" />
        <div className="muted small">{me.roles.join(', ')}</div>
        <a
          onClick={() => {
            setToken('');
            setMe(null);
          }}
        >
          Sign out
        </a>
      </nav>
      <main>
        {page === 'pipeline' && <Pipeline roles={me.roles} />}
        {page === 'accounts' && <Accounts />}
        {page === 'approvals' && <Approvals onChange={(n) => setPending(n)} />}
        {page === 'agents' && <Agents roles={me.roles} />}
        {page === 'simulator' && <Simulator />}
      </main>
    </div>
  );
}
