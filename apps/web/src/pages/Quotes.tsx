import { useState } from 'react';
import { api, type Json } from '@/api';
import { useSession } from '@/lib/session';
import { QuoteCard } from '@/components/deal/QuoteTab';
import { Empty, ErrorNote, PageHeader, Spinner, Tabs, useData } from '@/components/ui';

type Filter = 'live' | 'pending_approval' | 'sent' | 'all';

export function Quotes() {
  const { version, touch } = useSession();
  const [filter, setFilter] = useState<Filter>('live');
  const quotes = useData(() => api<Json[]>(`/v1/quotes${filter === 'pending_approval' || filter === 'sent' ? `?status=${filter}` : ''}`), [filter, version]);
  const items = (quotes.data ?? []).filter((q) => filter !== 'live' || !['superseded', 'withdrawn', 'expired', 'rejected'].includes(q.status));
  return (
    <>
      <PageHeader title="Quotes" subtitle="Configured, priced and checked against the approval matrix. Margin and cost are visible only to deal desk, finance and sales leadership." />
      <Tabs<Filter>
        tabs={[
          ['live', 'Live'],
          ['pending_approval', 'Waiting approval'],
          ['sent', 'With customer'],
          ['all', 'All versions'],
        ]}
        value={filter}
        onChange={setFilter}
      />
      <ErrorNote error={quotes.error} />
      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        {quotes.loading && !quotes.data && <Spinner />}
        {quotes.data && !items.length && <Empty>No quotes here.</Empty>}
        {items.map((q) => (
          <QuoteCard
            key={q.id}
            q={q}
            showDeal
            onChanged={async () => {
              await quotes.reload();
              touch();
            }}
          />
        ))}
      </div>
    </>
  );
}
