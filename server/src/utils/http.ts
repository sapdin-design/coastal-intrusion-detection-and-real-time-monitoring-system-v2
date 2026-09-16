import type { Response } from 'express';

export interface ApiEnvelope<T> {
  success: true;
  data: T;
  meta?: Record<string, unknown>;
}

/** Uniform success envelope — every 2xx response in the API uses this shape. */
export const ok = <T>(
  res: Response,
  data: T,
  meta?: Record<string, unknown>,
  status = 200,
): Response => {
  const payload: ApiEnvelope<T> = { success: true, data, ...(meta ? { meta } : {}) };
  return res.status(status).json(payload);
};

/** Applies `page` / `limit` to an in-memory list and reports the totals. */
export const paginate = <T>(
  rows: T[],
  page?: number,
  limit?: number,
): { rows: T[]; meta: { total: number; page: number; limit: number; pages: number } } => {
  const total = rows.length;
  if (!page && !limit) {
    return { rows, meta: { total, page: 1, limit: total, pages: 1 } };
  }
  const size = limit ?? 50;
  const current = page ?? 1;
  const start = (current - 1) * size;
  return {
    rows: rows.slice(start, start + size),
    meta: { total, page: current, limit: size, pages: Math.max(1, Math.ceil(total / size)) },
  };
};

export const clientIp = (req: { ip?: string; headers: Record<string, unknown> }): string => {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') return forwarded.split(',')[0].trim();
  return req.ip ?? '';
};
