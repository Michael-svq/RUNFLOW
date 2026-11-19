import { auditLog, type Tx } from '@runflow/db';

export async function audit(
  tx: Tx,
  entry: {
    orgId: string | null;
    userId: string | null;
    action: string;
    targetType?: string;
    targetId?: string;
    data?: Record<string, unknown>;
  },
): Promise<void> {
  await tx.insert(auditLog).values({
    orgId: entry.orgId,
    userId: entry.userId,
    action: entry.action,
    targetType: entry.targetType,
    targetId: entry.targetId,
    data: entry.data ?? {},
  });
}
