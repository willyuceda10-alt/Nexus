import { PrismaClient } from '@prisma/client';

const adminUrl = process.env.ADMIN_DATABASE_URL;
if (!adminUrl) {
  throw new Error('ADMIN_DATABASE_URL is required to provision the CI runtime role.');
}

const admin = new PrismaClient({
  datasources: {
    db: { url: adminUrl },
  },
});

async function main() {
  await admin.$executeRawUnsafe(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nexus_runtime') THEN
        CREATE ROLE nexus_runtime
          LOGIN
          PASSWORD 'nexus'
          NOSUPERUSER
          NOCREATEDB
          NOCREATEROLE
          NOINHERIT
          NOBYPASSRLS;
      END IF;
    END
    $$;
  `);

  await admin.$executeRawUnsafe('GRANT CONNECT ON DATABASE nexus_ci TO nexus_runtime');
  await admin.$executeRawUnsafe('GRANT USAGE ON SCHEMA public TO nexus_runtime');
  await admin.$executeRawUnsafe(
    'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO nexus_runtime',
  );
  await admin.$executeRawUnsafe(
    'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO nexus_runtime',
  );

  const roles = await admin.$queryRaw<Array<{ rolname: string; rolsuper: boolean; rolbypassrls: boolean }>>`
    SELECT rolname, rolsuper, rolbypassrls
    FROM pg_roles
    WHERE rolname = 'nexus_runtime'
  `;

  const role = roles[0];
  if (!role || role.rolsuper || role.rolbypassrls) {
    throw new Error('CI runtime role must exist without SUPERUSER or BYPASSRLS.');
  }

  console.info(JSON.stringify({ runtimeRole: role.rolname, rlsBypass: false }));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await admin.$disconnect();
  });
