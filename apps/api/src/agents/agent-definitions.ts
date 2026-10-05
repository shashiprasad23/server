import type { ObjectName } from '../records/record-types';
import type { Role } from '../common/principal';

export type Reversibility = 'reversible' | 'compensable' | 'binding' | 'irreversible';

export type ActionType = 'update_fields' | 'create_record' | 'create_task' | 'send_email' | 'submit_quote' | 'clear_compliance';

/** FR-AI-02: every action type has a fixed reversibility class that decides how it is routed. */
export const ACTION_REVERSIBILITY: Record<ActionType, Reversibility> = {
  update_fields: 'reversible',
  create_record: 'reversible',
  create_task: 'reversible',
  send_email: 'compensable',
  submit_quote: 'binding',
  clear_compliance: 'irreversible',
};

/** Actions no agent may ever take, whatever its scope (regulated, human-only decisions). */
export const HUMAN_ONLY_ACTIONS: ReadonlySet<ActionType> = new Set(['clear_compliance']);

export interface AgentDefinition {
  id: string;
  name: string;
  description: string;
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
];

export function agentDefinition(id: string): AgentDefinition | undefined {
  return AGENTS.find((a) => a.id === id);
}
