# Bridata visual preview

This preview path is intentionally independent from GitHub Actions and from Azure deployment.

## Option A — GitHub Codespaces

1. Open repository `willyuceda10-alt/Nexus` in GitHub.
2. Select branch `feature/work-os-calendar-timeline-teams-v1`.
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
git checkout feature/work-os-calendar-timeline-teams-v1
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
11. **Colaborar → Reuniones** — review the dedicated monthly meeting agenda.
12. **Reuniones → Agendar reunión** — review Bridata + Outlook/Teams form, attendees, online toggle and sync toggle.
13. **Reuniones → Próximas reuniones** — Teams/Outlook actions, sync badges, failure state and persistent derived-task action.
14. **Mi trabajo, Materiales, Costos, Automatizaciones and Configuración** — verify continuity with the shared shell.

In mock mode interactions are local to the browser session. Graph sync is intentionally simulated as unavailable: no real Outlook/Teams event is created in mock preview.

## API mode

When the DEV API is available, use:

```bash
VITE_DATA_MODE=api VITE_API_BASE_URL=https://<bridata-dev-api> npm run dev:web
```

API mode requires:

- Board/View, Board Configuration and Meeting Collaboration migrations applied;
- a valid Bridata/Entra browser session;
- `configureApiSession()` wired to a real access-token provider;
- preview origin allowed by API CORS.

The current frontend injects tenant context after bootstrap, but the real Entra access-token provider is still a pending integration. Do not use the mock preview as proof of API authentication.

## Microsoft 365 meeting preview

The visual UI can be reviewed in mock mode, but real Teams/Outlook synchronization additionally requires:

- Azure Service Bus domain-events topic;
- `meetings-v1` subscription;
- Meeting Calendar worker deployed;
- worker Managed Identity;
- Microsoft Graph `Calendars.ReadWrite` application permission;
- approved mailbox/resource scoping;
- API capability flags configured consistently;
- `M365_CALENDAR_SYNC_ENABLED=true` only after validation.

Until those prerequisites are met, Bridata meetings remain usable as `LOCAL_ONLY`.

## Azure shared preview

The long-lived shared preview remains an Azure concern. Do not move Bridata core hosting to Vercel/Railway. Once the branch passes Prisma/typecheck/tests/build and Bicep validation, deploy the web/API DEV runtime to the existing Azure foundation and use that Azure URL for stakeholder review.

## Important distinction

The Codespaces preview proves visual composition and mock interaction. It does **not** prove migrations, FORCE RLS, API authorization, concurrency, workers, Microsoft Graph permissions, Teams meeting creation or production behavior.
