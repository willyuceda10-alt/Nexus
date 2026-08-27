# Bridata Work OS · Board Configuration & Option Engine V1

## Objective

This block evolves Board Editor V1 from editable generic cells into a governed enterprise data model.

```text
NexusObject / ObjectFieldValue / ObjectRelation
                    ↓
               Work Board V1
                    ↓
       ┌────────────┼────────────┐
       │            │            │
   Managed       People      Relations
   options        picker       between
                              boards
       └────────────┼────────────┘
                    ↓
              Safe formulas
                    ↓
             Table / Kanban
```

The Board remains a configuration and projection layer. Project Engine, Material Engine and Cost Engine remain typed domain systems of record for their respective enterprise concerns.

## Managed option dictionaries

STATUS, PRIORITY and TAGS columns can own a persistent option dictionary.

Tables:

```text
work_board_option_sets_v1
work_board_options_v1
```

Each option has:

- a stable canonical `key`;
- a user-facing `label`;
- an optional visual `color`;
- a stable sort order;
- `is_active` lifecycle state.

The key and label are intentionally separate. Renaming `IN_PROGRESS` from "En curso" to "En ejecución" does not rewrite historical object values.

Removing an option from the active dictionary marks it inactive. It is not physically deleted, preserving historical meaning.

### Server enforcement

Governance is not implemented only in React. Managed option cell writes are validated by the API against the active dictionary.

```text
PATCH /api/v1/work-os/boards-v1/:boardId/items/:objectId/managed-option-cells/:columnId
```

Unknown or inactive keys are rejected. CORE status/priority values cannot be cleared to a hidden default. CORE managed-option mappings outside canonical `status` and `priority` fields are rejected.

The previous experimental `/options` endpoint is explicitly disabled with HTTP 410. The governed contract is:

```text
PUT /api/v1/work-os/boards-v1/:boardId/columns/:columnId/managed-options
```

## PERSON picker

PERSON columns no longer accept arbitrary UUID text in the governed table.

Eligible users are derived from active workspace membership plus active tenant membership.

```text
WorkspaceMember
   + active User
   + active TenantMembership
            ↓
       PERSON picker
```

The API validates membership again during every write.

CORE PERSON currently supports `assigneeId`. CUSTOM PERSON values use `ObjectFieldValue.valueText` and are versioned through the parent NexusObject.

## Connect Boards / RELATION columns

A new `RELATION` column type connects objects already present in another Work Board.

Creating a relation column stores configuration:

```json
{
  "targetBoardId": "...",
  "relationType": "BOARD_LINK:<column-uuid>",
  "multiple": false
}
```

The actual relationship remains canonical `ObjectRelation` data. The Board does not copy the target object.

Relation writes verify:

- same tenant;
- same workspace;
- source is placed in the source Board;
- target is placed in the configured target Board;
- self relation is rejected;
- duplicates are rejected;
- single/multiple cardinality is enforced;
- optimistic object version matches.

The computed read model also joins through the configured target Board placement. Therefore a malformed same-tenant ObjectRelation created outside the Board API cannot leak an unrelated target through the Board projection.

## Formula Engine V1

FORMULA columns are computed, read-only projections.

There is no user JavaScript, `eval`, template execution or arbitrary expression language.

Supported AST:

```text
FIELD(fieldKey)
LITERAL(number)
BINARY(
  ADD | SUBTRACT | MULTIPLY | DIVIDE | MIN | MAX,
  left,
  right
)
```

Validation limits:

- safe field-key pattern;
- numeric fields only;
- self-reference blocked;
- maximum depth 8;
- maximum nodes 32;
- finite numeric literals;
- fixed operator allowlist.

Division by zero returns `null` instead of throwing or producing Infinity.

Current numeric sources are PROGRESS, NUMBER and CURRENCY fields. Formula-to-formula references are intentionally not enabled in V1, avoiding dependency cycles until a formula dependency graph is introduced.

Endpoint:

```text
GET /api/v1/work-os/boards-v1/:boardId/computed-values
```

The same endpoint also projects RELATION display values.

## Concurrency

PERSON, RELATION and managed-option writes use the same `NexusObject.version` boundary as Board Editor V1.

```text
client version N
      ↓
write WHERE version = N
      ↓
version N + 1
```

A conflicting write returns HTTP 409 instead of silently overwriting another user's update.

## RLS and database integrity

New option tables are created with:

```text
ENABLE ROW LEVEL SECURITY
FORCE ROW LEVEL SECURITY
```

and tenant-isolation policies using `nexus_current_tenant_id()`.

Database triggers additionally enforce:

- OptionSet tenant matches Board and Column tenant;
- OptionSet Board matches Column Board;
- only STATUS/PRIORITY/TAGS columns can own dictionaries;
- TAGS dictionaries are always multiple;
- option tenant matches OptionSet tenant.

Prisma multi-file models now include the Board → OptionSet and Column → OptionSet relations represented by the migration FKs, preventing schema drift from those constraints.

## UI

The active Boards screen is now `WorkBoardsConfigOptionsV1View`.

New **Modelo de datos** panel includes:

1. workspace people preview;
2. managed option dictionary editor;
3. Connect Boards column creator;
4. safe Formula column creator.

The dictionary editor uses an explicit canonical representation:

```text
DRAFT|Borrador|#94a3b8
IN_PROGRESS|En curso|#16a34a
COMPLETED|Completado|#059669
```

Changing the visible label does not regenerate or lowercase the technical key.

The governed Table renderer provides dedicated controls for PERSON, RELATION and TAGS. Formula cells are read only.

Kanban status mutations use the same managed-option endpoint whenever the status column has a dictionary, so Table and Kanban cannot apply different data-governance rules.

## API surface

```text
GET  /api/v1/work-os/boards-v1/:boardId/configuration
PUT  /api/v1/work-os/boards-v1/:boardId/columns/:columnId/managed-options
PATCH /api/v1/work-os/boards-v1/:boardId/items/:objectId/managed-option-cells/:columnId
POST /api/v1/work-os/boards-v1/:boardId/relation-columns
POST /api/v1/work-os/boards-v1/:boardId/formula-columns
GET  /api/v1/work-os/boards-v1/:boardId/columns/:columnId/relation-candidates
PUT  /api/v1/work-os/boards-v1/:boardId/items/:objectId/relations/:columnId
PATCH /api/v1/work-os/boards-v1/:boardId/items/:objectId/person-cells/:columnId
GET  /api/v1/work-os/boards-v1/:boardId/computed-values
```

## Validation status

Code, migrations and unit-test sources are versioned, but the following have not been executed in this branch yet:

```text
prisma validate
prisma generate
API typecheck
web typecheck
unit tests
web build
migration deploy
Azure deployment
```

Do not treat this branch as runtime-validated until those commands run successfully.

The web client currently configures tenant context after bootstrap. A real Entra access-token provider still needs to be wired into `configureApiSession()` for authenticated browser API mode. Mock preview does not require it.

## Current V1 limits

- no formula-to-formula dependency graph;
- no text/date formula operations;
- no lookup/rollup formula across relations;
- no governed user groups/teams picker yet;
- RELATION targets are Board items, not arbitrary tenant objects;
- no generic Calendar/Timeline renderer yet;
- no Board templates/governance catalog yet.

## Next block

After runtime validation, the next Work OS slice should be Generic Calendar + Timeline View Engine using persisted view configuration and existing Board columns as structural mappings.
