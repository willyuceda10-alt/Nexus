from pathlib import Path

root = Path(__file__).resolve().parents[2]

# -----------------------------------------------------------------------------
# 1. Extend DATA PEP normalization with future exact FI identity when available.
# -----------------------------------------------------------------------------
source_path = root / 'apps/api/src/domain/sap-source-detection-v1.ts'
source = source_path.read_text()

old_optional = """      'Nº docum.refer.',
      'Indic.cargo/abono',
      'Val/Mon.so.CO',
    ]),
"""
new_optional = """      'Nº docum.refer.',
      'Indic.cargo/abono',
      'Val/Mon.so.CO',
      'Sociedad',
      'Ejercicio',
      'Posición documento',
    ]),
"""
if new_optional not in source:
    if old_optional not in source:
        raise SystemExit('DATA PEP optional-header anchor missing')
    source = source.replace(old_optional, new_optional, 1)

material_item = """function asMaterialDocumentItem(value: SapCellScalar | undefined): string | null {
  const document = asDocument(value);
  if (!document) return null;
  return /^\\d+$/.test(document) ? document.padStart(4, '0') : document;
}
"""
accounting_item = material_item + """
function asAccountingDocumentItem(value: SapCellScalar | undefined): string | null {
  const document = asDocument(value);
  if (!document) return null;
  return /^\\d+$/.test(document) ? document.padStart(3, '0') : document;
}
"""
if 'function asAccountingDocumentItem' not in source:
    if material_item not in source:
        raise SystemExit('accounting item helper anchor missing')
    source = source.replace(material_item, accounting_item, 1)

old_actual_start = """  } else if (profileId === 'project_actual_costs_v1') {
    fields = compact({
"""
new_actual_start = """  } else if (profileId === 'project_actual_costs_v1') {
    const companyCode = asDocument(pick(map, 'Sociedad'));
    const fiscalYear = asDocument(pick(map, 'Ejercicio'));
    const accountingDocument = asDocument(pick(map, 'Número de documento'));
    const accountingDocumentItem = asAccountingDocumentItem(pickFirst(map, [
      'Posición documento', 'Posición doc.contable', 'Pos.documento', 'Posición de documento', 'Partida',
    ]));
    fields = compact({
"""
if new_actual_start not in source:
    if old_actual_start not in source:
        raise SystemExit('DATA PEP normalization start anchor missing')
    source = source.replace(old_actual_start, new_actual_start, 1)

old_fields = """      postingDate: asIsoDate(pick(map, 'Fe.contabilización')),
      entryDate: asIsoDate(pick(map, 'Fecha entrada')),
      accountingDocument: asDocument(pick(map, 'Número de documento')),
      offsetAccount: asDocument(pick(map, 'Cta.contrapartida')),
"""
new_fields = """      postingDate: asIsoDate(pick(map, 'Fe.contabilización')),
      entryDate: asIsoDate(pick(map, 'Fecha entrada')),
      companyCode,
      fiscalYear,
      accountingDocument,
      accountingDocumentItem,
      offsetAccount: asDocument(pick(map, 'Cta.contrapartida')),
"""
if new_fields not in source:
    if old_fields not in source:
        raise SystemExit('DATA PEP field anchor missing')
    source = source.replace(old_fields, new_fields, 1)

old_tail = """    if (!asText(pick(map, 'Elemento PEP')) || !asDocument(pick(map, 'Número de documento'))) {
      errors.push('ACTUAL_COST_CORE_FIELDS_MISSING');
    }
    warnings.push('ACCOUNTING_LINE_POSITION_NOT_AVAILABLE');
"""
new_tail = """    if (!asText(pick(map, 'Elemento PEP')) || !accountingDocument) {
      errors.push('ACTUAL_COST_CORE_FIELDS_MISSING');
    }
    if (companyCode && fiscalYear && accountingDocument && accountingDocumentItem) {
      externalKey = `FI:${companyCode}:${fiscalYear}:${accountingDocument}:${accountingDocumentItem}`;
    } else {
      warnings.push('ACCOUNTING_LINE_POSITION_NOT_AVAILABLE');
    }
"""
if new_tail not in source:
    if old_tail not in source:
        raise SystemExit('DATA PEP identity tail anchor missing')
    source = source.replace(old_tail, new_tail, 1)
