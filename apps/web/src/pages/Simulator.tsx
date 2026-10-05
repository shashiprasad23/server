import { useState } from 'react';
import { ApiError, api } from '../api';

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

export function Simulator() {
  const [log, setLog] = useState<string[]>([]);
  const send = async (key: string) => {
    const s = SAMPLES[key];
    try {
      const r = await api(`/v1/channel-events/dev/simulate/${s.source}`, { body: s.build() });
      setLog((l) => [`${s.label}: ${r.status}${r.skipReason ? ` (${r.skipReason})` : ''} ${JSON.stringify(r.linked ?? {})}`, ...l]);
    } catch (e) {
      setLog((l) => [`${s.label}: ${(e as ApiError).message}`, ...l]);
    }
  };
  return (
    <>
      <header>
        <h2>Channel simulator</h2>
        <span className="muted">Development only: inject events as if they came from the Marketplace, USP, Outlook or Teams.</span>
      </header>
      <div className="row wrap">
        {Object.entries(SAMPLES).map(([k, s]) => (
          <button key={k} onClick={() => send(k)}>
            {s.label}
          </button>
        ))}
      </div>
      <pre className="email">{log.join('\n') || 'Events you send appear here. Agents react within a second.'}</pre>
    </>
  );
}
