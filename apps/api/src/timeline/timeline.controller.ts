import { Controller, Get, Param, Query } from '@nestjs/common';
import { DbService, many } from '../db/db.service';
import { CurrentPrincipal } from '../auth/auth.guard';
import { Principal } from '../common/principal';
import { RecordsService } from '../records/records.service';

/** One customer timeline across portals, email, Teams, calls, WhatsApp and agent actions. */
@Controller('v1/timeline')
export class TimelineController {
  constructor(
    private readonly db: DbService,
    private readonly records: RecordsService,
  ) {}

  @Get('accounts/:id')
  account(@CurrentPrincipal() p: Principal, @Param('id') id: string, @Query('limit') limit?: string) {
    const n = Math.min(Number(limit) || 100, 500);
    return this.db.tx(p.tenantId, async (db) => {
      const account = await this.records.get(db, p, 'accounts', id);
      const items = await many(
        db,
        `SELECT * FROM (
           SELECT 'activity' AS kind, a.id, a.type AS subtype, a.source, a.direction, a.subject AS title,
                  left(a.body, 500) AS detail, a.occurred_at AS at, a.opportunity_id, a.extracted AS meta
             FROM activities a WHERE a.account_id = $1 AND a.deleted_at IS NULL
           UNION ALL
           SELECT 'agent_action', aa.id, aa.action_type, aa.agent_id, aa.decision, aa.payload->>'summary',
                  aa.reason, aa.created_at, NULL, jsonb_build_object('confidence', aa.confidence, 'evidence', aa.evidence)
             FROM agent_actions aa
            WHERE aa.target_id IN (SELECT id FROM opportunities WHERE account_id = $1
                                   UNION SELECT id FROM leads WHERE account_id = $1
                                   UNION SELECT id FROM activities WHERE account_id = $1)
           UNION ALL
           SELECT 'opportunity', o.id, o.type, o.channel, o.stage_key, o.name, NULL, o.created_at, o.id, NULL
             FROM opportunities o WHERE o.account_id = $1 AND o.deleted_at IS NULL
         ) t ORDER BY at DESC LIMIT ${n}`,
        [id],
      );
      return { account, items };
    });
  }

  @Get('tasks')
  tasks(@CurrentPrincipal() p: Principal, @Query('status') status = 'open') {
    return this.db.tx(p.tenantId, (db) =>
      many(
        db,
        `SELECT * FROM tasks WHERE status = $1 AND (assignee_id::text = $2 OR assignee_role = ANY($3::text[]) OR $4)
          ORDER BY created_at DESC LIMIT 200`,
        [status, p.actorId, p.roles, p.roles.includes('admin') || p.roles.includes('sales_leader')],
      ),
    );
  }
}
