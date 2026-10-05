import { useEffect, useState } from 'react';
import { api, type Json } from '@/api';
import { useSession } from '@/lib/session';
import { Badge, Button, Card, ErrorNote, Field, PageHeader, Spinner, Tabs, useAction, useData } from '@/components/ui';

const SETTINGS: [string, string][] = [
  ['approval.matrix', 'Discount and margin approval matrix'],
  ['cpq.defaults', 'Quote defaults: validity, holds, revalidation, freight'],
  ['compliance.rules', 'Export-control rules (illustrative; Trade Compliance to confirm)'],
  ['capture.rules', 'What the capture agent may read'],
  ['routing.rules', 'Lead routing'],
  ['agents.defaults', 'Agent defaults'],
];

type Tab = 'settings' | 'fields';

export function SettingsPage() {
  const [tab, setTab] = useState<Tab>('settings');
  return (
    <>
      <PageHeader title="Settings" subtitle="Configuration lives in data, not code: approval thresholds, CPQ defaults, compliance rules and custom fields. Only Sales Ops admins can change them." />
      <Tabs<Tab>
        tabs={[
          ['settings', 'Rules'],
          ['fields', 'Custom fields'],
        ]}
        value={tab}
        onChange={setTab}
      />
      <div className="mt-4">{tab === 'settings' ? <Rules /> : <Fields />}</div>
    </>
  );
}

function Rules() {
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      {SETTINGS.map(([key, title]) => (
        <SettingEditor key={key} k={key} title={title} />
      ))}
    </div>
  );
}

function SettingEditor({ k, title }: { k: string; title: string }) {
  const { me } = useSession();
  const isAdmin = me.roles.includes('admin');
  const data = useData(() => api<Json>(`/v1/metadata/settings/${k}`), [k]);
  const [text, setText] = useState('');
  const [saved, setSaved] = useState(false);
  const act = useAction();
  useEffect(() => {
    if (data.data) setText(JSON.stringify(data.data, null, 2));
  }, [data.data]);
  return (
    <Card title={title} action={<code className="text-xs text-muted-foreground">{k}</code>}>
      {!data.data && (data.error ? <ErrorNote error={data.error} /> : <Spinner />)}
      {data.data && (
        <>
          <textarea
            className="h-56 w-full rounded-md border border-border bg-background p-2 font-mono text-xs"
            value={text}
            readOnly={!isAdmin}
            onChange={(e) => {
              setText(e.target.value);
              setSaved(false);
            }}
            spellCheck={false}
          />
          <ErrorNote error={act.error} />
          {isAdmin && (
            <div className="mt-2 flex items-center gap-2">
              <Button
                size="sm"
                busy={act.busy === 'save'}
                onClick={() =>
                  act.run('save', async () => {
                    let body: unknown;
                    try {
                      body = JSON.parse(text);
                    } catch {
                      throw new Error('Not valid JSON');
                    }
                    data.setData(await api<Json>(`/v1/metadata/settings/${k}`, { method: 'PUT', body }));
                    setSaved(true);
                  })
                }
              >
                Save
              </Button>
              {saved && <span className="text-xs text-good">Saved</span>}
            </div>
          )}
        </>
      )}
    </Card>
  );
}

function Fields() {
  const { me } = useSession();
  const isAdmin = me.roles.includes('admin');
  const [object, setObject] = useState('opportunities');
  const objects = useData(() => api<Json[]>('/v1/metadata/objects'), []);
  const fields = useData(() => api<Json[]>(`/v1/metadata/fields?object=${object}`), [object]);
  const act = useAction();
  const [f, setF] = useState({ key: '', label: '', type: 'text', options: '', restricted: false });
  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
      <Card
        title="Custom fields"
        action={
          <select className="h-7 rounded-md border border-border bg-background px-2 text-xs" value={object} onChange={(e) => setObject(e.target.value)} aria-label="Object">
            {(objects.data ?? [{ object: 'opportunities', label: 'Opportunity' }]).map((o) => (
              <option key={o.object} value={o.object}>
                {o.label}
              </option>
            ))}
          </select>
        }
      >
        <ErrorNote error={fields.error} />
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              <th className="py-1 font-medium">Key</th>
              <th className="font-medium">Label</th>
              <th className="font-medium">Type</th>
              <th className="font-medium">Flags</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {(fields.data ?? []).map((x) => (
              <tr key={x.id ?? x.key}>
                <td className="py-1.5 font-mono text-xs">{x.key}</td>
                <td>{x.label}</td>
                <td className="text-xs">
                  {x.type}
                  {x.options?.length ? ` (${x.options.join(', ')})` : ''}
                </td>
                <td className="space-x-1">
                  {x.required && <Badge>required</Badge>}
                  {x.restricted && <Badge tone="warn">restricted</Badge>}
                </td>
              </tr>
            ))}
            {fields.data && !fields.data.length && (
              <tr>
                <td colSpan={4} className="py-4 text-center text-muted-foreground">
                  No custom fields on this object.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
      {isAdmin && (
        <Card title="Add a field">
          <div className="space-y-2">
            <Field label="Key (snake_case)">
              <input className="h-8 rounded-md border border-border bg-background px-2 text-sm" value={f.key} onChange={(e) => setF({ ...f, key: e.target.value })} />
            </Field>
            <Field label="Label">
              <input className="h-8 rounded-md border border-border bg-background px-2 text-sm" value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} />
            </Field>
            <Field label="Type">
              <select className="h-8 rounded-md border border-border bg-background px-2 text-sm" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
                {['text', 'number', 'boolean', 'date', 'enum', 'json'].map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </Field>
            {f.type === 'enum' && (
              <Field label="Options (comma separated)">
                <input className="h-8 rounded-md border border-border bg-background px-2 text-sm" value={f.options} onChange={(e) => setF({ ...f, options: e.target.value })} />
              </Field>
            )}
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={f.restricted} onChange={(e) => setF({ ...f, restricted: e.target.checked })} /> Restricted (finance, deal desk, leadership only)
            </label>
            <ErrorNote error={act.error} />
            <Button
              size="sm"
              disabled={!f.key || !f.label}
              busy={act.busy === 'add'}
              onClick={() =>
                act.run('add', async () => {
                  await api('/v1/metadata/fields', {
                    body: { object, key: f.key, label: f.label, type: f.type, options: f.type === 'enum' ? f.options.split(',').map((s) => s.trim()).filter(Boolean) : [], restricted: f.restricted },
                  });
                  setF({ key: '', label: '', type: 'text', options: '', restricted: false });
                  await fields.reload();
                })
              }
            >
              Add field
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
