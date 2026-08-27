# Bridata visual preview

This preview path is intentionally independent from GitHub Actions and from Azure deployment.

## Option A — GitHub Codespaces

1. Open repository `willyuceda10-alt/Nexus` in GitHub.
2. Select branch `feature/work-os-board-editor-v1`.
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

so it does not require PostgreSQL, Entra, Service Bus or the API. It is suitable for visual/UI review and the Board Editor mock interactions.

## Option B — local Windows browser

From a local clone of this branch:

```powershell
git checkout feature/work-os-board-editor-v1
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
4. **Tableros → Tabla principal** — double-click editable cells for supported field types.
5. **Tableros → Vista** — save status filter, sort, hidden columns and per-view column order.
6. **Tableros → + Columna** — create a custom Board column in mock mode.
7. **Tableros → + Grupo** — create operational grouping independent from object status.
8. **Tableros → Añadir elementos** — attach existing tasks without copying them.
9. **Tableros → Kanban** — drag a card to another status lane; the same object changes status.
10. **Mi trabajo, Materiales, Costos, Automatizaciones and Configuración** — verify continuity with the shared shell.

In mock mode the interactions are local to the browser session. In API mode the Board Editor uses the typed Board/View schema and existing NexusObject/ObjectFieldValue records.

## API mode

When the DEV API is available, use:

```bash
VITE_DATA_MODE=api VITE_API_BASE_URL=https://<bridata-dev-api> npm run dev:web
```

In API mode the browser needs a valid Bridata/Entra session and the API must allow the preview origin in CORS.

## Azure shared preview

The long-lived shared preview remains an Azure concern. Do not use Vercel/Railway for the Bridata core. Once the branch passes Prisma/typecheck/tests/build and Bicep validation, deploy the web/API DEV runtime to the existing Azure foundation and use that URL for stakeholder review.

## Important distinction

The Codespaces preview proves visual composition and mock interaction. It does **not** prove migrations, FORCE RLS, API authorization, concurrency, workers, Microsoft Graph permissions or production behavior.
