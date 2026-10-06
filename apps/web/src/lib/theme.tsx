import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

type Theme = 'light' | 'dark' | 'system';
interface ThemeState {
  theme: Theme;
  systemTheme: 'light' | 'dark';
  resolved: 'light' | 'dark';
  setTheme: (t: Theme) => void;
}

const Ctx = createContext<ThemeState | null>(null);
const read = (): Theme => {
  try {
    return (localStorage.getItem('atlas.theme') as Theme) || 'system';
  } catch {
    return 'system';
  }
};

/** Light / dark / system theme with a class on <html>, used by Tailwind's dark variant and Magic UI. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(read);
  const mq = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  const [systemTheme, setSystem] = useState<'light' | 'dark'>(mq?.matches ? 'dark' : 'light');
  useEffect(() => {
    if (!mq) return;
    const on = () => setSystem(mq.matches ? 'dark' : 'light');
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [mq]);
  const resolved = theme === 'system' ? systemTheme : theme;
  useEffect(() => {
    document.documentElement.classList.toggle('dark', resolved === 'dark');
    document.documentElement.dataset.theme = resolved;
  }, [resolved]);
  const setTheme = (t: Theme) => {
    setThemeState(t);
    try {
      localStorage.setItem('atlas.theme', t);
    } catch {
      /* storage unavailable */
    }
  };
  return <Ctx.Provider value={{ theme, systemTheme, resolved, setTheme }}>{children}</Ctx.Provider>;
}

export function useTheme(): ThemeState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useTheme outside ThemeProvider');
  return v;
}
