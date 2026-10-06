import type { ObjectName } from '../records/record-types';
import type { Role } from '../common/principal';

export type Reversibility = 'reversible' | 'compensable' | 'binding' | 'irreversible';

export type ActionType =
  | 'update_fields'
  | 'create_record'
  | 'create_task'
  | 'send_email'
  | 'draft_quote'
  | 'draft_deal_registration'
  | 'submit_quote'
  | 'clear_compliance';

/** FR-AI-02: every action type has a fixed reversibility class that decides how it is routed. */
export const ACTION_REVERSIBILITY: Record<ActionType, Reversibility> = {
  update_fields: 'reversible',
  create_record: 'reversible',
  create_task: 'reversible',
  send_email: 'compensable',
  draft_quote: 'reversible',
  draft_deal_registration: 'reversible',
  submit_quote: 'binding',
  clear_compliance: 'irreversible',
};

/** Actions no agent may ever take, whatever its scope (regulated, human-only decisions). */
export const HUMAN_ONLY_ACTIONS: ReadonlySet<ActionType> = new Set(['clear_compliance']);

export interface AgentDefinition {
  id: string;
  name: string;
  description: string;
  /** Action types this agent may propose; anything else is blocked as out of scope. */
  allowedActions: ActionType[];
  /** Fields the agent may write, per object. "custom.*" allows any custom field. */
  writableFields: Partial<Record<ObjectName, string[]>>;
  /** Objects the agent may create. */
  creatable: ObjectName[];
  /** Outbound channels and the approved templates it may use. */
  channels: ('email' | 'teams' | 'whatsapp')[];
  templates: string[];
  dailyActionCap: number;
  confidenceThreshold: number;
  /** 'approval': every outbound message waits for a person (default for the first 30 days). */
  outboundMode: 'approval' | 'autonomous';
  /** Who reviews this agent's queued actions. */
  reviewerRole: Role;
}

/** Overrides an admin can store in agent_settings.overrides without a deploy. */
export type AgentOverrides = Partial<Pick<AgentDefinition, 'dailyActionCap' | 'confidenceThreshold' | 'outboundMode' | 'templates'>>;

const SIGNAL_FIELDS = [
  'workload',
  'gpu_model',
  'gpu_count',
  'node_count',
  'oem',
  'deployment_location',
  'cooling',
  'kw_per_rack',
  'destination_country',
];

export const AGENTS: AgentDefinition[] = [
  {
    id: 'capture',
    name: 'Capture agent',
    description: 'Reads captured emails, chats, calls and meeting transcripts and fills opportunity fields with cited evidence.',
    allowedActions: ['update_fields'],
    writableFields: { opportunities: SIGNAL_FIELDS, activities: ['extracted'] },
    creatable: [],
    channels: [],
    templates: [],
    dailyActionCap: 5000,
    confidenceThreshold: 0.65,
    outboundMode: 'approval',
    reviewerRole: 'rep',
  },
  {
    id: 'inbound_sdr',
    name: 'Inbound SDR agent',
    description: 'Scores and routes every new lead within minutes, drafts the first reply with qualifying questions, and hands assisted deals to a rep.',
    allowedActions: ['update_fields', 'send_email', 'create_task'],
    writableFields: {
      leads: ['fit_score', 'intent_score', 'score_reasons', 'status', 'routed_to', 'summary'],
      opportunities: [...SIGNAL_FIELDS, 'owner_id'],
    },
    creatable: [],
    channels: ['email'],
    templates: ['rfq_acknowledgement', 'qualifying_questions'],
    dailyActionCap: 2000,
    confidenceThreshold: 0.7,
    outboundMode: 'approval',
    reviewerRole: 'rep',
  },
  {
    id: 'deal_coach',
    name: 'Deal coach agent',
    description: 'Scores deal risk and win probability from activity, supply, compliance and quote status, and explains every point.',
    allowedActions: ['update_fields'],
    writableFields: { opportunities: ['risk_score', 'risk_reasons', 'ai_probability'], accounts: ['health_score', 'health_reasons'] },
    creatable: [],
    channels: [],
    templates: [],
    dailyActionCap: 20000,
    confidenceThreshold: 0.6,
    outboundMode: 'approval',
    reviewerRole: 'sales_leader',
  },
  {
    id: 'quote_agent',
    name: 'Configure and quote agent',
    description: 'Builds a valid BOM from the requirement sheet, checks supply, drafts the OEM deal registration and a quote for the rep to review.',
    allowedActions: ['draft_quote', 'draft_deal_registration', 'create_task'],
    writableFields: {},
    creatable: [],
    channels: [],
    templates: [],
    dailyActionCap: 1000,
    confidenceThreshold: 0.7,
    outboundMode: 'approval',
    reviewerRole: 'presales',
  },
  {
    id: 'renewal_agent',
    name: 'Renewal and expansion agent',
    description: 'Opens renewal opportunities 120 days before support or licence end, and flags refresh and expansion opportunities from the installed base.',
    allowedActions: ['create_record', 'create_task'],
    writableFields: {},
    creatable: ['opportunities'],
    channels: [],
    templates: [],
    dailyActionCap: 1000,
    confidenceThreshold: 0.7,
    outboundMode: 'approval',
    reviewerRole: 'rep',
  },
];

export function agentDefinition(id: string): AgentDefinition | undefined {
  return AGENTS.find((a) => a.id === id);
}
