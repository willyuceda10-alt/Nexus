# Bridata visual preview

This preview path is intentionally independent from GitHub Actions and Azure deployment.

## GitHub Codespaces

1. Open repository `willyuceda10-alt/Nexus`.
2. Select branch `feature/meeting-scheduling-v2`.
3. Use **Code -> Codespaces -> Create codespace on this branch**.
4. When the container is ready run:

```bash
npm run dev:web
```

5. Open forwarded port `3000` (`Bridata Web Preview`).

The preview defaults to `VITE_DATA_MODE=mock`, so visual review does not require PostgreSQL, Entra, Service Bus or Microsoft Graph.

## Local Windows

```powershell
git checkout feature/meeting-scheduling-v2
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
5. **Colaborar -> Reuniones -> Programación inteligente V2** — new recommended scheduling flow.
6. **Programar reunión** — internal participants, external guests, start/end and location.
7. **Sala** — one room maximum and visible capacity calculation.
8. **Equipamiento** — multiple equipment resources.
9. **Buscar horarios comunes** — people + room + equipment suggestions. Real lookup requires API mode.
10. **Teams / Outlook** — synchronization toggle and M365 availability prerequisite wording.
11. **Salas y recursos** — catalog and resource administration inherited from Meeting Resources V1.
12. **Reserva rápida** — manage resources on an existing meeting.
13. **Calendario mensual / Próximas reuniones** — agenda, join Teams, Outlook link and sync state.
14. **Derivar tarea / Decisiones** — collaboration governance continuity.
15. **Mi trabajo, Materiales, Costos, Automatizaciones, Configuración** — shared shell continuity.

## What mock mode proves

Mock mode proves layout, navigation and browser-local interactions only.

It does not prove:

- PostgreSQL migrations;
- FORCE RLS;
- authenticated API calls;
- Microsoft Graph availability;
- Exchange room booking;
- Teams meeting creation;
- Service Bus processing;
- concurrent resource booking guards.

## API mode prerequisites

```bash
VITE_DATA_MODE=api VITE_API_BASE_URL=https://<bridata-dev-api> npm run dev:web
```

Requires:

- Board/View, Meeting Collaboration and Meeting Resources migrations applied;
- Meeting Scheduling V2 overlap-guard migration applied;
- valid Bridata/Entra browser authentication;
- `configureApiSession()` connected to the real access-token provider;
- preview origin allowed by API CORS.

## Microsoft 365 prerequisites

For free/busy:

- API Managed Identity;
- approved least-privilege Graph calendar-read role for `getSchedule`;
- approved mailbox/resource scope;
- `M365_AVAILABILITY_ENABLED=true` only after DEV smoke tests.

For Outlook/Teams writes:

- `meetings-v1` Service Bus subscription;
- Meeting Calendar Worker;
- worker Managed Identity;
- Graph `Calendars.ReadWrite` application permission;
- approved Exchange mailbox/resource scope;
- `M365_CALENDAR_SYNC_ENABLED=true` only after validation.

Until these are enabled, users can still save meetings locally by disabling M365 synchronization.

## Azure shared preview

The long-lived shared environment remains Azure-first. Once Prisma/typecheck/tests/build and Bicep validation pass, use the existing Azure DEV foundation for stakeholder review rather than moving core hosting to another platform.
