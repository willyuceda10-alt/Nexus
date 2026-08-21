import type { Prisma } from '@prisma/client';
import { prisma } from './db.js';

export async function withTenant<T>(
  tenantId: string,
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
    return operation(tx);
  });
}
