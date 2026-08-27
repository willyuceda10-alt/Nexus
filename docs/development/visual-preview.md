# Bridata visual preview

This preview path is intentionally independent from GitHub Actions and from Azure deployment.

## Option A — GitHub Codespaces

1. Open repository `willyuceda10-alt/Nexus` in GitHub.
2. Select branch `feature/work-os-board-config-options-v1`.
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
git checkout feature/work-os-board-config-options-v1
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
5. **Tableros → Vista** — status filter, sort, hidden columns and per-view column order.
6. **Tableros → + Columna** — create simple custom columns.
7. **Tableros → Modelo de datos** — open the new governed configuration panel.
8. **Modelo de datos → Personas** — review workspace-member picker population.
9. **Modelo de datos → Opciones administradas** — edit `CODIGO|Etiqueta|#color` dictionaries without changing canonical keys.
10. **Modelo de datos → Conectar tableros** — create RELATION columns backed by ObjectRelation.
11. **Modelo de datos → Fórmula segura** — create arithmetic computed columns.
12. **Tableros → Kanban** — drag a card between status lanes; governed status rules remain shared with Table.
13. **Mi trabajo, Materiales, Costos, Automatizaciones and Configuración** — verify continuity with the shared shell.

In mock mode the interactions are local to the browser session. PERSON/RELATION/formula behavior is visually simulated for design review. Persistence, RLS and server-side governance require API mode.

## API mode

When the DEV API is available, use:

```bash
VITE_DATA_MODE=api VITE_API_BASE_URL=https://<bridata-dev-api> npm run dev:web
```

API mode requires:

- the Board/View and Board Configuration migrations applied;
- a valid Bridata/Entra browser session;
- `configureApiSession()` wired to a real access-token provider;
- the preview origin allowed by API CORS.

The current frontend already injects tenant context after bootstrap, but the real Entra access-token provider is still a pending integration. Do not use the mock preview as proof of API authentication.

## Azure shared preview

The long-lived shared preview remains an Azure concern. Do not move Bridata core hosting to Vercel/Railway. Once the branch passes Prisma/typecheck/tests/build and Bicep validation, deploy the web/API DEV runtime to the existing Azure foundation and use that Azure URL for stakeholder review.

## Important distinction

The Codespaces preview proves visual composition and mock interaction. It does **not** prove migrations, FORCE RLS, API authorization, concurrency, workers, Microsoft Graph permissions or production behavior.
