import { describe, expect, it } from 'vitest';
import { buildTeamInvitationMessageV1 } from './team-invitation-notification-v1.js';

describe('team invitation message V1', () => {
  it('names the inviter, the workspace and the role', () => {
    const message = buildTeamInvitationMessageV1({
      tenantName: "willy uceda's Workspace",
      inviterName: 'willy uceda',
      role: 'MEMBER',
      signInUrl: 'https://bridata.example.com',
    });

    expect(message.subject).toContain('willy uceda');
    expect(message.subject).toContain("willy uceda's Workspace");
    expect(message.body).toContain('miembro');
    expect(message.body).toContain('https://bridata.example.com');
  });

  it('translates each role for the recipient', () => {
    const roleFor = (role: 'TENANT_ADMIN' | 'MEMBER' | 'GUEST') =>
      buildTeamInvitationMessageV1({
        tenantName: 'Acme',
        inviterName: 'Ana',
        role,
        signInUrl: null,
      }).body;

    expect(roleFor('TENANT_ADMIN')).toContain('administrador');
    expect(roleFor('MEMBER')).toContain('miembro');
    expect(roleFor('GUEST')).toContain('invitado');
  });

  it('never implies a one-click accept link exists', () => {
    // Access is granted by signing in with the invited address; there is no invitation
    // token, so the copy must not promise a link that would accept on the recipient's
    // behalf.
    const message = buildTeamInvitationMessageV1({
      tenantName: 'Acme',
      inviterName: 'Ana',
      role: 'MEMBER',
      signInUrl: 'https://bridata.example.com',
    });

    expect(message.body).toContain('inicia sesión');
    expect(message.body).not.toMatch(/aceptar invitaci[óo]n/i);
  });

  it('still explains how to get in when no sign-in URL is configured', () => {
    const message = buildTeamInvitationMessageV1({
      tenantName: 'Acme',
      inviterName: 'Ana',
      role: 'GUEST',
      signInUrl: null,
    });

    expect(message.body).toContain('inicia sesión');
    expect(message.body).not.toContain('null');
    expect(message.body).not.toContain('undefined');
  });
});
