import { useEffect, useRef, useState } from 'react';
import { Send, Sparkles } from 'lucide-react';
import { api, compactMoney, label, type Json } from '@/api';
import { useSession } from '@/lib/session';
import { AnimatedShinyText } from '@/components/magicui/animated-shiny-text';
import { BlurFade } from '@/components/magicui/blur-fade';
import { Button, Card, ErrorNote, PageHeader, useAction } from '@/components/ui';

const EXAMPLES = [
  'Which open deals need liquid cooling?',
  'Which deals are at risk?',
  'Show B200 deals',
  'Deals shipping in 2026-Q4 with more than 32 GPUs',
  'Marketplace deals over $1M',
  'Which deals are flagged by compliance?',
];

export function Ask() {
  const { params, openDeal } = useSession();
  const [q, setQ] = useState(params.get('q') ?? '');
  const [answers, setAnswers] = useState<Json[]>([]);
  const act = useAction();

  const ask = (question: string) =>
    act.run('ask', async () => {
      const r = await api<Json>('/v1/ask', { body: { question } });
      setAnswers((a) => [r, ...a]);
    });

  const asked = useRef<string | null>(null);
  useEffect(() => {
    const initial = params.get('q');
    if (initial && asked.current !== initial) {
      asked.current = initial;
      setQ(initial);
      ask(initial);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.get('q')]);

  return (
    <>
      <PageHeader
        title="Ask ATLAS"
        subtitle="Questions in plain English become a filter over the live pipeline. Every answer cites the deals it used, and shows how the question was read."
      />
      <Card>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (q.trim().length >= 3) ask(q.trim());
          }}
        >
          <input className="h-10 flex-1 rounded-lg border border-border bg-background px-3 text-sm" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask about the pipeline…" autoFocus />
          <Button className="h-10" busy={act.busy === 'ask'}>
            <Send className="h-4 w-4" /> Ask
          </Button>
        </form>
        <div className="mt-3 flex flex-wrap gap-2">
          {EXAMPLES.map((e) => (
            <button
              key={e}
              className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground hover:border-primary hover:text-foreground"
              onClick={() => {
                setQ(e);
                ask(e);
              }}
            >
              {e}
            </button>
          ))}
        </div>
        <ErrorNote error={act.error} />
      </Card>

      <div className="mt-4 space-y-4">
        {answers.map((a, i) => (
          <BlurFade key={answers.length - i} delay={0.05}>
            <Card>
              <div className="text-xs text-muted-foreground">You asked</div>
              <div className="font-medium">{a.question}</div>
              <div className="mt-3 flex items-start gap-2">
                <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <div>
                  <AnimatedShinyText className="mx-0 text-sm text-foreground">{a.answer}</AnimatedShinyText>
                  <div className="mt-1 text-xs text-muted-foreground">
                    Read as:{' '}
                    {Object.entries(a.filter as Json)
                      .filter(([, v]) => v != null)
                      .map(([k, v]) => `${label(k)} = ${Array.isArray(v) ? v.join('/') : String(v)}`)
                      .join(' · ') || 'all open deals'}{' '}
                    ({a.interpretedBy === 'rules' ? 'rule-based parser' : 'Claude'})
                  </div>
                </div>
              </div>
              {a.citations?.length > 0 && (
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-left text-xs text-muted-foreground">
                      <tr>
                        <th className="py-1 font-medium">Deal</th>
                        <th className="font-medium">Stage</th>
                        <th className="font-medium">GPUs</th>
                        <th className="font-medium">Ships</th>
                        <th className="text-right font-medium">Value</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {a.citations.map((c: Json) => (
                        <tr key={c.id} className="cursor-pointer hover:bg-muted" onClick={() => openDeal(c.id)}>
                          <td className="py-1.5 text-primary">{c.name}</td>
                          <td>{label(c.stage)}</td>
                          <td>{c.gpu ?? '—'}</td>
                          <td>{c.ship ?? '—'}</td>
                          <td className="text-right tabular-nums">{compactMoney(c.value)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </BlurFade>
        ))}
      </div>
    </>
  );
}
