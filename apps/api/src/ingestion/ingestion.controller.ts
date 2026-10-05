import { Body, Controller, Get, Headers, HttpCode, Inject, Param, Post, Req } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import type { Request } from 'express';
import { AppConfig, CONFIG } from '../config/config';
import { CurrentPrincipal, Public, Roles } from '../auth/auth.guard';
import { Principal } from '../common/principal';
import { badRequest, notFound, unauthorized } from '../common/errors';
import { SOURCES, Source } from './normalized-event';
import { PipelineService } from './pipeline.service';

export function sign(secret: string, body: Buffer | string): string {
  return 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
}

@Controller('v1/channel-events')
export class IngestionController {
  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly pipeline: PipelineService,
  ) {}

  private secret(source: Source): string {
    const map: Record<Source, string> = {
      marketplace: this.config.CHANNEL_SECRET_MARKETPLACE,
      usp: this.config.CHANNEL_SECRET_USP,
      outlook: this.config.CHANNEL_SECRET_OUTLOOK,
      teams: this.config.CHANNEL_SECRET_TEAMS,
      whatsapp: this.config.CHANNEL_SECRET_WHATSAPP,
    };
    return map[source];
  }

  /**
   * Inbound webhook for every channel (FR-CH-01, FR-CAP-01). Authenticated by an HMAC-SHA256
   * signature of the raw body (X-Atlas-Signature), idempotent on the source's event id.
   */
  @Public()
  @Post(':source')
  @HttpCode(202)
  async receive(
    @Param('source') source: string,
    @Req() req: Request & { rawBody?: Buffer },
    @Body() body: unknown,
    @Headers('x-atlas-signature') signature?: string,
  ) {
    if (!(SOURCES as readonly string[]).includes(source)) throw notFound(`Source "${source}"`);
    const src = source as Source;
    if (!req.rawBody) throw badRequest('raw_body_missing', 'Raw body unavailable');
    const expected = Buffer.from(sign(this.secret(src), req.rawBody));
    const given = Buffer.from(signature ?? '');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw unauthorized('Invalid webhook signature');
    // Single-tenant for the internal phase; per-tenant secrets come with external tenants.
    return this.pipeline.ingest(this.config.DEFAULT_TENANT_ID, src, body);
  }

  /** Dev-only: inject a channel event from the UI's simulator without a webhook signature. */
  @Post('dev/simulate/:source')
  @Roles('admin', 'sales_leader')
  simulate(@CurrentPrincipal() p: Principal, @Param('source') source: string, @Body() body: unknown) {
    if (!this.config.AUTH_DEV_TOKENS) throw notFound('Route');
    if (!(SOURCES as readonly string[]).includes(source)) throw notFound(`Source "${source}"`);
    return this.pipeline.ingest(p.tenantId, source as Source, body);
  }

  @Get('failed')
  @Roles('sales_leader')
  failed(@CurrentPrincipal() p: Principal) {
    return this.pipeline.failed(p.tenantId);
  }

  @Post(':id/replay')
  @Roles('sales_leader')
  replay(@CurrentPrincipal() p: Principal, @Param('id') id: string) {
    return this.pipeline.replay(p.tenantId, id);
  }
}
