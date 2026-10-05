import { CanActivate, ExecutionContext, Inject, Injectable, SetMetadata, createParamDecorator } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import jwt from 'jsonwebtoken';
import { AppConfig, CONFIG } from '../config/config';
import { forbidden, unauthorized } from '../common/errors';
import { Principal, ROLES, Role, hasRole } from '../common/principal';

export const PUBLIC = 'atlas:public';
export const REQUIRED_ROLES = 'atlas:roles';

/** Route needs no bearer token (health, webhooks which verify their own HMAC, dev token issuance). */
export const Public = () => SetMetadata(PUBLIC, true);
/** Route requires at least one of these roles (admin always passes). */
export const Roles = (...roles: Role[]) => SetMetadata(REQUIRED_ROLES, roles);

export const CurrentPrincipal = createParamDecorator((_: unknown, ctx: ExecutionContext): Principal => {
  return ctx.switchToHttp().getRequest().principal;
});

interface TokenClaims {
  sub: string;
  tid: string;
  kind?: Principal['kind'];
  roles: string[];
}

export function signToken(secret: string, p: Principal, expiresIn: jwt.SignOptions['expiresIn'] = '12h'): string {
  const claims: TokenClaims = { sub: p.actorId, tid: p.tenantId, kind: p.kind, roles: p.roles };
  return jwt.sign(claims, secret, { algorithm: 'HS256', expiresIn, issuer: 'atlas-i' });
}

/**
 * Bearer-token guard. Tokens are HS256 JWTs issued by ATLAS-I today; the same Principal shape is
 * produced when Entra ID (OIDC) validation replaces this in the SSO sprint (FR-RPT-04).
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  canActivate(ctx: ExecutionContext): boolean {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC, targets)) return true;

    const req = ctx.switchToHttp().getRequest();
    const header: string | undefined = req.headers['authorization'];
    if (!header?.startsWith('Bearer ')) throw unauthorized();
    let claims: TokenClaims;
    try {
      claims = jwt.verify(header.slice(7), this.config.JWT_SECRET, { algorithms: ['HS256'], issuer: 'atlas-i' }) as TokenClaims;
    } catch {
      throw unauthorized('Invalid or expired token');
    }
    const principal: Principal = {
      tenantId: claims.tid,
      kind: claims.kind ?? 'user',
      actorId: claims.sub,
      roles: claims.roles.filter((r): r is Role => (ROLES as readonly string[]).includes(r)),
    };
    req.principal = principal;

    const required = this.reflector.getAllAndOverride<Role[]>(REQUIRED_ROLES, targets);
    if (required?.length && !hasRole(principal, ...required)) {
      throw forbidden('role_required', `Requires one of: ${required.join(', ')}`);
    }
    return true;
  }
}
