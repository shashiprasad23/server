import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

export interface Me {
  actorId: string;
  roles: string[];
  tenantId: string;
}

export const PAGES = [
  'home',
  'pipeline',
  'ask',
  'accounts',
  'quotes',
  'supply',
  'compliance',
  'forecast',
  'renewals',
  'approvals',
  'tasks',
  'agents',
  'simulator',
  'settings',
] as const;
export type Page = (typeof PAGES)[number];

interface Session {
  me: Me;
  has: (...roles: string[]) => boolean;
  page: Page;
  params: URLSearchParams;
  go: (page: Page, params?: Record<string, string>) => void;
  openDeal: (id: string) => void;
  /** Bumped whenever something changes data other views show (drawer saves, approvals). */
  version: number;
  touch: () => void;
}

const Ctx = createContext<Session | null>(null);

function parseHash(): { page: Page; params: URLSearchParams } {
  const [path, query] = window.location.hash.replace(/^#\/?/, '').split('?');
  const page = (PAGES as readonly string[]).includes(path) ? (path as Page) : 'home';
  return { page, params: new URLSearchParams(query ?? '') };
}

export function SessionProvider({ me, children, onDeal }: { me: Me; children: ReactNode; onDeal: (id: string) => void }) {
  const [route, setRoute] = useState(parseHash);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const f = () => setRoute(parseHash());
    window.addEventListener('hashchange', f);
    return () => window.removeEventListener('hashchange', f);
  }, []);
  const go = useCallback((page: Page, params?: Record<string, string>) => {
    const q = params ? new URLSearchParams(params).toString() : '';
    window.location.hash = `/${page}${q ? `?${q}` : ''}`;
  }, []);
  const has = useCallback((...roles: string[]) => roles.some((r) => me.roles.includes(r)) || me.roles.includes('admin'), [me]);
  const touch = useCallback(() => setVersion((v) => v + 1), []);
  return <Ctx.Provider value={{ me, has, page: route.page, params: route.params, go, openDeal: onDeal, version, touch }}>{children}</Ctx.Provider>;
}

export function useSession() {
  const s = useContext(Ctx);
  if (!s) throw new Error('useSession outside SessionProvider');
  return s;
}
