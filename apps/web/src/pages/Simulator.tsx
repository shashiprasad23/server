import { useState } from 'react';
import { Mail, MessagesSquare, Radio, ShoppingCart, Store, Wrench } from 'lucide-react';
import { ApiError, api, type Json } from '@/api';
import { useSession } from '@/lib/session';
import { AnimatedList } from '@/components/magicui/animated-list';
import { ShimmerButton } from '@/components/magicui/shimmer-button';
import { Badge, Button, Card, ErrorNote, PageHeader, useAction } from '@/components/ui';

const id = (p: string) => `${p}-${Date.now()}`;
const now = () => new Date().toISOString();

/** Sample payloads that follow the event contracts in apps/api/src/ingestion/normalizers. */
const SAMPLES: Record<string, { source: string; label: string; build: () => unknown }> = {
  rfq: {
    source: 'marketplace',
    label: 'Marketplace RFQ',
    build: () => ({
      event_id: id('mp'),
      type: 'rfq',
      occurred_at: now(),
      customer: { email: 'priya@nimbus-ai.com', name: 'Priya Shah', company: 'Nimbus AI', user_id: 'mp-priya' },
      data: { message: 'Please quote 64 H200 GPUs (8 nodes, Supermicro) for LLM training. Liquid cooling at our own datacentre in India, needed by Q1 2027.' },
    }),
  },
  cart: {
    source: 'marketplace',
    label: 'Abandoned Marketplace cart',
    build: () => ({
      event_id: id('mp'),
      type: 'cart_abandoned',
      occurred_at: now(),
      customer: { email: 'ops@kestrel-compute.com', name: 'Dev Patel', company: 'Kestrel Compute', user_id: 'mp-dev' },
      data: { cart_value: 310000, items: [{ sku: 'SYS-821GE', name: 'HGX B200 8-GPU server', qty: 4 }] },
    }),
  },
  order: {
    source: 'marketplace',
    label: 'Marketplace order',
    build: () => ({
      event_id: id('mp'),
      type: 'order_placed',
      occurred_at: now(),
      customer: { email: 'buyer@zephyr-ai.com', name: 'Mia Chen', company: 'Zephyr AI', user_id: 'mp-mia' },
      data: { order_reference: `MP-ORD-${Date.now() % 100000}`, gpu_model: 'L40S', gpu_count: 8, ship_to_country: 'Singapore' },
    }),
  },
  service: {
    source: 'usp',
    label: 'USP service request',
    build: () => ({
      event_id: id('usp'),
      type: 'service_request',
      occurred_at: now(),
      customer: { email: 'it@helios.edu', name: 'Sam Lee', company: 'Helios Research', user_id: 'usp-sam' },
      data: { service_type: 'Rack and stack', subject: 'Install 2 GB200 NVL72 racks', description: 'Need rack and stack plus cluster validation for 2 GB200 NVL72 racks at our colocation site.' },
    }),
  },
  email: {
    source: 'outlook',
    label: 'Customer email (Outlook)',
    build: () => ({
      kind: 'message',
      id: id('graph'),
      conversationId: 'conv-nimbus',
      mailbox: 'asha.rep@uvation.com',
      subject: 'Re: H200 cluster',
      body: { contentType: 'text', content: 'Thanks Asha. We may grow to 128 GPUs and 16 nodes, and we can do 40 kW per rack. Could Dell be an option?' },
      from: { emailAddress: { address: 'priya@nimbus-ai.com', name: 'Priya Shah' } },
      toRecipients: [{ emailAddress: { address: 'asha.rep@uvation.com' } }],
      sentDateTime: now(),
    }),
  },
  teams: {
    source: 'teams',
    label: 'Teams meeting transcript',
    build: () => ({
      kind: 'meeting_transcript',
      id: id('teams'),
      chatType: 'external',
      subject: 'Nimbus AI discovery call',
      from: { email: 'priya@nimbus-ai.com', name: 'Priya Shah' },
      participants: [{ email: 'asha.rep@uvation.com', name: 'Asha' }, { email: 'cto@nimbus-ai.com', name: 'Ravi Kumar' }],
      body: 'Priya: our workload is mostly training. Ravi: we prefer direct liquid cooling and shipping to India.',
      createdDateTime: now(),
    }),
  },
  redflag: {
    source: 'outlook',
    label: 'Red-flag email (compliance)',
    build: () => ({
      kind: 'message',
      id: id('graph'),
      conversationId: 'conv-nimbus',
      mailbox: 'asha.rep@uvation.com',
      subject: 'Re: H200 cluster shipping',
      body: { contentType: 'text', content: 'Small change: the end user is confidential and our freight forwarder will handle onward shipping.' },
      from: { emailAddress: { address: 'priya@nimbus-ai.com', name: 'Priya Shah' } },
      toRecipients: [{ emailAddress: { address: 'asha.rep@uvation.com' } }],
      sentDateTime: now(),
    }),
  },
  internal: {
    source: 'outlook',
    label: 'Internal-only email (skipped)',
    build: () => ({
      kind: 'message',
      id: id('graph'),
      mailbox: 'asha.rep@uvation.com',
      subject: 'Lunch?',
      body: { contentType: 'text', content: 'Internal only.' },
      from: { emailAddress: { address: 'marco.rep@uvation.com' } },
      toRecipients: [{ emailAddress: { address: 'asha.rep@uvation.com' } }],
      sentDateTime: now(),
    }),
  },
};

