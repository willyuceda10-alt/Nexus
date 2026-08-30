from pathlib import Path

route = Path('apps/api/src/routes/sap-integration-orchestration-v1f2.ts')
text = route.read_text()
old_action = """              action: `SAP_ORCHESTRATION_V1F2_${status}`,
"""
new_action = """              action: body.data.dryRun
                ? `SAP_ORCHESTRATION_V1F2_DRY_RUN_${status}`
                : `SAP_ORCHESTRATION_V1F2_${status}`,
"""
if old_action not in text:
    raise SystemExit('F2 audit action anchor missing')
text = text.replace(old_action, new_action, 1)

old_event = """              eventType: 'bridata.integration.sap.orchestration.v1f2.completed',
"""
new_event = """              eventType: body.data.dryRun
                ? 'bridata.integration.sap.orchestration.v1f2.dry-run.completed'
                : 'bridata.integration.sap.orchestration.v1f2.completed',
"""
if old_event not in text:
    raise SystemExit('F2 domain event anchor missing')
text = text.replace(old_event, new_event, 1)
route.write_text(text)

smoke = Path('apps/api/test/sap-integration-orchestration-v1f2-smoke.ts')
text = smoke.read_text()
old_persisted = """      const [audits, events, principal, connection] = await Promise.all([
        tx.auditLog.count({ where: { tenantId, resourceId: connectionId, action: 'SAP_ORCHESTRATION_V1F2_SUCCEEDED' } }),
        tx.domainEvent.count({ where: { tenantId, aggregateId: connectionId, eventType: 'bridata.integration.sap.orchestration.v1f2.completed' } }),
        tx.integrationServicePrincipal.findFirst({ where: { tenantId, integrationConnectionId: connectionId, clientId: fullClientId }, select: { lastUsedAt: true } }),
        tx.integrationConnection.findUnique({ where: { id: connectionId }, select: { config: true } }),
      ]);
      return { audits, events, principal, config: connection?.config };
    });
    assert(persisted.audits === 2 && persisted.events === 2, 'Successful F2 runs were not audited exactly once each.');
"""
new_persisted = """      const [audits, events, dryRunAudits, dryRunEvents, principal, connection] = await Promise.all([
        tx.auditLog.count({ where: { tenantId, resourceId: connectionId, action: 'SAP_ORCHESTRATION_V1F2_SUCCEEDED' } }),
        tx.domainEvent.count({ where: { tenantId, aggregateId: connectionId, eventType: 'bridata.integration.sap.orchestration.v1f2.completed' } }),
        tx.auditLog.count({ where: { tenantId, resourceId: connectionId, action: 'SAP_ORCHESTRATION_V1F2_DRY_RUN_SUCCEEDED' } }),
        tx.domainEvent.count({ where: { tenantId, aggregateId: connectionId, eventType: 'bridata.integration.sap.orchestration.v1f2.dry-run.completed' } }),
        tx.integrationServicePrincipal.findFirst({ where: { tenantId, integrationConnectionId: connectionId, clientId: fullClientId }, select: { lastUsedAt: true } }),
        tx.integrationConnection.findUnique({ where: { id: connectionId }, select: { config: true } }),
      ]);
      return { audits, events, dryRunAudits, dryRunEvents, principal, config: connection?.config };
    });
    assert(persisted.audits === 2 && persisted.events === 2, 'Successful F2 apply runs were not audited exactly once each.');
    assert(persisted.dryRunAudits === 1 && persisted.dryRunEvents === 1, 'F2 dry-run audit/event semantics are not isolated from apply runs.');
"""
if old_persisted not in text:
    raise SystemExit('F2 smoke audit assertion anchor missing')
text = text.replace(old_persisted, new_persisted, 1)
smoke.write_text(text)

Path('scripts/dev/apply-sap-orchestration-v1f2-audit-semantics-fix.py').unlink()
print('SAP_ORCHESTRATION_V1F2_AUDIT_SEMANTICS_FIX_OK')
