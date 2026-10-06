import type { ZodType } from 'zod';
import { badRequest } from './errors';

/** Parse untrusted input with a zod schema, turning failures into a 400 with field-level issues. */
export function validate<T>(schema: ZodType<T>, input: unknown): T {
  const r = schema.safeParse(input);
  if (!r.success) {
    throw badRequest(
      'validation_failed',
      'Request failed validation',
      r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
  return r.data;
}
