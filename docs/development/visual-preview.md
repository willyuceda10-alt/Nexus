# Bridata visual preview

This preview path is intentionally independent from GitHub Actions and from Azure deployment.

## Option A — GitHub Codespaces

1. Open repository `willyuceda10-alt/Nexus` in GitHub.
2. Select branch `feature/meeting-resources-v1`.
3. Click **Code → Codespaces → Create codespace on this branch**.
4. Wait for the dev container to finish `npm ci`.
5. In the Codespaces terminal run:

```bash
npm run dev:web
```

6. Codespaces forwards port `3000` and opens **Bridata Web Preview**.

The default preview uses:

```text
VITE_DATA_MODE=mock
```

so it does not require PostgreSQL, Entra, Service Bus or the API. It is suitable for visual/UI review and local mock interactions.

## Option B — local Windows browser

From a local clone of this branch:

```powershell
git checkout feature/meeting-resources-v1
npm ci
$env:VITE_DATA_MODE="mock"
npm run dev:web
```

Then open:

```text
http://localhost:3000
```

## Current review checkpoints

Review these flows first:

1. **Centro de mando** — product shell and workspace hierarchy.
2. **Proyectos** — workspace project catalog and project context.
3. **Tableros** — Work OS Board Editor under Planificar.
4. **Tableros → Tabla principal** — editable governed cells and Group selection.
5. **Tableros → Modelo de datos** — PERSON, managed options, RELATION and safe formulas.
6. **Tableros → Kanban** — governed status drag/drop.
7. **Planificar → Calendario y Timeline** — select a Board and switch between temporal views.
8. **Calendario y Timeline → Nueva vista** — choose start/end fields, displayed title and semantic color field.
9. **Calendario mensual** — open a source object from a calendar entry.
10. **Timeline** — confirm the same object set is represented as ranges without CPM logic.
11. **Colaborar → Reuniones → Salas y recursos** — review the new resource catalog before the meeting agenda.
12. **Nuevo recurso** — switch ROOM/EQUIPMENT and review mailbox, location, capacity and features fields.
13. **Reserva rápida** — choose a meeting and select one or more active room/equipment cards.
14. **Validar disponibilidad** — review combined people+resource free/busy. Real Graph lookup is disabled in mock mode.
15. **Asignar recursos** — API mode replaces the meeting booking and emits M365 resynchronization when available.
16. **Reuniones → Agendar reunión** — review the V2 meeting dialog.
17. **Participantes Bridata** — search/select internal workspace people; mock mode uses preview users and API mode uses governed workspace membership.
18. **Invitados externos** — verify external emails remain visually separated from governed internal participants.
19. **Disponibilidad M365** — review the people-only creation assistant and its privacy wording.
20. **Reuniones → Próximas reuniones** — Teams/Outlook actions, sync badges, failure state and persistent derived-task action.
21. **Mi trabajo, Materiales, Costos, Automatizaciones and Configuración** — verify continuity with the shared shell.

In mock mode interactions are local to the browser session. Sample rooms/equipment are visual only. Graph sync, real resource booking and free/busy lookup are intentionally unavailable: no Outlook calendar is read and no Teams event is created.

## API mode

When the DEV API is available, use:

```bash
VITE_DATA_MODE=api VITE_API_BASE_URL=https://<bridata-dev-api> npm run dev:web
```

API mode requires:

- Board/View, Board Configuration, Meeting Collaboration and Meeting Resources migrations applied;
- a valid Bridata/Entra browser session;
- `configureApiSession()` wired to a real access-token provider;
- preview origin allowed by API CORS.

The current frontend injects tenant context after bootstrap, but the real Entra access-token provider is still a pending integration. Specialized Calendar/Meeting helpers are therefore not yet proof of authenticated production API mode.

## Microsoft 365 meeting preview

The visual UI can be reviewed in mock mode, but real Teams/Outlook synchronization additionally requires:

- Azure Service Bus domain-events topic;
- `meetings-v1` subscription;
- Meeting Calendar worker deployed;
- worker Managed Identity;
- Microsoft Graph `Calendars.ReadWrite` application permission;
- approved mailbox/resource scoping;
- resource mailboxes already provisioned in Exchange;
- API capability flags configured consistently;
- `M365_CALENDAR_SYNC_ENABLED=true` only after validation.

Until those prerequisites are met, Bridata meetings and resource bookings remain valid locally.

## Microsoft 365 availability preview

Real people+room/equipment free/busy suggestions additionally require:

- the API user-assigned Managed Identity;
- the narrowest validated Graph calendar-read application role for `getSchedule`;
- approved mailbox/resource scope;
- a successful DEV `getSchedule` smoke test with at least one room mailbox;
- `M365_AVAILABILITY_ENABLED=true` only after that validation.

`infra/azure/grant-meeting-availability-graph.ps1` is dry-run by default and never escalates automatically to a broader permission.

## Azure shared preview

The long-lived shared preview remains an Azure concern. Do not move Bridata core hosting to Vercel/Railway. Once the branch passes Prisma/typecheck/tests/build and Bicep validation, deploy the web/API DEV runtime to the existing Azure foundation and use that Azure URL for stakeholder review.

## Important distinction

The Codespaces preview proves visual composition and mock interaction. It does **not** prove migrations, FORCE RLS, API authorization, concurrency, workers, Microsoft Graph permissions, free/busy retrieval, resource mailbox booking, Teams meeting creation or production behavior.
