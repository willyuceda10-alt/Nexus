-- Register MATERIAL as a system ObjectDefinition for every tenant that already exists.
-- Fresh environments also run prisma/seed-materials.ts after the core DEV seed.
INSERT INTO object_definitions (
  id,
  tenant_id,
  key,
  name,
  description,
  icon,
  schema,
  permissions,
  is_system,
  created_at,
  updated_at
)
SELECT
  gen_random_uuid(),
  t.id,
  'MATERIAL',
  'Material',
  'Material, insumo o componente requerido por un proyecto o actividad.',
  'package-search',
  '{"$schema":"https://json-schema.org/draft/2020-12/schema","title":"MATERIAL","type":"object","properties":{},"additionalProperties":true}'::jsonb,
  NULL,
  TRUE,
  now(),
  now()
FROM tenants t
WHERE NOT EXISTS (
  SELECT 1
  FROM object_definitions d
  WHERE d.tenant_id = t.id
    AND d.key = 'MATERIAL'
);
