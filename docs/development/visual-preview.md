# Bridata visual preview

This preview path is intentionally independent from GitHub Actions and Azure deployment.

## GitHub Codespaces

1. Open repository `willyuceda10-alt/Nexus`.
2. Select branch `feature/recurring-meetings-v1`.
3. Use **Code -> Codespaces -> Create codespace on this branch**.
4. When the container is ready run:

```bash
npm run dev:web
```

5. Open forwarded port `3000` (`Bridata Web Preview`).

The preview defaults to `VITE_DATA_MODE=mock`, so visual review does not require PostgreSQL, Entra, Service Bus or Microsoft Graph.

## Local Windows

```powershell
git checkout feature/recurring-meetings-v1
npm ci
$env:VITE_DATA_MODE="mock"
npm run dev:web
```

Open `http://localhost:3000`.

## Review checkpoints

1. **Centro de mando** — shell, hierarchy and visual system.
2. **Proyectos** — workspace project catalog and project context.
3. **Tableros** — Table/Kanban/Model editor.
4. **Planificar -> Calendario y Timeline** — generic WorkView temporal projection.
5. **Colaborar -> Reuniones -> Agenda canónica** — API mode only: one calendar projection combining simple meetings and materialized recurring occurrences without duplicating the recurring master.
6. **Agenda canónica -> excepción/cancelación** — moved occurrence appears on its current date; cancelled occurrence stays visible as history. Recurring entries deliberately do not expose a Teams/Outlook link until occurrence-link behavior is Graph-smoke-tested.
7. **Recurring Meetings V1** — recurring-series management layer.
8. **Crear serie** — title, description, participants, external guests, one room, equipment, start/end and M365 toggle.
9. **Patrón** — Daily, Weekly or absolute Monthly by day-of-month **1 through 28 only** in V1.
10. **Rango** — numbered occurrences or end date only.
11. **Serie existente** — expand occurrences and inspect sequence/date/status/exception marker.
12. **Mover esta** — reschedule exactly one occurrence as an exception.
13. **Cancelar esta** — cancel exactly one occurrence without cancelling the series.
14. **Reprogramar serie** — series-wide time shift before any exceptions/cancellations exist.
15. **Cancelar serie** — canonical whole-series lifecycle action.
16. **Meeting Lifecycle V2** — normal meeting reschedule/cancel continuity.
17. **Programación inteligente V2** — people + room + equipment + Teams scheduling flow.
18. **Salas y recursos** — resource catalog and booking administration.
19. **Calendario mensual / Próximas reuniones** — existing meeting-center agenda, Teams/Outlook actions and sync state.
20. **Derivar tarea / Decisiones** — collaboration governance continuity.
21. **Mi trabajo, Materiales, Costos, Automatizaciones, Configuración** — shared shell continuity.

## What mock mode proves

Mock mode proves layout, navigation and browser-local interactions only. Recurring Meetings V1 intentionally does not create fake recurring series in mock mode; persistent series creation, canonical mixed-calendar projection and occurrence lifecycle operations require API mode.

It does not prove:

- PostgreSQL recurring migrations;
- RLS / FORCE RLS;
- cross-booking concurrency guards;
- authenticated API calls;
- canonical mixed-calendar projection queries;
- Microsoft Graph availability;
- Outlook recurring series creation;
- Graph `/instances` resolution;
- occurrence exception/cancellation synchronization;
- Teams recurring meeting behavior;
- Service Bus processing.

## API mode prerequisites

```bash
VITE_DATA_MODE=api VITE_API_BASE_URL=https://<bridata-dev-api> npm run dev:web
```

Requires:

- Board/View, Meeting Collaboration and Meeting Resources migrations applied;
- Meeting Scheduling V2 overlap-guard migration applied;
- Meeting Lifecycle V2 migrations applied;
- Recurring Meetings V1 migrations applied, including occurrence version/lifecycle, monthly 1..28 constraint and master-sync guard;
- valid Bridata/Entra browser authentication;
- `configureApiSession()` connected to the real access-token provider before authenticated browser API review;
- preview origin allowed by API CORS.

## Microsoft 365 prerequisites

For free/busy and recurring availability validation:

- API Managed Identity;
- approved least-privilege Graph calendar-read role for `getSchedule`;
- approved mailbox/resource scope;
- `M365_AVAILABILITY_ENABLED=true` only after DEV smoke tests.

For Outlook/Teams recurring create/update/cancel:

- `meetings-v1` Service Bus subscription;
- Meeting Calendar Worker;
- worker Managed Identity;
- Graph `Calendars.ReadWrite` application permission;
- approved Exchange mailbox/resource scope;
- `M365_CALENDAR_SYNC_ENABLED=true` only after validation.

Recurring Graph instance resolution requests use `Prefer: outlook.timezone="SA Pacific Standard Time"` so the worker resolves Lima occurrences consistently.

Until M365 is enabled, local-only recurring series can be created and managed inside Bridata. A series that has already entered M365 synchronization cannot create occurrence-level exceptions until its Outlook series master has a Graph event id.

## Azure shared preview

The long-lived shared environment remains Azure-first. Once Prisma/typecheck/tests/build and Bicep validation pass, use the existing Azure DEV foundation for stakeholder review rather than moving core hosting to another platform.
