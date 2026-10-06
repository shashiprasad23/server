export const ROLES = [
  'admin',
  'sales_leader',
  'rep',
  'presales',
  'deal_desk',
  'procurement',
  'finance',
  'trade_compliance',
  'agent',
  'integration',
] as const;
export type Role = (typeof ROLES)[number];

/** Who is acting. Agents and integrations get their own identities, separate from humans (FR-AI-01). */
export interface Principal {
  tenantId: string;
  kind: 'user' | 'agent' | 'integration' | 'system';
  /** user id for humans, agent id for agents, source name for integrations */
  actorId: string;
  roles: Role[];
}

export const hasRole = (p: Principal, ...roles: Role[]) => p.roles.includes('admin') || roles.some((r) => p.roles.includes(r));

export const systemPrincipal = (tenantId: string): Principal => ({
  tenantId,
  kind: 'system',
  actorId: 'system',
  roles: ['admin'],
});
