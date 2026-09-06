import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  user: { findFirst: vi.fn() },
  userIdentity: { create: vi.fn(), findUnique: vi.fn() },
  tenantMembership: { findMany: vi.fn(), updateMany: vi.fn() },
  $transaction: vi.fn(),
}));

// withTenant / withAuthenticatedUser only add an RLS GUC around a transaction; the
// isolation itself is exercised by prisma/rls-smoke.ts against a real database. Here
// they pass a stub tx through so the invitation state machine can be asserted directly.
const txMock = vi.hoisted(() => ({
  $executeRaw: vi.fn(),
  tenantMembership: { findMany: vi.fn(), updateMany: vi.fn() },
}));

vi.mock('./db.js', () => ({ prisma: prismaMock }));
vi.mock('./config.js', () => ({ config: { ENTRA_PLATFORM_ADMIN_OIDS: '' } }));
vi.mock('./tenant-transaction.js', () => ({
  withTenant: (_tenantId: string, op: (tx: typeof txMock) => unknown) => op(txMock),
  withAuthenticatedUser: (_userId: string, op: (tx: typeof txMock) => unknown) => op(txMock),
}));

const { activatePendingInvitations, resolveOrProvisionEntraUser } = await import('./auto-provision.js');

const principal = {
  provider: 'ENTRA_ID' as const,
  issuer: 'https://login.microsoftonline.com/tenant/v2.0',
  subject: 'oid-new-user',
  email: 'Invitee@Corp.com',
  name: 'Invitee',
};

const shellUser = {
  id: 'user-1',
  email: 'invitee@corp.com',
  fullName: 'Invitee',
  avatarUrl: null,
  isActive: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  txMock.$executeRaw.mockResolvedValue(1);
});

describe('activatePendingInvitations', () => {
  it('flips every pending invitation to ACTIVE', async () => {
    txMock.tenantMembership.findMany.mockResolvedValue([
      { id: 'm-1', tenantId: 't-1' },
      { id: 'm-2', tenantId: 't-2' },
    ]);
    txMock.tenantMembership.updateMany.mockResolvedValue({ count: 1 });

    await expect(activatePendingInvitations('user-1')).resolves.toBe(2);

    expect(txMock.tenantMembership.updateMany).toHaveBeenCalledTimes(2);
    for (const call of txMock.tenantMembership.updateMany.mock.calls) {
      // Scoping the update by status INVITED is what makes a concurrent revoke
      // return count 0 instead of throwing P2025 on the login path.
      expect(call[0]).toMatchObject({
        where: { status: 'INVITED' },
        data: { status: 'ACTIVE' },
      });
    }
  });

  it('is a no-op when nothing is pending', async () => {
    txMock.tenantMembership.findMany.mockResolvedValue([]);

    await expect(activatePendingInvitations('user-1')).resolves.toBe(0);
    expect(txMock.tenantMembership.updateMany).not.toHaveBeenCalled();
  });

  it('reports only the invitations that were still pending', async () => {
    txMock.tenantMembership.findMany.mockResolvedValue([
      { id: 'm-1', tenantId: 't-1' },
      { id: 'm-2', tenantId: 't-2' },
    ]);
    txMock.tenantMembership.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });

    await expect(activatePendingInvitations('user-1')).resolves.toBe(1);
  });
});

describe('resolveOrProvisionEntraUser — invited identity linking', () => {
  it('links an invited shell user and activates their membership instead of creating a tenant', async () => {
    prismaMock.user.findFirst.mockResolvedValue(shellUser);
    txMock.tenantMembership.findMany.mockResolvedValue([{ id: 'm-1', tenantId: 't-1' }]);
    txMock.tenantMembership.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.userIdentity.create.mockResolvedValue({ id: 'identity-1' });

    await expect(resolveOrProvisionEntraUser(principal)).resolves.toEqual(shellUser);

    expect(prismaMock.userIdentity.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: 'user-1', provider: 'ENTRA_ID', subject: 'oid-new-user' }),
    });
    expect(txMock.tenantMembership.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'ACTIVE' } }),
    );
    // No new tenant: auto-provisioning runs in a $transaction, which must stay untouched.
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('only considers accounts that have never been linked to an identity', async () => {
    prismaMock.user.findFirst.mockResolvedValue(null);
    prismaMock.$transaction.mockResolvedValue(shellUser);

    await resolveOrProvisionEntraUser(principal);

    // The `identities: { none: {} }` predicate is the guard that stops a matching
    // email from attaching a new Entra subject to an account someone already uses.
    expect(prismaMock.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ identities: { none: {} } }),
      }),
    );
    // Nothing to link, so it falls through to creating a fresh tenant.
    expect(prismaMock.$transaction).toHaveBeenCalled();
  });

  it('falls through to auto-provisioning when the matched account has no invitation', async () => {
    prismaMock.user.findFirst.mockResolvedValue(shellUser);
    txMock.tenantMembership.findMany.mockResolvedValue([]);
    prismaMock.$transaction.mockResolvedValue(shellUser);

    await resolveOrProvisionEntraUser(principal);

    expect(prismaMock.userIdentity.create).not.toHaveBeenCalled();
    expect(prismaMock.$transaction).toHaveBeenCalled();
  });

  it('resolves the winner of a concurrent first-login race instead of failing', async () => {
    prismaMock.user.findFirst.mockResolvedValue(shellUser);
    txMock.tenantMembership.findMany.mockResolvedValue([{ id: 'm-1', tenantId: 't-1' }]);
    txMock.tenantMembership.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.userIdentity.create.mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' }));
    prismaMock.userIdentity.findUnique.mockResolvedValue({ user: shellUser });

    await expect(resolveOrProvisionEntraUser(principal)).resolves.toEqual(shellUser);
  });

  it('skips linking entirely when the token carries no email claim', async () => {
    prismaMock.$transaction.mockResolvedValue(shellUser);
    const { email, ...withoutEmail } = principal;
    void email;

    await resolveOrProvisionEntraUser(withoutEmail);

    expect(prismaMock.user.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.$transaction).toHaveBeenCalled();
  });
});
