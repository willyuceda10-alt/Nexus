import { randomUUID } from 'node:crypto';
import { config } from './config.js';
import { prisma } from './db.js';
import { withAuthenticatedUser, withTenant } from './tenant-transaction.js';
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

/**
 * Activates any pending invitations for an already-known user.
 *
 * Must run on EVERY session resolution, not only on first provisioning: someone
 * who has logged in before already has a UserIdentity, so they never reach the
 * link-on-first-login path below, and their invitation would otherwise stay
 * INVITED forever with no way to ever accept it.
 *
 * Returns the number of memberships activated.
 */
export async function activatePendingInvitations(userId: string): Promise<number> {
  const pending = await withAuthenticatedUser(userId, (tx) =>
    tx.tenantMembership.findMany({
      where: { userId, status: 'INVITED' },
      select: { id: true, tenantId: true },
    }),
  );
  if (pending.length === 0) return 0;

  let activated = 0;
  for (const membership of pending) {
    // One transaction per tenant: each needs its own RLS tenant context, and a
    // concurrent revoke of one invitation must not roll back the others.
    activated += await withTenant(membership.tenantId, async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_user_id', ${userId}, true)`;
      // updateMany (not update) so a concurrently revoked invitation yields
      // count 0 instead of throwing P2025 on the login path.
      const result = await tx.tenantMembership.updateMany({
        where: { id: membership.id, status: 'INVITED' },
        data: { status: 'ACTIVE' },
      });
      return result.count;
    });
  }
  return activated;
}

// A tenant owner/admin can invite someone by email before they ever log in (see
// routes/team-members.ts), which creates a shell User + an INVITED TenantMembership.
// On that person's first real login, attach their Entra identity to the shell user
// and activate the membership instead of spinning up a brand-new tenant for them.
//
// Only accounts that have never been linked to any identity are eligible, so a
// matching email can never attach a new Entra subject to an account that someone
// already signs in as.
async function linkInvitedIdentity(principal: AuthPrincipal): Promise<AuthenticatedUser | null> {
  const email = principal.email?.trim().toLowerCase();
  if (!email) return null;

  const shellUser = await prisma.user.findFirst({
    where: {
      email: { equals: email, mode: 'insensitive' },
      identities: { none: {} },
    },
    orderBy: { createdAt: 'asc' },
    select: { id: true, email: true, fullName: true, avatarUrl: true, isActive: true },
  });
  if (!shellUser) return null;

  const invitedMemberships = await withAuthenticatedUser(shellUser.id, (tx) =>
    tx.tenantMembership.findMany({
      where: { userId: shellUser.id, status: 'INVITED' },
      select: { id: true, tenantId: true },
    }),
  );
  if (invitedMemberships.length === 0) return null;

  try {
    await prisma.userIdentity.create({
      data: {
        userId: shellUser.id,
        provider: 'ENTRA_ID',
        issuer: principal.issuer,
        subject: principal.subject,
        providerTenantId: principal.providerTenantId ?? null,
        emailSnapshot: principal.email ?? null,
      },
    });
  } catch (err) {
    if (isPrismaUniqueViolation(err)) {
      const identity = await prisma.userIdentity.findUnique({
        where: { provider_issuer_subject: { provider: 'ENTRA_ID', issuer: principal.issuer, subject: principal.subject } },
        include: { user: { select: { id: true, email: true, fullName: true, avatarUrl: true, isActive: true } } },
      });
      if (identity?.user) {
        await activatePendingInvitations(identity.user.id);
        return identity.user;
      }
    }
    throw err;
  }

  await activatePendingInvitations(shellUser.id);
  return shellUser;
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
