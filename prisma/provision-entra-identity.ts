import { PrismaClient } from '@prisma/client';

const ENTRA_TENANT_ID = process.env.PROVISION_ENTRA_TENANT_ID;
const ENTRA_OID = process.env.PROVISION_ENTRA_OID;
const ENTRA_EMAIL = process.env.PROVISION_ENTRA_EMAIL;
const USER_FULL_NAME = process.env.PROVISION_USER_FULL_NAME;

if (!ENTRA_TENANT_ID) throw new Error('PROVISION_ENTRA_TENANT_ID is required.');
if (!ENTRA_OID) throw new Error('PROVISION_ENTRA_OID is required.');
if (!ENTRA_EMAIL) throw new Error('PROVISION_ENTRA_EMAIL is required.');
if (!USER_FULL_NAME) throw new Error('PROVISION_USER_FULL_NAME is required.');

const prisma = new PrismaClient();

async function main() {
  const user = await prisma.user.findFirst({ where: { fullName: USER_FULL_NAME } });
  if (!user) throw new Error(`User '${USER_FULL_NAME}' not found.`);

  const issuer = `https://login.microsoftonline.com/${ENTRA_TENANT_ID}/v2.0`;

  const existing = await prisma.userIdentity.findUnique({
    where: { provider_issuer_subject: { provider: 'ENTRA_ID', issuer, subject: ENTRA_OID } },
  });

  if (existing) {
    console.info(JSON.stringify({ status: 'already_exists', identityId: existing.id, userId: existing.userId }));
    return;
  }

  const identity = await prisma.userIdentity.create({
    data: {
      userId: user.id,
      provider: 'ENTRA_ID',
      issuer,
      subject: ENTRA_OID,
      providerTenantId: ENTRA_TENANT_ID,
      emailSnapshot: ENTRA_EMAIL,
    },
  });

  console.info(JSON.stringify({ status: 'created', identityId: identity.id, userId: identity.userId }));
}

main()
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