const ICONS: Record<string, typeof Store> = { rfq: Store, cart: ShoppingCart, order: Store, service: Wrench, email: Mail, teams: MessagesSquare, redflag: Mail, internal: Mail };

export function Simulator() {
  const { has, touch } = useSession();
  const [log, setLog] = useState<{ at: string; label: string; status: string; detail: string }[]>([]);
  const act = useAction();
  const send = async (key: string) => {
    const s = SAMPLES[key];
    try {
      const r = await api<Json>(`/v1/channel-events/dev/simulate/${s.source}`, { body: s.build() });
      setLog((l) => [{ at: new Date().toLocaleTimeString(), label: s.label, status: r.status, detail: r.skipReason ?? Object.keys(r.linked ?? {}).map((k) => `linked ${k}`).join(', ') }, ...l]);
      touch();
    } catch (e) {
      setLog((l) => [{ at: new Date().toLocaleTimeString(), label: s.label, status: 'failed', detail: (e as ApiError).message }, ...l]);
    }
  };
  return (
    <>
      <PageHeader
        title="Channel simulator"
        subtitle="Development only: inject events exactly as the Uvation Marketplace, the Service Portal, Outlook and Teams would send them. Agents react within a second; watch Home, Pipeline and Approvals."
        actions={
          has('sales_leader') && (
            <ShimmerButton
              className="h-9 px-4 text-sm"
              onClick={() =>
                act.run('demo', async () => {
                  const r = await api<Json>('/v1/dev/demo-data', { body: {} });
                  setLog((l) => [{ at: new Date().toLocaleTimeString(), label: 'Demo pipeline', status: r.loaded ? 'processed' : 'skipped', detail: r.reason ?? `${r.opportunities} opportunities` }, ...l]);
                  touch();
                })
              }
            >
              {act.busy ? 'Loading…' : 'Load demo pipeline'}
            </ShimmerButton>
          )
        }
      />
      <ErrorNote error={act.error} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Send an event">
          <div className="grid gap-2 sm:grid-cols-2">
            {Object.entries(SAMPLES).map(([k, s]) => {
              const Icon = ICONS[k] ?? Radio;
              return (
                <Button key={k} variant="secondary" className="h-auto justify-start py-2 text-left" onClick={() => send(k)}>
                  <Icon className="h-4 w-4 shrink-0 text-primary" />
                  <span>
                    <span className="block">{s.label}</span>
                    <span className="block text-[11px] font-normal text-muted-foreground">via {s.source}</span>
                  </span>
                </Button>
              );
            })}
          </div>
        </Card>
        <Card title="What happened">
          {!log.length && <p className="text-sm text-muted-foreground">Events you send appear here.</p>}
          <AnimatedList delay={50}>
            {[...log].reverse().map((l, i) => (
              <div key={i} className="rounded-lg border border-border bg-background p-2 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{l.label}</span>
                  <Badge>{l.status}</Badge>
                </div>
                <div className="text-xs text-muted-foreground">
                  {l.at} · {l.detail || 'accepted'}
                </div>
              </div>
            ))}
          </AnimatedList>
        </Card>
      </div>
    </>
  );
}