source_path.write_text(source)

# -----------------------------------------------------------------------------
# 2. Cost Engine permits signed actuals but keeps budgets/commitments non-negative.
# -----------------------------------------------------------------------------
cost_domain_path = root / 'apps/api/src/domain/cost-engine-v2.ts'
cost_domain = cost_domain_path.read_text()
amount_fn = """function amount(value: number, field: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new CostEngineV2ValidationError(`${field} must be finite and non-negative.`);
  }
  return Math.round((value + Number.EPSILON) * 10_000) / 10_000;
}
"""
signed_fn = amount_fn + """
function signedAmount(value: number, field: string): number {
  if (!Number.isFinite(value)) {
    throw new CostEngineV2ValidationError(`${field} must be finite.`);
  }
  return Math.round((value + Number.EPSILON) * 10_000) / 10_000;
}
"""
if 'function signedAmount' not in cost_domain:
    if amount_fn not in cost_domain:
        raise SystemExit('Cost Engine amount helper anchor missing')
    cost_domain = cost_domain.replace(amount_fn, signed_fn, 1)

cost_domain = cost_domain.replace(
    "const manualActual = amount(input.manualActual, 'manualActual');",
    "const manualActual = signedAmount(input.manualActual, 'manualActual');",
    1,
)
cost_domain = cost_domain.replace(
    "const actualAmount = amount(input.actualAmount, 'actualAmount');",
    "const actualAmount = signedAmount(input.actualAmount, 'actualAmount');",
    1,
)
cost_domain_path.write_text(cost_domain)

cost_test_path = root / 'apps/api/src/domain/cost-engine-v2.test.ts'
cost_test = cost_test_path.read_text()
negative_test = """
  it('nets signed SAP-style reversals in actual cost without allowing negative commitments', () => {
    const project = calculateProjectCostSummaryV2({
      plannedBudget: 1000,
      approvedBudget: 1000,
      contingencyAmount: 0,
      manualActual: -20,
      materialActual: 100,
      manualOpenCommitment: 0,
      materialOpenCommitment: 0,
      forecastRemainingUncommitted: 900,
    });
    expect(project.actualCost).toBe(80);

    const line = calculateBudgetLineForecastV2({
      approvedAmount: 1000,
      actualAmount: -20,
      commitmentAmount: 0,
    });
    expect(line.actualAmount).toBe(-20);
    expect(line.forecastRemainingUncommitted).toBe(1020);
    expect(line.estimateAtCompletion).toBe(1000);
  });
"""
if "nets signed SAP-style reversals" not in cost_test:
    closing = "\n});\n"
    if not cost_test.endswith(closing):
        raise SystemExit('Cost Engine test closing anchor missing')
    cost_test = cost_test[:-len(closing)] + negative_test + closing
cost_test_path.write_text(cost_test)

# -----------------------------------------------------------------------------
# 3. Cost Overview suppresses receipt-derived financial actuals under DATA PEP authority.
# -----------------------------------------------------------------------------
overview_path = root / 'apps/api/src/routes/cost-overview-v2.ts'
overview = overview_path.read_text()
manual_anchor = """        const [manualActualRows, manualCommitmentRows, materialActualRows, materialCommitmentRows] = await Promise.all([
"""
authority_block = """        const actualAuthorityRows = await tx.$queryRaw<Array<{ enabled: boolean }>>(Prisma.sql`
          SELECT EXISTS (
            SELECT 1 FROM integration_entity_links authority
            WHERE authority.tenant_id = ${actor.tenantId}::uuid
              AND authority.external_entity_type = 'SAP_ACTUAL_COST_AUTHORITY'
              AND authority.canonical_entity_type = 'PROJECT_OBJECT'
              AND authority.canonical_entity_id = ${project.id}::uuid
              AND authority.metadata->>'authority' = 'SAP_DATA_PEP'
          ) AS enabled
        `);
        const sapDataPepAuthority = Boolean(actualAuthorityRows[0]?.enabled);

""" + manual_anchor
if 'const sapDataPepAuthority' not in overview:
    if manual_anchor not in overview:
        raise SystemExit('Cost overview facts anchor missing')
    overview = overview.replace(manual_anchor, authority_block, 1)

