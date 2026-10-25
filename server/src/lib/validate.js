import { badRequest } from './errors.js';

/** Parses `data` with a zod schema, throwing a 400 that names the first invalid field. */
export function parse(schema, data) {
  const result = schema.safeParse(data);
  if (result.success) return result.data;
  const details = result.error.issues.map((issue) => ({
    field: issue.path.join('.'),
    message: issue.message,
  }));
  const first = details[0];
  throw badRequest(first.field ? `${first.field}: ${first.message}` : first.message, details);
}

export function parseId(value, label = 'id') {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0 || id > 2_147_483_647) throw badRequest(`Invalid ${label}`);
  return id;
}

export function pagination(queryParams, { defaultSize = 25, maxSize = 200 } = {}) {
  const page = Math.max(1, Number.parseInt(queryParams.page, 10) || 1);
  const pageSize = Math.min(maxSize, Math.max(1, Number.parseInt(queryParams.pageSize, 10) || defaultSize));
  return { page, pageSize, offset: (page - 1) * pageSize };
}

/** Builds an ILIKE pattern that matches the term literally anywhere in a column. */
export function likePattern(term) {
  const trimmed = String(term ?? '').trim();
  if (!trimmed) return null;
  return `%${trimmed.replace(/[\\%_]/g, '\\$&')}%`;
}
