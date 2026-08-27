# Cost Engine V2

## Objective

Cost Engine V2 gives Bridata Project a typed project-controlling domain without turning the product into a general ledger or replacing SAP/ERP accounting.

Core causal chain:

`Budget -> Commitment -> Actual -> ETC -> EAC -> VAC -> Project / WBS risk`

It integrates with Project Engine V2 and Material / Inventory Engine V2 while keeping each domain as the source of truth for its own transactions.

## Scope

Cost Engine V2 owns:

- project control currency
- contingency / management allowance for project control
- cost codes
- planned and approved budget lines
- optional work-item and material allocation
- non-procurement commitments
- manual/imported/accrued actual costs
- immutable cost baselines
- forecast remaining uncommitted cost
- Estimate To Complete (ETC)
- Estimate At Completion (EAC)
- Variance At Completion (VAC)
- project and work-item cost risk

It does **not** implement:

- General Ledger
- Accounts Payable
- Accounts Receivable
- taxation
- treasury
- payroll
- statutory accounting
- invoice settlement
- fixed assets

Those remain ERP/SAP responsibilities where appropriate.

## Typed tables

- `project_cost_profiles`
- `cost_codes`
- `project_budget_lines`
- `project_commitments`
- `project_actual_costs`
- `project_cost_baselines`
- `project_cost_baseline_lines`

All tenant-owned Cost Engine tables use PostgreSQL `ENABLE ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY` with the existing fail-closed tenant policy.

## Source-of-truth boundaries

### Budget

`project_budget_lines` is the Cost Engine source of truth for planned and approved project budget.

Legacy `NexusObject.metadata.budgetTotal` and `budgetSpent` are migration inputs only. They are not the permanent project cost ledger.

### Material commitments

Material purchase orders remain owned by Material / Inventory Engine V2.

Cost Engine does **not** copy purchase orders into `project_commitments`.

Material open commitment is derived from:

`max(PO line quantity - received quantity, 0) * PO line unit cost`

Only project-linked or requirement-linked purchase-order lines are considered.

### Material actual cost

Material actual cost is recognized from posted goods-receipt lines:

`received quantity * receipt unit cost`

This avoids a gap where a received PO would no longer be an open commitment but would not yet be visible as project actual cost.

Inventory issue/consumption remains operational inventory movement and is not counted again as financial actual cost, preventing double counting.

### Other commitments

`project_commitments` stores non-PO commitments such as contracts, manual commitments, or future SAP-imported commitments.

Open commitment:

`max(amount - releasedAmount, 0)`

Only status `OPEN` contributes to forecast.

### Other actual costs

`project_actual_costs` stores manual, SAP-imported, accrual, or other non-material actual costs.

## Core formulas

For the project:

`ApprovedBudget = sum(approved budget lines)`

`ControlBudget = ApprovedBudget + Contingency`

`ActualCost = ManualActual + MaterialActual`

`OpenCommitment = ManualOpenCommitment + MaterialOpenCommitment`

`ETC = OpenCommitment + ForecastRemainingUncommitted`

`EAC = ActualCost + ETC`

`VAC = ControlBudget - EAC`

`SpentAndCommitted = ActualCost + OpenCommitment`

`RemainingAfterActualAndCommitment = ControlBudget - SpentAndCommitted`

Forecast variance percentage:

`(EAC - ControlBudget) / ControlBudget * 100`

when ControlBudget is greater than zero.

## Budget-line forecast

Each budget line may have an explicit `forecast_remaining_uncommitted` value.

If the user does not provide one, V2 derives:

`max(0, ApprovedAmount - AllocatedActual - AllocatedCommitment)`

This prevents the forecast from dropping below the approved budget merely because a cost has not yet been committed.

If the user explicitly enters a forecast override, Bridata respects it even when it produces an overrun. The purpose of forecast is to expose expected outcome, not force it back to budget.

## Allocation of facts to budget lines

Cost Engine attempts deterministic allocation in descending specificity.

For material facts:

1. material + work item
2. unique material line

For coded manual facts:

