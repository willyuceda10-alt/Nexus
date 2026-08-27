# Bridata visual preview

This preview path is intentionally independent from GitHub Actions and from Azure deployment.

## Option A — GitHub Codespaces (fastest visual review)

1. Open repository `willyuceda10-alt/Nexus` in GitHub.
2. Select branch `feature/product-shell-redesign-v2`.
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

so it does not require PostgreSQL, Entra, Service Bus or the API. It is suitable for visual/UI review only.

## Option B — local Windows browser

From a local clone of this branch:

```powershell
git checkout feature/product-shell-redesign-v2
npm ci
$env:VITE_DATA_MODE="mock"
npm run dev:web
```

Then open:

```text
http://localhost:3000
```

## Redesign checkpoints

Review these flows first:

1. **Centro de mando** — operational hierarchy, portfolio pulse, attention and upcoming work.
2. **Proyectos** — workspace project catalog; it no longer jumps directly into the first project.
3. **Proyecto** — primary domains (`Resumen`, `Trabajo`, `Planificación`, `Costos`, `Riesgos`, `Reuniones`, `Documentos`).
4. **Trabajo** — Table/Kanban are alternate views of the same work model.
5. **Planificación** — Gantt/WBS and Timeline are alternate planning views.
6. **Sidebar/Header** — Empresa → Workspace → page/project context remains visible.
7. **Mi trabajo, Materiales, Costos, Automatizaciones and Configuración** — verify visual continuity with the new shell.

API-backed data mutation is not executed in mock mode.

## API mode

When the DEV API is available, use:

```bash
VITE_DATA_MODE=api VITE_API_BASE_URL=https://<bridata-dev-api> npm run dev:web
```

In API mode the browser needs a valid Bridata/Entra session and the API must allow the preview origin in CORS.

## Azure shared preview

The long-lived shared preview remains an Azure concern. Do not use Vercel/Railway for the Bridata core. Once the branch passes Prisma/typecheck/tests/build and Bicep validation, deploy the web/API DEV runtime to the existing Azure foundation and use that URL for stakeholder review.

## Important distinction

The Codespaces preview proves visual composition and navigation. It does **not** prove migrations, RLS, workers, Microsoft Graph permissions or production behavior.
