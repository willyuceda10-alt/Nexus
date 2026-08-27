# Bridata Work OS · Board Editor V1

## Objective

This block turns the Board + View Engine foundation into an editable Work OS surface without duplicating business data.

```text
NexusObject / ObjectFieldValue
            ↓
        Work Board
            ↓
   ┌────────┴────────┐
 Table View       Kanban View
```

The object remains the source of truth. Board placement, groups and view configuration are presentation/organization state.

## Implemented editor capabilities

- add existing objects to a Board without copying them;
- create custom columns from the UI;
- inline cell editing;
- move objects between Board Groups;
- Kanban drag and drop by status;
- saved filters per View;
- saved sorting per View;
- hidden columns per View;
- column order per View;
- create Groups from the editor;
- optimistic-concurrency protection through `NexusObject.version`;
- audit/domain event for cell writes.

## Cell ownership

CORE columns mutate the canonical `NexusObject` field.

Supported inline CORE writes in V1:

- title;
- description;
- status;
- priority;
- progress;
- assigneeId;
- startDate;
- dueDate.

Read-only CORE fields include ownerId, createdAt and updatedAt.

CUSTOM columns mutate `ObjectFieldValue` and increment the parent `NexusObject.version` in the same transaction.

Supported custom inline types:

- TEXT;
- LONG_TEXT;
- NUMBER;
- CURRENCY;
- DATE;
- BOOLEAN;
- STATUS;
- PRIORITY;
- PROGRESS;
- LINK.

PERSON, FILE, TAGS and FORMULA are intentionally not exposed as raw inline inputs in the visual editor yet. PERSON needs the governed people picker, FILE needs File Engine, TAGS needs a managed option editor, and FORMULA is read-only by design.

## View state

The following belongs to `work_views_v1.config`, not to the Board globally:

```json
{
  "filters": { "status": "IN_PROGRESS" },
  "sort": { "fieldKey": "dueDate", "direction": "asc" },
  "hiddenColumnKeys": ["priority"],
  "columnOrder": ["titulo", "estado", "responsable", "fecha_fin"]
}
```

This allows two Table Views over the same Board to have different presentation rules without duplicating objects or columns.

## Groups vs status

Board Group and object Status are deliberately different concepts.

Examples of Groups:

- Semana 35;
- Fase 2;
- Frusol 1;
- Yakuy Minka;
- Backlog comercial.

Kanban V1 is status-driven. Dragging a card between Kanban lanes changes the canonical object status. Changing the Group selector only changes the placement of that object inside the Board.

## Editor API

Additional endpoints:

```text
GET    /api/v1/work-os/boards-v1/:boardId/available-items
PATCH  /api/v1/work-os/boards-v1/:boardId/columns/:columnId
PATCH  /api/v1/work-os/boards-v1/:boardId/views/:viewId
PATCH  /api/v1/work-os/boards-v1/:boardId/groups/:groupId
PUT    /api/v1/work-os/boards-v1/:boardId/placements
DELETE /api/v1/work-os/boards-v1/:boardId/items/:objectId
PATCH  /api/v1/work-os/boards-v1/:boardId/items/:objectId/cells/:columnId
```

Removing an item from a Board deletes only its placement. It never deletes the underlying `NexusObject`.

## Concurrency

Every cell write requires the object version loaded by the client.

```text
client version 7
      ↓
UPDATE ... WHERE version = 7
      ↓
version 8
```

If another user already changed the object, the write returns `409 version_conflict` instead of silently overwriting their work.

CUSTOM field changes also increment the parent object version so core and custom edits share one concurrency boundary.

## Security

All editor operations remain tenant-scoped through `withTenant()` and the existing FORCE RLS model.

Read operations require workspace access. Mutating Board configuration, placements or cells requires workspace management permission.

Database triggers from Board Engine V1 continue enforcing that Board, Group and Object belong to compatible tenant/workspace/object-definition scopes.

## Current limits

- no governed PERSON picker yet;
- no File Engine picker yet;
- no managed status/tag option designer yet;
- no formula execution engine yet;
- no Calendar/Gantt/Timeline generic renderer yet;
- no row drag reorder within the Table UI yet;
- API session plumbing for the new editor helper should be consolidated into the shared `bridataApi` request layer when the web Entra token provider is activated.

These are explicit V1 limits, not mocked capabilities.

## Next logical block

Board Configuration & Option Engine:

1. managed status/options dictionary;
2. governed PERSON picker;
3. relation/connect-board column;
4. formula definition/evaluation;
5. generic Calendar View;
6. generic Timeline/Gantt projection;
7. Board templates and governance.
