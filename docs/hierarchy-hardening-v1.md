# Bridata Project — Hierarchy Hardening V1.1

Portfolio hierarchy is governed by the same universal Object Engine, with additional API write guards.

## Rules

- `PROGRAM` requires a valid `portfolioId` in the same tenant and workspace.
- `PROJECT` may reference a portfolio, a program, or both; when both are present, the program must belong to that portfolio.
- `PORTFOLIO` cannot reference a parent portfolio or program.
- `PROGRAM` cannot reference another program as its parent.
- Moving a program to another portfolio is rejected while linked projects explicitly point to the old portfolio.
- Deleting a portfolio or program is rejected while hierarchy children remain linked.
- Creating or editing portfolios/programs requires tenant admin privileges or workspace `OWNER`, `ADMIN`, or `MANAGER` role.
- Tenant isolation and workspace isolation remain enforced by PostgreSQL RLS and existing object authorization.

CI validates these rules against PostgreSQL 16 and the real API routes.
