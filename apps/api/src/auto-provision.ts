import { randomUUID } from 'node:crypto';
import { config } from './config.js';
import { prisma } from './db.js';
import { withAuthenticatedUser } from './tenant-transaction.js';
import type { AuthPrincipal, AuthenticatedUser } from './auth.js';

const PLATFORM_ADMIN_OIDS: ReadonlySet<string> = new Set(
  (config.ENTRA_PLATFORM_ADMIN_OIDS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
);

function deriveSlug(email: string): string {
  const username = email.split('@')[0] ?? 'user';
  const base = username
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'workspace';
  const suffix = Math.random().toString(36).slice(2, 7);
  return `${base}-${suffix}`;
}

function isPrismaUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object'
    && err !== null
    && 'code' in err
    && (err as { code: unknown }).code === 'P2002'
  );
}

export async function resolveOrProvisionEntraUser(
  principal: AuthPrincipal,
): Promise<AuthenticatedUser> {
  const invited = await linkInvitedIdentity(principal);
  if (invited) return invited;
  return autoProvisionEntraUser(principal);
}

// A tenant owner/admin can invite someone by email before they ever log in (see
// routes/team-members.ts), which creates a shell User + an INVITED TenantMembership.
// On that person's first real login, attach their Entra identity to the shell user
// and activate the membership instead of spinning up a brand-new tenant for them.
async function linkInvitedIdentity(principal: AuthPrincipal): Promise<AuthenticatedUser | null> {
  const email = principal.email?.trim().toLowerCase();
  if (!email) return null;

  const shellUser = await prisma.user.findFirst({
    where: { email: { equals: email, mode: 'insensitive' } },
    select: { id: true, email: true, fullName: true, avatarUrl: true, isActive: true },
  });
  if (!shellUser) return null;

  const invitedMemberships = await withAuthenticatedUser(shellUser.id, (tx) =>
    tx.tenantMembership.findMany({ where: { userId: shellUser.id, status: 'INVITED' } }),
  );
  if (invitedMemberships.length === 0) return null;

  try {
    return await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_user_id', ${shellUser.id}, true)`;

      await tx.userIdentity.create({
        data: {
          userId: shellUser.id,
          provider: 'ENTRA_ID',
          issuer: principal.issuer,
          subject: principal.subject,
          providerTenantId: principal.providerTenantId ?? null,
          emailSnapshot: principal.email ?? null,
        },
      });

      for (const membership of invitedMemberships) {
        await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${membership.tenantId}, true)`;
        await tx.tenantMembership.update({ where: { id: membership.id }, data: { status: 'ACTIVE' } });
      }

      return shellUser;
    });
  } catch (err) {
    if (isPrismaUniqueViolation(err)) {
      const identity = await prisma.userIdentity.findUnique({
        where: { provider_issuer_subject: { provider: 'ENTRA_ID', issuer: principal.issuer, subject: principal.subject } },
        include: { user: { select: { id: true, email: true, fullName: true, avatarUrl: true, isActive: true } } },
      });
      if (identity?.user) return identity.user;
    }
    throw err;
  }
}

export async function autoProvisionEntraUser(
  principal: AuthPrincipal,
): Promise<AuthenticatedUser> {
  const fullName = principal.name ?? principal.email?.split('@')[0] ?? 'New User';
  const email = principal.email ?? `user-${principal.subject}@unknown`;
  const isPlatformAdmin = PLATFORM_ADMIN_OIDS.has(principal.subject);

  const tenantId = randomUUID();

  try {
    return await prisma.$transaction(async (tx) => {
      // tenants.id has no client-side default (DB-generated gen_random_uuid()), but the
      // tenant_isolation RLS policy's WITH CHECK requires current_tenant_id to already equal
      // the row being inserted. Pre-generate the id so the config can be set before the insert.
      await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;

      const user = await tx.user.create({
        data: { fullName, email, isActive: true, isPlatformAdmin },
        select: { id: true, email: true, fullName: true, avatarUrl: true, isActive: true },
      });

      const tenant = await tx.tenant.create({
        data: { id: tenantId, name: `${fullName}'s Workspace`, slug: deriveSlug(email), plan: 'STARTER', status: 'ACTIVE' },
      });

      await tx.$executeRaw`SELECT set_config('app.current_user_id', ${user.id}, true)`;

      await tx.tenantMembership.create({
        data: { tenantId: tenant.id, userId: user.id, role: 'OWNER', status: 'ACTIVE' },
      });

      await tx.userIdentity.create({
        data: {
          userId: user.id,
          provider: 'ENTRA_ID',
          issuer: principal.issuer,
          subject: principal.subject,
          providerTenantId: principal.providerTenantId ?? null,
          emailSnapshot: principal.email ?? null,
        },
      });

      return user;
    });
  } catch (err) {
    if (isPrismaUniqueViolation(err)) {
      // Concurrent first-login race — the other request won, resolve from DB
      const identity = await prisma.userIdentity.findUnique({
        where: { provider_issuer_subject: { provider: 'ENTRA_ID', issuer: principal.issuer, subject: principal.subject } },
        include: { user: { select: { id: true, email: true, fullName: true, avatarUrl: true, isActive: true } } },
      });
      if (identity?.user) return identity.user;
    }
    throw err;
  }
}