where_anchor = """              AND COALESCE(po.project_object_id, mr.project_object_id) = ${project.id}::uuid
              AND gr.status = 'POSTED'
"""
where_new = """              AND COALESCE(po.project_object_id, mr.project_object_id) = ${project.id}::uuid
              AND gr.status = 'POSTED'
              AND ${not sapDataPepAuthority}
"""
if where_new not in overview:
    if where_anchor not in overview:
        raise SystemExit('Cost overview material actual anchor missing')
    overview = overview.replace(where_anchor, where_new, 1)

payload_anchor = """            currency,
            summary,
"""
payload_new = """            currency,
            actualAuthority: sapDataPepAuthority ? 'SAP_DATA_PEP' : 'BRIDATA_MIXED',
            summary,
"""
if payload_new not in overview:
    if payload_anchor not in overview:
        raise SystemExit('Cost overview payload anchor missing')
    overview = overview.replace(payload_anchor, payload_new, 1)
overview_path.write_text(overview)

# -----------------------------------------------------------------------------
# 4. Wire V1-D4 route into runtime.
# -----------------------------------------------------------------------------
app_path = root / 'apps/api/src/app.ts'
app = app_path.read_text()
old_import = "import { sapIntegrationFinancialGuardV1d3Routes } from './routes/sap-integration-financial-guard-v1d3.js';\n"
new_import = old_import + "import { sapIntegrationActualCostSyncV1d4Routes } from './routes/sap-integration-actual-cost-sync-v1d4.js';\n"
if new_import not in app:
    if old_import not in app:
        raise SystemExit('V1-D3 app import anchor missing')
    app = app.replace(old_import, new_import, 1)
old_register = "  await app.register(sapIntegrationFinancialGuardV1d3Routes);\n"
new_register = old_register + "  await app.register(sapIntegrationActualCostSyncV1d4Routes);\n"
if new_register not in app:
    if old_register not in app:
        raise SystemExit('V1-D3 app register anchor missing')
    app = app.replace(old_register, new_register, 1)
app_path.write_text(app)

# -----------------------------------------------------------------------------
# 5. Add smoke to CI for when Actions quota is available again.
# -----------------------------------------------------------------------------
ci_path = root / '.github/workflows/ci.yml'
ci = ci_path.read_text()
anchor = """      - name: Verify persistent object approval lifecycle
"""
step = """      - name: Verify SAP DATA PEP actual authority V1-D4
        env:
          AUTH_MODE: dev
          DEV_AUTH_ENABLED: "true"
          DEV_USER_ID: 00000000-0000-4000-8000-000000000001
          DEV_TENANT_ID: 00000000-0000-4000-8000-000000000002
          INTEGRATION_STORAGE_MODE: memory
          INTEGRATION_PARSE_MAX_FILE_BYTES: "26214400"
        run: npx tsx apps/api/test/sap-integration-actual-cost-sync-v1d4-smoke.ts

"""
if step not in ci:
    if anchor not in ci:
        raise SystemExit('CI insertion anchor missing')
    ci = ci.replace(anchor, step + anchor, 1)
ci_path.write_text(ci)

Path(__file__).unlink()
print('SAP_ACTUAL_COST_SYNC_V1D4_WIRING_OK')
