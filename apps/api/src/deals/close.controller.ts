import { Body, Controller, Inject, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { DbService, one } from '../db/db.service';
import { CurrentPrincipal, Roles } from '../auth/auth.guard';
import { Principal } from '../common/principal';
import { validate } from '../common/validate';
import { unprocessable } from '../common/errors';
import { RecordsService } from '../records/records.service';
import { FINANCE_SYSTEM, FinanceSystemAdapter } from '../adapters/finance-system.adapter';
import { EventBus } from '../events/event-bus';

/**
 * NetSuite-ready close flow (FR-NS-04). With the adapter connected the sales order is created
 * automatically; until then Finance enters it in NetSuite and records the sales order ID here.
 * Either way the deal is Closed won only once a NetSuite reference exists and compliance is cleared.
 */
@Controller('v1/opportunities')
export class CloseController {
  constructor(
    private readonly db: DbService,
    private readonly records: RecordsService,
    private readonly events: EventBus,
    @Inject(FINANCE_SYSTEM) private readonly finance: FinanceSystemAdapter,
  ) {}

  @Post(':id/close-request')
  @Roles('rep', 'sales_leader')
  requestClose(@CurrentPrincipal() p: Principal, @Param('id') id: string, @Body() body: unknown) {
    const input = validate(z.object({ customer_po_reference: z.string().min(1).max(100), quote_id: z.string().min(1).max(100) }), body);
    return this.db.tx(p.tenantId, async (db) => {
      const opp = await this.records.get(db, p, 'opportunities', id);
      if (opp.compliance_status !== 'cleared') {
        throw unprocessable('compliance_not_cleared', 'Trade Compliance must clear this deal before it is handed to NetSuite');
      }
      if (this.finance.connected) {
        const account = opp.account_id ? await this.records.getRaw(db, 'accounts', String(opp.account_id)) : undefined;
        const so = await this.finance.createSalesOrder({
          opportunityId: id,
          accountId: String(opp.account_id),
          netsuiteCustomerId: (account?.netsuite_customer_id as string) ?? null,
          customerPoReference: input.customer_po_reference,
          quoteId: input.quote_id,
        });
        if (so) {
          const { record } = await this.records.update(db, { ...p, kind: 'integration', actorId: 'netsuite', roles: ['integration'] }, 'opportunities', id, {
            netsuite_sales_order_id: so.salesOrderId,
            netsuite_status: 'open',
            stage_key: 'closed_won',
          });
          return { mode: 'automatic', opportunity: record };
        }
      }
      const task = await one<{ id: string }>(
        db,
        "INSERT INTO tasks (tenant_id, title, object, record_id, assignee_role, created_by) VALUES ($1,$2,'opportunities',$3,'finance',$4) RETURNING id",
        [p.tenantId, `Enter sales order in NetSuite for "${String(opp.name)}" (customer PO ${input.customer_po_reference}) and record its ID`, id, p.actorId],
      );
      await this.events.publish(db, p.tenantId, 'opportunities.close_requested', { id, by: p.actorId, taskId: task!.id });
      return { mode: 'manual', taskId: task!.id, adapter: this.finance.name };
    });
  }

  @Post(':id/close-confirm')
  @Roles('finance')
  confirmClose(@CurrentPrincipal() p: Principal, @Param('id') id: string, @Body() body: unknown) {
    const input = validate(z.object({ netsuite_sales_order_id: z.string().min(1).max(100) }), body);
    return this.db.tx(p.tenantId, async (db) => {
      const { record } = await this.records.update(db, p, 'opportunities', id, {
        netsuite_sales_order_id: input.netsuite_sales_order_id,
        netsuite_status: 'open',
        stage_key: 'closed_won',
      });
      await db.query("UPDATE tasks SET status = 'done' WHERE object = 'opportunities' AND record_id = $1 AND assignee_role = 'finance' AND status = 'open'", [id]);
      return record;
    });
  }
}
