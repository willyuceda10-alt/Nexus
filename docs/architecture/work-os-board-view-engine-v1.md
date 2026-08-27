# Work OS Board + View Engine V1

## Goal

Build Bridata's configurable work-management layer without duplicating the enterprise domain model.

The core rule is:

```text
NexusObject = source of truth
Board       = organization/configuration
View        = representation
```

A task, risk, incident or other object is not cloned when it appears in a Board or when the user switches from Table to Kanban.

## Relationship to the typed engines

The Board Engine does not replace Project Engine, Material/Inventory Engine, Cost Engine or Automation Engine.

```text
                         BRIDATA WORK OS
                              │
                    Board + View configuration
                              │
                    Universal Object Engine
                       /      |       \
              Project V2  Material V2  Cost V2
```

Typed engines continue to own deep operational truth such as scheduling, inventory ledgers and project controlling.

## Data model

V1 introduces:

- `work_boards_v1`
- `work_board_groups_v1`
- `work_board_columns_v1`
- `work_views_v1`
- `work_board_item_placements_v1`

A Board targets one `ObjectDefinition` inside one Workspace.

A placement links an existing `NexusObject` to a Board and stores only:

- Board membership;
- Group;
- Sort order.

It never copies title, status, owner, dates or custom values.

## Columns

Board columns have two sources:

### CORE

Mapped to stable `NexusObject` properties:

- title
- description
- status
- priority
- progress
- ownerId
- assigneeId
- startDate
- dueDate
- createdAt
- updatedAt

### CUSTOM

Mapped to `ObjectFieldValue.fieldKey`.

V1 validates field keys and blocks prototype-pollution/reserved names.

Formula columns are declared in the type system but raw formula execution is deliberately not enabled in V1.

## Views

Persisted view types:

- TABLE
- KANBAN
- CALENDAR
- GANTT
- TIMELINE

V1 UI renders TABLE and KANBAN.

The other view types are already represented in the model so future visualizations reuse the same Board data rather than creating separate modules.

View configuration is a closed schema. Arbitrary JavaScript is not accepted.

Examples:

```json
{
  "kanbanColumnKey": "status"
}
```

```json
{
  "startFieldKey": "startDate",
  "endFieldKey": "dueDate"
}
```

## Groups

Groups are Board-specific organization containers. They do not change the underlying object status unless an automation or explicit object update does so.

This keeps the concepts separate:

```text
Group = visual/organizational section
Status = object business field
```

## Default Board creation

Creating a Board automatically creates:

Groups:
- Pendiente
- En curso
- Completado

Core columns:
- Elemento
- Estado
- Responsable
- Fecha objetivo
- Avance

Views:
- Tabla principal
- Kanban

## Security

All new tables are immediately protected with PostgreSQL RLS + FORCE RLS.

The runtime database role remains non-superuser and non-BYPASSRLS.

API authorization uses Authorization V2:

- read Board: `workspace.read` compatibility path;
- create/configure/place items: `workspace.manage` compatibility path.

The migration also installs PostgreSQL integrity guards that reject:

- Board connected to another tenant's Workspace or ObjectDefinition;
- Group/Column/View connected to a Board in another tenant;
- item placement where object tenant differs;
- item placement where object Workspace differs;
- item placement where object definition differs;
- item placement into a Group from another Board.

## API

```text
GET  /api/v1/work-os/boards-v1?workspaceId=<uuid>
POST /api/v1/work-os/boards-v1
GET  /api/v1/work-os/boards-v1/:boardId
GET  /api/v1/work-os/boards-v1/:boardId/data

POST /api/v1/work-os/boards-v1/:boardId/groups
POST /api/v1/work-os/boards-v1/:boardId/columns
POST /api/v1/work-os/boards-v1/:boardId/views
POST /api/v1/work-os/boards-v1/:boardId/items
PATCH /api/v1/work-os/boards-v1/:boardId/items/:objectId
```

## UI

The product shell now exposes `Tableros` under Planificar.

The first visual workspace provides:

- Board catalog;
- active Board header;
- view selector;
- Board search;
- grouped Table representation;
- Kanban representation;
- Board creation against a real `ObjectDefinition` in API mode;
- mock visual preview without backend infrastructure.

## Deliberate V1 limits

Not yet enabled:

- drag/drop persistence;
- inline cell writes for custom fields;
- column creation UI;
- filter/sort builder;
- Calendar rendering;
- generic Gantt rendering;
- Timeline rendering;
- folders/subfolders;
- templates/governance catalog;
- dashboard widget builder.

Those will layer on top of this model instead of introducing new object stores.

## Validation status

The code and tests are versioned, but Prisma validation, generated client, TypeScript typecheck, tests, web build and migration smoke tests must be executed before Azure deployment.
