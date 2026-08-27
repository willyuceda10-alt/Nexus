# Material / Inventory Engine V2

## Objective

Material / Inventory Engine V2 replaces `customFields` as the operational system of record for stock, reservations, purchasing and receipts while preserving the existing `MATERIAL` NexusObject as the collaboration identity.

The core causality is:

`Material requirement -> inventory availability -> reservation / purchase -> expected availability -> task risk -> project visibility`

The engine is additive. Existing MATERIAL objects and the legacy MaterialsView remain available during migration.

## Domain boundary

### Object Engine remains responsible for

- MATERIAL object identity and title
- ownership, comments and attachments
- workspace visibility
- generic collaboration and search

### Material / Inventory Engine V2 owns

- unit of measure
- material master code and base UOM
- warehouses
- suppliers
- material requirements linked to project / work item
- stock reservations
- purchase requisitions
- purchase orders
- goods receipts
- inventory ledger
- projected material availability
- material risk on scheduled work

## Typed tables

- `unit_of_measures`
- `material_masters`
- `warehouses`
- `suppliers`
- `material_requirements`
- `stock_reservations`
- `purchase_requisitions`
- `purchase_requisition_lines`
- `purchase_orders`
- `purchase_order_lines`
- `goods_receipts`
- `goods_receipt_lines`
- `inventory_movements`

Every table is tenant-owned and has PostgreSQL `ENABLE ROW LEVEL SECURITY` plus `FORCE ROW LEVEL SECURITY` with the same fail-closed tenant policy used by Project Engine V2.

## Inventory ledger

Stock is never stored as an editable balance.

`OnHand = RECEIPT + TRANSFER_IN + ADJUSTMENT_IN - ISSUE - TRANSFER_OUT - ADJUSTMENT_OUT`

`Reserved = open stock reservations`

`Available = max(0, OnHand - Reserved)`

This gives an auditable inventory trail and prevents a stale mutable balance from becoming the source of truth.

## Reservation concurrency

API prechecks improve error messages, but correctness is enforced again in PostgreSQL.

A database trigger takes a transaction-scoped advisory lock keyed by:

`tenant + warehouse + material`

The trigger then recalculates stock and reservations immediately before an insert. Two concurrent users therefore cannot reserve or issue the same free stock successfully.

Outbound movements apply the same lock and database revalidation.

## Requirements and WBS

A material requirement contains:

- project ID
- optional work item ID
- material master ID
- preferred warehouse
- required quantity
- required date
- priority
- operational status

When a work item is supplied, the API verifies that it belongs to the specified project and workspace.

This is the bridge between the Project Engine and the Material Engine.

## Requirement states

Persistent requirement status:

- `OPEN`
- `PARTIALLY_ALLOCATED`
- `ALLOCATED`
- `FULFILLED`
- `CANCELLED`

Availability/read-model state:

- `FULFILLED`
- `RESERVED`
- `AVAILABLE`
- `ON_ORDER`
- `LATE`
- `SHORTAGE`

Risk levels:

- `NONE`
- `WATCH`
- `HIGH`
- `CRITICAL`

The availability engine distinguishes the requirement's own reservation from reservations belonging to other demand. Competing reservations consume free stock and are never counted as supply for the current task.

## Purchase supply

Only outstanding purchase-order lines explicitly linked to a requirement are counted as projected supply for that requirement.

This deliberately avoids allocating the same generic purchase order quantity to multiple requirements in the risk calculation.

A future allocation engine may support explicit supply pegging across requirements, but V2 does not infer that relationship.

## Project risk

`GET /api/v1/material-engine-v2/overview` creates a read model that combines:

- requirement
- material
- WBS/task
- warehouse
- inventory ledger
- reservations
- linked purchase orders
- projected availability date

If projected availability is after the required date, the requirement is `LATE` and the task is at risk.

If projected supply cannot cover the remaining quantity, it is `SHORTAGE` and the task is at risk.

The endpoint returns `taskRiskIds` so project views can surface material blockers without copying risk state into NexusObject metadata.

## Gantt integration

`ProjectMaterialRiskStrip` is displayed above the WBS + Gantt V2 editor in API mode.

It shows:

- affected tasks
- shortages
- open purchase orders
- total deficit quantity
- selected WBS/material risk chips

This release intentionally does **not** move CPM dates automatically based on material availability. Material risk is an operational constraint overlay. Automatic material-constrained rescheduling will only be enabled after the risk and supply-pegging model is validated.

## API

### Setup / master data

- `GET /api/v1/material-engine-v2/setup`
- `POST /api/v1/material-engine-v2/materials/sync`
- `POST /api/v1/material-engine-v2/warehouses`
- `POST /api/v1/material-engine-v2/suppliers`
- `POST /api/v1/material-engine-v2/backfill`

### Operations

- `POST /api/v1/material-engine-v2/requirements`
- `POST /api/v1/material-engine-v2/reservations`
- `POST /api/v1/material-engine-v2/purchase-requisitions`
- `POST /api/v1/material-engine-v2/purchase-orders`
- `POST /api/v1/material-engine-v2/goods-receipts`
- `POST /api/v1/material-engine-v2/issues`

### Read model

- `GET /api/v1/material-engine-v2/overview`

## Legacy migration

The backfill is tenant/workspace scoped and defaults to `dryRun=true`.

It discovers existing `MATERIAL` NexusObjects and creates missing `MaterialMaster` rows. It does not delete or rewrite the NexusObject and does not perform migration-time cross-tenant reads.

Legacy `customFields` can remain readable during transition but must not be extended as the permanent inventory/procurement system of record.

## Frontend

`MaterialsInventoryV2View` is the API-mode materials module.

It exposes:

- migration status
- requirement and risk KPIs
- requirement table
- stock by warehouse
- create material
- create warehouse
- create requirement
- reserve stock
- create purchase order
- receive material
- issue/consume material

Non-API/mock mode retains the legacy `MaterialsView` so development fixtures are not broken.

## Prisma organization

The repository uses Prisma 6.12. Material / Inventory Engine models are projected in a separate `prisma/material-inventory-v2.prisma` file and package configuration points Prisma at the `prisma/` schema directory.

The models intentionally use scalar foreign-key fields rather than duplicating relation graphs into the existing core schema. Database foreign keys remain authoritative and are defined by SQL migrations.

## Current limitations

- Automatic material-constrained CPM rescheduling is not enabled yet.
- Purchase supply must be explicitly linked to a requirement to affect its projected availability.
- Advanced supplier quotations and bid comparison are not implemented yet.
- Approval workflows for PR/PO are represented by statuses but will be connected to the shared Approval Engine later.
- Transfer workflow is represented in the inventory ledger types, but a full warehouse-transfer command is not exposed yet.
- Lot/serial/batch traceability is not part of V2 foundation.
- SAP remains a future integration/system-of-record option for enterprise procurement/accounting where required.

## Safe validation before deployment

Because this branch is being developed while GitHub Actions quota is unavailable, do not deploy until the following are executed in a controlled environment:

```bash
npm run prisma:validate
npm run prisma:generate
npm run typecheck
npm test
npm run build
```

Then apply migrations to a disposable or DEV database before Azure runtime deployment.
