export type TeamInvitationRole = 'TENANT_ADMIN' | 'MEMBER' | 'GUEST';

export interface TeamInvitationMessageInput {
  tenantName: string;
  inviterName: string;
  role: TeamInvitationRole;
  signInUrl: string | null;
}

export interface TeamInvitationMessage {
  subject: string;
  body: string;
}

const ROLE_LABELS: Record<TeamInvitationRole, string> = {
  TENANT_ADMIN: 'administrador',
  MEMBER: 'miembro',
  GUEST: 'invitado',
};

/**
 * Builds the invitation email.
 *
 * There is no invitation link with a token: access is granted by the recipient signing
 * in with the Microsoft account matching the invited address, and the pending membership
 * activates on that first sign-in. So the message points at the workspace sign-in URL and
 * says which address to use, rather than implying a one-click accept link exists.
 */
export function buildTeamInvitationMessageV1(input: TeamInvitationMessageInput): TeamInvitationMessage {
  const roleLabel = ROLE_LABELS[input.role];
  const subject = `${input.inviterName} te invitó a ${input.tenantName} en Bridata Project`;

  const lines = [
    `${input.inviterName} te agregó como ${roleLabel} al espacio de trabajo "${input.tenantName}" en Bridata Project.`,
    '',
  ];

  if (input.signInUrl) {
    lines.push(
      `Para entrar, inicia sesión con tu cuenta de Microsoft en:`,
      input.signInUrl,
      '',
      'Usa la misma dirección a la que llegó este correo: el acceso se activa automáticamente en tu primer inicio de sesión.',
    );
  } else {
    lines.push(
      'Para entrar, inicia sesión en Bridata Project con tu cuenta de Microsoft usando la misma dirección a la que llegó este correo.',
      'El acceso se activa automáticamente en tu primer inicio de sesión.',
    );
  }

  return { subject, body: lines.join('\n') };
}
