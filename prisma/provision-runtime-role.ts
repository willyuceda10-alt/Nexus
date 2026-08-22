import { PrismaClient } from '@prisma/client';

const adminUrl = process.env.ADMIN_DATABASE_URL;
const runtimeUrl = process.env.RUNTIME_DATABASE_URL;

if (!adminUrl) throw new Error('ADMIN_DATABASE_URL is required.');
if (!runtimeUrl) throw new Error('RUNTIME_DATABASE_URL is required.');

const adminConnection = new URL(adminUrl);
const runtimeConnection = new URL(runtimeUrl);
const runtimeRole = decodeURIComponent(runtimeConnection.username);
const runtimePassword = decodeURIComponent(runtimeConnection.password);
const adminDatabaseName = decodeURIComponent(adminConnection.pathname.replace(/^\//, ''));
const runtimeDatabaseName = decodeURIComponent(runtimeConnection.pathname.replace(/^\//, ''));

if (!runtimeRole || !/^[a-z_][a-z0-9_]{0,62}$/.test(runtimeRole)) {
  throw new Error('RUNTIME_DATABASE_URL username must be a lowercase PostgreSQL-safe identifier (max 63 chars).');
}
if (!runtimePassword) {
  throw new Error('RUNTIME_DATABASE_URL must include a non-empty password.');
}
if (!adminDatabaseName || !/^[A-Za-z0-9_.-]{1,63}$/.test(adminDatabaseName)) {
  throw new Error('ADMIN_DATABASE_URL must target a database with a supported identifier.');
}
if (runtimeDatabaseName !== adminDatabaseName) {
  throw new Error('ADMIN_DATABASE_URL and RUNTIME_DATABASE_URL must target the same database.');
}

const admin = new PrismaClient({
  datasources: {
    db: { url: adminUrl },
  },
});

async function main() {
  const role = await admin.$transaction(async (tx) => {
    // Keep secrets out of SQL string interpolation. set_config is parameterized and the
    // interactive transaction pins all subsequent statements to this same connection.
    await tx.$executeRaw`
      SELECT
        set_config('bridata.runtime_role', ${runtimeRole}, true),
        set_config('bridata.runtime_password', ${runtimePassword}, true),
        set_config('bridata.runtime_database', ${adminDatabaseName}, true)
    `;

    await tx.$executeRawUnsafe(`
      DO $$
      DECLARE
        role_name text := current_setting('bridata.runtime_role');
        role_password text := current_setting('bridata.runtime_password');
        database_name text := current_setting('bridata.runtime_database');
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
          EXECUTE format(
            'CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS',
            role_name,
            role_password
          );
        ELSE
          EXECUTE format(
            'ALTER ROLE %I WITH LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS',
            role_name,
            role_password
          );
        END IF;

        EXECUTE format('GRANT CONNECT ON DATABASE %I TO %I', database_name, role_name);
        EXECUTE format('GRANT USAGE ON SCHEMA public TO %I', role_name);
        EXECUTE format(
          'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO %I',
          role_name
        );
        EXECUTE format(
          'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO %I',
          role_name
        );
        EXECUTE format(
          'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %I',
          role_name
        );
        EXECUTE format(
          'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO %I',
          role_name
        );
      END
      $$;
    `);

    const rows = await tx.$queryRaw<Array<{
      rolname: string;
      rolsuper: boolean;
      rolcreatedb: boolean;
      rolcreaterole: boolean;
      rolinherit: boolean;
      rolbypassrls: boolean;
      rolcanlogin: boolean;
    }>>`
      SELECT
        rolname,
        rolsuper,
        rolcreatedb,
        rolcreaterole,
        rolinherit,
        rolbypassrls,
        rolcanlogin
      FROM pg_roles
      WHERE rolname = ${runtimeRole}
    `;

    return rows[0];
  });

  if (
    !role ||
    role.rolsuper ||
    role.rolcreatedb ||
    role.rolcreaterole ||
    role.rolinherit ||
    role.rolbypassrls ||
    !role.rolcanlogin
  ) {
    throw new Error('Runtime role security invariants were not satisfied.');
  }

  console.info(JSON.stringify({
    runtimeRole: role.rolname,
    database: adminDatabaseName,
    login: true,
    superuser: false,
    createDb: false,
    createRole: false,
    inherit: false,
    rlsBypass: false,
  }));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await admin.$disconnect();
  });
