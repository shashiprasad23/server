import type { Role } from '../common/principal';

export type FieldType = 'string' | 'text' | 'int' | 'number' | 'boolean' | 'date' | 'datetime' | 'uuid' | 'json' | 'enum';

export interface FieldSpec {
  type: FieldType;
  values?: readonly string[];
  required?: boolean;
  /** Not writable through the API (system-managed). */
  readOnly?: boolean;
  /** Only these roles (plus admin, system and integrations) may write this field. */
  writeRoles?: readonly Role[];
  /** Hidden from roles not listed in RESTRICTED_READERS (field-level security). */
  restricted?: boolean;
  /** Agents may never write this field, regardless of their scope. */
  humanOnly?: boolean;
}

export interface RecordType {
  object: ObjectName;
  table: string;
  label: string;
  fields: Record<string, FieldSpec>;
  /** Columns used by ?q= search. */
  searchable: string[];
}

export const OBJECTS = ['accounts', 'contacts', 'leads', 'opportunities', 'activities'] as const;
export type ObjectName = (typeof OBJECTS)[number];

/** Roles that may read restricted fields such as cost and margin. */
export const RESTRICTED_READERS: readonly Role[] = ['admin', 'sales_leader', 'deal_desk', 'finance'];

export const COMPLIANCE_STATUSES = ['not_screened', 'screening', 'flagged', 'cleared', 'blocked'] as const;
export const OPPORTUNITY_TYPES = ['hardware', 'service', 'renewal', 'expansion'] as const;
export const CHANNELS = ['marketplace', 'usp', 'rep', 'partner', 'outlook', 'teams', 'web', 'whatsapp', 'other'] as const;

export const RECORD_TYPES: Record<ObjectName, RecordType> = {
  accounts: {
    object: 'accounts',
    table: 'accounts',
    label: 'Account',
    searchable: ['name', 'domain'],
    fields: {
      name: { type: 'string', required: true },
      domain: { type: 'string' },
      industry: { type: 'string' },
      segment: { type: 'enum', values: ['enterprise', 'ai_native', 'gpu_cloud', 'research', 'public_sector', 'reseller', 'smb'] },
      hq_country: { type: 'string' },
      owner_id: { type: 'uuid' },
      channel_first_seen: { type: 'enum', values: CHANNELS },
      // NetSuite references only (FR-NS-05): editable by Finance until the adapter is live.
      netsuite_customer_id: { type: 'string', writeRoles: ['finance'], humanOnly: true },
      credit_hold: { type: 'boolean', writeRoles: ['finance'], humanOnly: true },
    },
  },
  contacts: {
    object: 'contacts',
    table: 'contacts',
    label: 'Contact',
    searchable: ['name', 'email'],
    fields: {
      account_id: { type: 'uuid' },
      name: { type: 'string' },
      email: { type: 'string' },
      phone: { type: 'string' },
      title: { type: 'string' },
      committee_role: {
        type: 'enum',
        values: ['economic_buyer', 'ml_lead', 'it_infrastructure', 'facilities', 'procurement', 'security', 'champion', 'other'],
      },
      consent_status: { type: 'enum', values: ['unknown', 'opted_in', 'opted_out'] },
      marketplace_user_id: { type: 'string' },
      usp_user_id: { type: 'string' },
    },
  },
  leads: {
    object: 'leads',
    table: 'leads',
    label: 'Lead',
    searchable: ['summary', 'source'],
    fields: {
      account_id: { type: 'uuid' },
      contact_id: { type: 'uuid' },
      opportunity_id: { type: 'uuid' },
      channel: { type: 'enum', values: CHANNELS, required: true },
      source: { type: 'string' },
      status: { type: 'enum', values: ['new', 'qualified', 'nurture', 'disqualified', 'converted'] },
      fit_score: { type: 'int' },
      intent_score: { type: 'int' },
      score_reasons: { type: 'json' },
      routed_to: { type: 'uuid' },
      summary: { type: 'text' },
    },
  },
  opportunities: {
    object: 'opportunities',
    table: 'opportunities',
    label: 'Opportunity',
    searchable: ['name', 'gpu_model', 'end_user'],
    fields: {
      account_id: { type: 'uuid' },
      primary_contact_id: { type: 'uuid' },
      name: { type: 'string', required: true },
      type: { type: 'enum', values: OPPORTUNITY_TYPES },
      channel: { type: 'enum', values: CHANNELS },
      stage_key: { type: 'string' },
      owner_id: { type: 'uuid' },
      workload: { type: 'enum', values: ['training', 'fine_tuning', 'inference', 'hpc', 'mixed', 'unknown'] },
      gpu_model: { type: 'string' },
      gpu_count: { type: 'int' },
      node_count: { type: 'int' },
      oem: { type: 'string' },
      expected_value: { type: 'number' },
      est_margin: { type: 'number', restricted: true, writeRoles: ['deal_desk', 'sales_leader'] },
      recurring_value: { type: 'number' },
      currency: { type: 'string' },
      quote_valid_until: { type: 'date' },
      expected_po_date: { type: 'date' },
      expected_ship_date: { type: 'date' },
      deployment_location: { type: 'enum', values: ['customer_site', 'colocation', 'uvation_hosted', 'unknown'] },
      kw_per_rack: { type: 'number' },
      cooling: { type: 'enum', values: ['air', 'liquid', 'rear_door', 'unknown'] },
      end_user: { type: 'string' },
      destination_country: { type: 'string' },
      // Only Trade Compliance clears; agents never touch it (FR-CMP-04).
      compliance_status: { type: 'enum', values: COMPLIANCE_STATUSES, writeRoles: ['trade_compliance'], humanOnly: true },
      order_reference: { type: 'string', writeRoles: ['finance'], humanOnly: true },
      netsuite_sales_order_id: { type: 'string', writeRoles: ['finance'], humanOnly: true },
      netsuite_status: {
        type: 'enum',
        values: ['open', 'fulfilled', 'billed', 'paid', 'overdue', 'settled'],
        writeRoles: ['finance'],
        humanOnly: true,
      },
      probability: { type: 'int' },
      ai_probability: { type: 'int' },
      risk_score: { type: 'int' },
      lost_reason: { type: 'string' },
      closed_at: { type: 'datetime', readOnly: true },
    },
  },
  activities: {
    object: 'activities',
    table: 'activities',
    label: 'Activity',
    searchable: ['subject', 'body'],
    fields: {
      account_id: { type: 'uuid' },
      contact_id: { type: 'uuid' },
      opportunity_id: { type: 'uuid' },
      type: { type: 'enum', values: ['email', 'meeting', 'call', 'chat', 'note', 'ticket', 'cart', 'web', 'order', 'service_request'], required: true },
      source: { type: 'string', required: true },
      direction: { type: 'enum', values: ['inbound', 'outbound', 'internal'] },
      subject: { type: 'string' },
      body: { type: 'text' },
      occurred_at: { type: 'datetime' },
      participants: { type: 'json' },
      thread_id: { type: 'string' },
      channel_event_id: { type: 'uuid', readOnly: true },
      extracted: { type: 'json' },
    },
  },
};

export function recordType(object: string): RecordType | undefined {
  return (RECORD_TYPES as Record<string, RecordType>)[object];
}
