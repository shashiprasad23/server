import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Response } from 'express';

/** Domain errors carry an HTTP status and a stable machine-readable code. */
export class DomainError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (code: string, message: string, details?: unknown) => new DomainError(400, code, message, details);
export const unauthorized = (message = 'Authentication required') => new DomainError(401, 'unauthorized', message);
export const forbidden = (code: string, message: string) => new DomainError(403, code, message);
export const notFound = (what: string) => new DomainError(404, 'not_found', `${what} not found`);
export const conflict = (code: string, message: string) => new DomainError(409, code, message);
export const unprocessable = (code: string, message: string, details?: unknown) =>
  new DomainError(422, code, message, details);

@Catch()
export class ErrorFilter implements ExceptionFilter {
  private readonly log = new Logger('Errors');

  catch(err: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    if (err instanceof DomainError) {
      res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
      return;
    }
    if (err instanceof HttpException) {
      const status = err.getStatus();
      res.status(status).json({ error: { code: 'http_error', message: err.message } });
      return;
    }
    // Map well-known Postgres errors to client errors instead of 500s.
    const pgCode = (err as { code?: string } | undefined)?.code;
    const pgMap: Record<string, [number, string, string]> = {
      '22P02': [400, 'invalid_input', 'Malformed identifier or value'],
      '23505': [409, 'duplicate', 'A record with this unique value already exists'],
      '23503': [422, 'invalid_reference', 'Referenced record does not exist'],
      '22001': [400, 'value_too_long', 'Value too long'],
    };
    if (pgCode && pgMap[pgCode]) {
      const [status, code, message] = pgMap[pgCode];
      res.status(status).json({ error: { code, message } });
      return;
    }
    this.log.error(err instanceof Error ? err.stack ?? err.message : String(err));
    res.status(500).json({ error: { code: 'internal', message: 'Internal error' } });
  }
}
