import { Prisma } from '@prisma/client';

export function numberOf(value: Prisma.Decimal | number | string | null | undefined): number {
  return value == null ? 0 : Number(value);
}

export function jsonRecord(value: Prisma.JsonValue | null): Record<string, Prisma.JsonValue> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, Prisma.JsonValue>;
}

export function metadataProjectId(value: Prisma.JsonValue | null): string | null {
  const metadata = jsonRecord(value);
  return typeof metadata.projectId === 'string' ? metadata.projectId : null;
}

export function metadataNumber(value: Prisma.JsonValue | null, key: string): number | null {
  const metadata = jsonRecord(value);
  const candidate = metadata[key];
  return typeof candidate === 'number' && Number.isFinite(candidate) ? candidate : null;
}

export function tenantCurrency(value: Prisma.JsonValue | null): string {
  const metadata = jsonRecord(value);
  const currency = typeof metadata.currency === 'string' ? metadata.currency.toUpperCase() : 'USD';
  return /^[A-Z]{3}$/.test(currency) ? currency : 'USD';
}

export async function validProject(
  tx: Prisma.TransactionClient,
  tenantId: string,
  projectId: string,
) {
  return tx.nexusObject.findFirst({
    where: {
      id: projectId,
      tenantId,
      objectTypeKey: 'PROJECT',
      deletedAt: null,
    },
    select: { id: true, workspaceId: true, title: true, metadata: true },
  });
}

export async function validWorkItem(
  tx: Prisma.TransactionClient,
  tenantId: string,
  workspaceId: string,
  projectId: string,
  objectId?: string | null,
): Promise<boolean> {
  if (!objectId) return true;
  const object = await tx.nexusObject.findFirst({
    where: {
      id: objectId,
      tenantId,
      workspaceId,
      objectTypeKey: { in: ['TASK', 'DELIVERABLE', 'MILESTONE'] },
      deletedAt: null,
    },
    select: { metadata: true },
  });
  return Boolean(object && metadataProjectId(object.metadata) === projectId);
}

export async function costCodeBelongsToWorkspace(
  tx: Prisma.TransactionClient,
  tenantId: string,
  workspaceId: string,
  costCodeId?: string | null,
): Promise<boolean> {
  if (!costCodeId) return true;
  const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT id FROM cost_codes
    WHERE id = ${costCodeId}::uuid
      AND tenant_id = ${tenantId}::uuid
      AND workspace_id = ${workspaceId}::uuid
      AND is_active = true
  `);
  return rows.length > 0;
}

export async function materialBelongsToWorkspace(
  tx: Prisma.TransactionClient,
  tenantId: string,
  workspaceId: string,
  materialId?: string | null,
): Promise<boolean> {
  if (!materialId) return true;
  const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT id FROM material_masters
    WHERE id = ${materialId}::uuid
      AND tenant_id = ${tenantId}::uuid
      AND workspace_id = ${workspaceId}::uuid
      AND is_active = true
  `);
  return rows.length > 0;
}

export async function projectCostCurrency(
  tx: Prisma.TransactionClient,
  tenantId: string,
  projectId: string,
): Promise<string> {
  const rows = await tx.$queryRaw<Array<{ currency: string }>>(Prisma.sql`
    SELECT currency FROM project_cost_profiles
    WHERE tenant_id = ${tenantId}::uuid AND project_object_id = ${projectId}::uuid
  `);
  if (rows[0]?.currency) return rows[0].currency;
  const tenant = await tx.tenant.findUnique({ where: { id: tenantId }, select: { metadata: true } });
  return tenantCurrency(tenant?.metadata ?? null);
}