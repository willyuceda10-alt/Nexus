# Bridata Project

**Bridata Project** es una plataforma SaaS empresarial para planificación, ejecución, portafolios, gobernanza, riesgos, decisiones, aprobaciones, automatización e inteligencia operativa.

El objetivo del producto es evolucionar desde la gestión tradicional basada únicamente en tableros hacia un **Enterprise Project Execution Platform** donde proyectos, tareas, hitos, riesgos, decisiones, documentos, cambios y otros objetos de negocio estén relacionados dentro de un mismo motor.

## Marca vs. nombres técnicos

- **Producto visible:** Bridata Project
- **Empresa / marca:** Bridata
- **Motor técnico heredado:** Nexus Object Engine
- Clases y tablas como `NexusObject` se conservan temporalmente como identificadores internos para evitar una refactorización riesgosa del dominio mientras se construye el núcleo productivo.

## Arquitectura actual

```text
Bridata Project
├── Web (React + Vite + TypeScript)
├── API (Fastify + TypeScript)
├── PostgreSQL + Prisma
│   ├── Multi-tenancy
│   ├── Row Level Security
│   ├── Audit Log
│   └── Transactional Outbox
├── Azure IaC (Bicep)
└── GitHub Actions
```

La estrategia inicial es un **modular monolith** con límites claros. Los módulos con carga o ciclos de despliegue independientes podrán extraerse después como workers/servicios, por ejemplo Microsoft 365, notificaciones, automatizaciones, AI y analytics.

## Desarrollo local

Requisitos:

- Node.js 22+
- PostgreSQL 16+

```bash
npm ci
npm run prisma:generate
npm run prisma:migrate:deploy
npm run prisma:seed:dev
npm run dev:web
npm run dev:api
```

## Quality gates

```bash
npm run prisma:validate
npm run typecheck
npm test
npm run build
npm audit --omit=dev --audit-level=high
```

GitHub Actions valida además la infraestructura Bicep antes de permitir que los cambios lleguen a `main`.

## Seguridad

- Aislamiento multi-tenant en aplicación y PostgreSQL RLS.
- `FORCE ROW LEVEL SECURITY` en tablas tenant-scoped.
- Autenticación preparada para Microsoft Entra ID.
- Secretos de integraciones destinados a Azure Key Vault, no a PostgreSQL.
- La identidad `nexus-github-deploy` se reserva para CI/CD y no se reutiliza como identidad runtime.
- Auditoría y Domain Events para operaciones relevantes.

## Integraciones previstas

La capa `IntegrationConnection` está preparada para conectar Bridata Project con:

- Microsoft 365: Outlook, Teams, Planner y SharePoint
- SAP
- GitHub
- Slack
- Google Workspace
- Conectores empresariales personalizados

## Azure

La infraestructura versionada está en `infra/azure/`. La existencia del código Bicep **no implica que todos los recursos estén desplegados**: DEV se aprovisionará de forma controlada para evitar costos innecesarios durante la construcción.

## Estado

Bridata Project se encuentra en construcción activa. La interfaz existente aún utiliza datos mock en varias superficies; el trabajo de Core V2 está reemplazando progresivamente esas simulaciones por API, persistencia, autorización y eventos reales.
