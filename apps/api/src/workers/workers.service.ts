import { Inject, Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { AppConfig, CONFIG } from '../config/config';
import { EventBus } from '../events/event-bus';
import { OutboundService } from '../outbound/outbound.service';
import { ApprovalsService } from '../agents/approvals.service';
import { DbService } from '../db/db.service';
import { CpqService } from '../cpq/cpq.service';
import { DealCoachAgent } from '../agents/builtin/deal-coach.agent';
import { InstalledBaseService } from '../cs/installed-base.service';

/** Background loops: outbox dispatch, outbound delivery after the undo window, approval expiry. */
@Injectable()
export class WorkersService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly log = new Logger('Workers');
  private timers: NodeJS.Timeout[] = [];

  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly events: EventBus,
    private readonly outbound: OutboundService,
    private readonly approvals: ApprovalsService,
    private readonly dbs: DbService,
    private readonly cpq: CpqService,
    private readonly coach: DealCoachAgent,
    private readonly installed: InstalledBaseService,
  ) {}

  /** Hourly per-tenant housekeeping: hold expiry, quote revalidation, deal scoring, renewals. */
  async sweep() {
    const tenants = (await this.dbs.pool.query<{ id: string }>('SELECT id FROM tenants')).rows;
    for (const t of tenants) {
      await this.dbs.tx(t.id, (db) => this.cpq.expireHolds(db));
      await this.cpq.sweepQuotes(t.id);
      await this.coach.sweep(t.id);
      await this.installed.sweep(t.id);
    }
  }

  private loop(name: string, ms: number, fn: () => Promise<unknown>) {
    let running = false;
    this.timers.push(
      setInterval(async () => {
        if (running) return;
        running = true;
        try {
          await fn();
        } catch (err) {
          this.log.error(`${name}: ${err instanceof Error ? err.message : err}`);
        } finally {
          running = false;
        }
      }, ms),
    );
  }

  onApplicationBootstrap() {
    if (!this.config.WORKERS_ENABLED) return;
    this.loop('outbox', 500, () => this.events.drain());
    this.loop('outbound', 5000, () => this.outbound.flushDue());
    this.loop('approvals', 60000, () => this.approvals.expireOverdue());
    this.loop('sweep', Number(process.env.SWEEP_INTERVAL_MINUTES ?? 60) * 60000, () => this.sweep());
    this.log.log('workers started');
  }

  onApplicationShutdown() {
    this.timers.forEach(clearInterval);
  }
}
