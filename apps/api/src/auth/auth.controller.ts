import { Body, Controller, Get, Inject, Post } from '@nestjs/common';
import { z } from 'zod';
import { AppConfig, CONFIG } from '../config/config';
import { DbService, one } from '../db/db.service';
import { forbidden, notFound } from '../common/errors';
import { validate } from '../common/validate';
import { Principal, Role } from '../common/principal';
import { CurrentPrincipal, Public, signToken } from './auth.guard';

@Controller('v1/auth')
export class AuthController {
  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly db: DbService,
  ) {}

  /** Development-only sign-in by email. Disabled unless AUTH_DEV_TOKENS=true. */
  @Public()
  @Post('dev-token')
  async devToken(@Body() body: unknown) {
    if (!this.config.AUTH_DEV_TOKENS) throw forbidden('dev_tokens_disabled', 'Dev tokens are disabled');
    const { email, tenantId } = validate(
      z.object({ email: z.string().email(), tenantId: z.guid().optional() }),
      body,
    );
    const tid = tenantId ?? this.config.DEFAULT_TENANT_ID;
    const user = await this.db.tx(tid, (db) =>
      one<{ id: string; name: string; roles: Role[] }>(db, 'SELECT id, name, roles FROM users WHERE lower(email) = lower($1) AND active', [email]),
    );
    if (!user) throw notFound('User');
    const principal: Principal = { tenantId: tid, kind: 'user', actorId: user.id, roles: user.roles };
    return { token: signToken(this.config.JWT_SECRET, principal), user: { id: user.id, name: user.name, roles: user.roles } };
  }

  @Get('me')
  me(@CurrentPrincipal() p: Principal) {
    return p;
  }
}
