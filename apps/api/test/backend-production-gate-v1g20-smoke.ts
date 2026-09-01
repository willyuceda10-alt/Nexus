import {
  Prisma,
} from '@prisma/client';

import {
  prisma,
} from '../src/db.js';

type RlsRow = {
  tableName:
    string;

  rlsEnabled:
    boolean;

  rlsForced:
    boolean;

  policyCount:
    number;
};

type CommentRow = {
  comment:
    string |
    null;
};

type MigrationRow = {
  migrationName:
    string;
};

type RuntimeRoleRow = {
  roleName:
    string;

  superuser:
    boolean;

  bypassRls:
    boolean;

  createRole:
    boolean;

  createDb:
    boolean;
};

function assert(
  condition:
    unknown,

  message:
    string,
): asserts condition {
  if (!condition) {
    throw new Error(
      message,
    );
  }
}

async function main() {
  const rows =
    await prisma.$queryRaw<
      RlsRow[]
    >(Prisma.sql`
      SELECT
        c.relname AS "tableName",
        c.relrowsecurity AS "rlsEnabled",
        c.relforcerowsecurity AS "rlsForced",
        COUNT(p.policyname)::int AS "policyCount"
      FROM pg_class c
      JOIN pg_namespace n
        ON n.oid =
          c.relnamespace
      JOIN information_schema.columns ic
        ON ic.table_schema =
          n.nspname
       AND ic.table_name =
          c.relname
       AND ic.column_name =
          'tenant_id'
      LEFT JOIN pg_policies p
        ON p.schemaname =
          n.nspname
       AND p.tablename =
          c.relname
      WHERE
        n.nspname =
          'public'
        AND c.relkind =
          'r'
      GROUP BY
        c.relname,
        c.relrowsecurity,
        c.relforcerowsecurity
      ORDER BY
        c.relname
    `);

  const intentionalExemptions =
    new Set([
      'outbox_tenant_partitions',
    ]);

  const unexpectedFailures =
    rows.filter(
      (row) =>
        !intentionalExemptions.has(
          row.tableName,
        ) &&
        !(
          row.rlsEnabled &&
          row.rlsForced &&
          row.policyCount > 0
        ),
    );

  assert(
    unexpectedFailures.length ===
      0,
    `Unexpected RLS failures: ${unexpectedFailures
      .map(
        (row) =>
          row.tableName,
      )
      .join(', ')}`,
  );

  const outbox =
    rows.find(
      (row) =>
        row.tableName ===
        'outbox_tenant_partitions',
    );

  assert(
    outbox,
    'Outbox control-plane table missing.',
  );

  assert(
    outbox.rlsEnabled ===
      false &&
    outbox.rlsForced ===
      false &&
    outbox.policyCount ===
      0,
    'Outbox control-plane RLS contract changed unexpectedly.',
  );

  const comments =
    await prisma.$queryRaw<
      CommentRow[]
    >(Prisma.sql`
      SELECT
        obj_description(
          'outbox_tenant_partitions'::regclass,
          'pg_class'
        ) AS comment
    `);

  const comment =
    comments[0]
      ?.comment ??
    '';

  assert(
    comment.includes(
      'control-plane',
    ),
    'Outbox control-plane exemption is not documented in PostgreSQL.',
  );

  const migrations =
    await prisma.$queryRaw<
      MigrationRow[]
    >(Prisma.sql`
      SELECT
        migration_name AS "migrationName"
      FROM
        _prisma_migrations
      WHERE
        finished_at IS NOT NULL
        AND rolled_back_at IS NULL
        AND migration_name IN (
          '20260901040000_project_risk_notification_preferences_v1g14',
          '20260901050000_project_risk_monitor_reliability_v1g18',
          '20260901160000_backend_production_gate_v1g20'
        )
      ORDER BY
        migration_name
    `);

  assert(
    migrations.length ===
      3,
    `Expected 3 production-gate migrations, found ${migrations.length}.`,
  );

  const roleRows =
    await prisma.$queryRaw<
      RuntimeRoleRow[]
    >(Prisma.sql`
      SELECT
        rolname AS "roleName",
        rolsuper AS superuser,
        rolbypassrls AS "bypassRls",
        rolcreaterole AS "createRole",
        rolcreatedb AS "createDb"
      FROM pg_roles
      WHERE
        rolname =
          'nexus_runtime'
    `);

  if (
    roleRows.length > 0
  ) {
    const role =
      roleRows[0]!;

    assert(
      !role.superuser,
      'Runtime role cannot be SUPERUSER.',
    );

    assert(
      !role.bypassRls,
      'Runtime role cannot BYPASSRLS.',
    );

    assert(
      !role.createRole,
      'Runtime role cannot CREATEROLE.',
    );

    assert(
      !role.createDb,
      'Runtime role cannot CREATEDB.',
    );
  }

  console.log(
    JSON.stringify({
      backendProductionGateV1g20:
        'PASS',

      tenantScopedTablesAudited:
        rows.length,

      unexpectedRlsFailures:
        unexpectedFailures.length,

      intentionalControlPlaneExemptions:
        [
          'outbox_tenant_partitions',
        ],

      outboxControlPlaneDocumented:
        true,

      g14MigrationRegistered:
        true,

      g18MigrationRegistered:
        true,

      g20MigrationRegistered:
        true,

      runtimeRoleSafe:
        roleRows.length ===
          0
          ? 'NOT_PROVISIONED_LOCALLY'
          : true,
    }),
  );
}

main()
  .catch(
    (error) => {
      console.error(
        error,
      );

      process.exitCode =
        1;
    },
  )
  .finally(
    async () => {
      await prisma
        .$disconnect();
    },
  );
