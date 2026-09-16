import { logger } from '../config/logger';
import { getStore } from '../repositories';
import type { Actor, AuditEntry } from '../types/domain';
import { businessId, nowIso } from '../utils/ids';

/**
 * Append-only activity log. Every state-changing API call writes one entry, which
 * gives the dashboard its "system activity" feed and gives a future audit
 * requirement (very common for security projects) a ready-made home.
 */
class AuditService {
  async record(
    actor: Actor | null,
    action: string,
    entity: string,
    entityId: string,
    detail: string,
    ip = '',
  ): Promise<void> {
    const entry: AuditEntry = {
      _id: businessId('audit'),
      actorId: actor?._id ?? null,
      actorName: actor?.name ?? 'system',
      action,
      entity,
      entityId,
      detail,
      ip,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    try {
      await getStore().audit.append(entry);
    } catch (error) {
      // Auditing must never break the request it is describing.
      logger.warn(`audit write failed: ${(error as Error).message}`);
    }
  }

  async list(limit = 200): Promise<AuditEntry[]> {
    return getStore().audit.list(limit);
  }
}

export const auditService = new AuditService();