1. cost code + work item
2. unique cost-code line

If exactly one line cannot be determined, the fact is classified as **unallocated** instead of being silently distributed.

Unallocated actual and commitment values remain part of project EAC and are surfaced explicitly in the UI.

## Cost health

- `NO_BUDGET`: no control budget
- `ON_TRACK`: EAC <= ControlBudget
- `WATCH`: EAC <= 105% of ControlBudget
- `HIGH`: EAC <= 110% of ControlBudget
- `CRITICAL`: EAC > 110% of ControlBudget

This is project-controlling health, not an accounting status.

## Currency policy

V2 is single-control-currency per project.

A project cost profile defines its ISO 3-letter currency.

Manual actuals and manual commitments must match that currency.

Material purchase orders or receipts in another currency are **not silently converted**. They are returned as `currencyIssues` and excluded from aggregate totals until a future FX policy / rate source is implemented.

This is intentionally conservative.

The project currency cannot be changed after incompatible financial transactions already exist.

## Database integrity guards

PostgreSQL triggers validate:

- project belongs to tenant/workspace
- work item belongs to the project
- cost code belongs to the workspace
- material belongs to the workspace
- supplier belongs to the tenant
- transaction currency matches project cost profile
- project cost profile exists for actual/commitment transactions
- PO-line requirement matches material/workspace/project
- goods-receipt line matches its PO line and header

Domain trigger violations use PostgreSQL `P0001` and are normalized by the Fastify error handler to HTTP 409 conflicts, including Prisma-wrapped `P2010` errors.

## Immutable cost baseline

`POST /api/v1/projects/:projectId/cost-baseline-v2` creates a new version every time.

A baseline captures:

- currency
- contingency
- each budget line
- planned amount
- approved amount
- current forecast-uncommitted override
- WBS/material/cost-code dimensions

Older baselines are never overwritten.

## APIs

Read:

- `GET /api/v1/cost-engine-v2/catalog?workspaceId=...`
- `GET /api/v1/projects/:projectId/cost-overview-v2`
- `GET /api/v1/projects/:projectId/cost-baselines-v2`

Write:

- `POST /api/v1/cost-engine-v2/cost-codes`
- `PUT /api/v1/projects/:projectId/cost-profile-v2`
- `POST /api/v1/projects/:projectId/budget-lines-v2`
- `PATCH /api/v1/cost-engine-v2/budget-lines/:id`
- `POST /api/v1/projects/:projectId/commitments-v2`
- `PATCH /api/v1/cost-engine-v2/commitments/:id`
- `POST /api/v1/projects/:projectId/actual-costs-v2`
- `POST /api/v1/projects/:projectId/cost-baseline-v2`
- `POST /api/v1/cost-engine-v2/backfill`

## Legacy backfill

Backfill is project-scoped and defaults to `dryRun=true`.

Possible legacy inputs:

- `metadata.budgetTotal`
- `metadata.budgetSpent`

When explicitly executed, it may create:

- project cost profile
- `LEGACY-GENERAL` cost code
- one approved/planned budget line
- one historical actual-cost row for legacy spend

It never deletes or rewrites the original NexusObject metadata.

## UI integration

### Global

Sidebar -> **Costos** -> `CostControlV2View`

Users can select a project and operate the full cost-control module.

### Project

Project Center includes a **Costos** tab using `ProjectCostsV2View`.

### Gantt

`ProjectCostRiskStrip` appears above WBS + Gantt V2 and displays:

- Control Budget
- EAC
- VAC
- cost forecast risk

It links directly to the project Costos tab.

V2 does not automatically move schedule dates based on financial variance.

## Current limitations / future evolution

Not yet implemented:

- FX conversion engine
- Earned Value metrics (EV, PV, AC, CPI, SPI) with a formal status-date model
- automatic accrual rules
- invoice/AP matching
- SAP synchronization
- portfolio consolidated cost cube
- time-phased cost curves
- cash-flow forecasting
- automatic cost impact from schedule/material scenarios

These should be added only after Cost Engine V2 is validated with real project data.