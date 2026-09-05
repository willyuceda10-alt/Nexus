import { config } from './config.js';
import { prisma } from './db.js';
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

export async function autoProvisionEntraUser(
  principal: AuthPrincipal,
): Promise<AuthenticatedUser> {
  const fullName = principal.name ?? principal.email?.split('@')[0] ?? 'New User';
  const email = principal.email ?? `user-${principal.subject}@unknown`;
  const isPlatformAdmin = PLATFORM_ADMIN_OIDS.has(principal.subject);

  try {
    return await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { fullName, email, isActive: true, isPlatformAdmin },
        select: { id: true, email: true, fullName: true, avatarUrl: true, isActive: true },
      });

      const tenant = await tx.tenant.create({
        data: { name: `${fullName}'s Workspace`, slug: deriveSlug(email), plan: 'STARTER', status: 'ACTIVE' },
      });

      await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${tenant.id}, true)`;
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
          providerTenantId: principal.providerTenantId,
          emailSnapshot: principal.email,
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
