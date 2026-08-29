from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'PATCH_FAIL {path}: expected 1 occurrence, found {count}')
    p.write_text(text.replace(old, new, 1), encoding='utf-8')
    print(f'PATCH_OK {path}')


# -----------------------------------------------------------------------------
# API registration
# -----------------------------------------------------------------------------
replace_once(
    'apps/api/src/app.ts',
    "import { objectRoutes } from './routes/objects.js';\n",
    "import { objectRelationsV1Routes } from './routes/object-relations-v1.js';\nimport { objectRoutes } from './routes/objects.js';\n",
)
replace_once(
    'apps/api/src/app.ts',
    "  await app.register(collaborationV1Routes);\n",
    "  await app.register(collaborationV1Routes);\n  await app.register(objectRelationsV1Routes);\n",
)

# -----------------------------------------------------------------------------
# Transactional per-field ObjectHistory on object PATCH
# -----------------------------------------------------------------------------
replace_once(
    'apps/api/src/routes/objects.ts',
    "function asJson(value: Record<string, unknown> | null) {\n  if (value === null) return Prisma.JsonNull;\n  return value as Prisma.InputJsonValue;\n}\n",
    "function asJson(value: Record<string, unknown> | null) {\n  if (value === null) return Prisma.JsonNull;\n  return value as Prisma.InputJsonValue;\n}\n\nfunction historyComparableValue(value: unknown): unknown {\n  if (value instanceof Date) return value.toISOString();\n  return value ?? null;\n}\n\nfunction historyValuesEqual(left: unknown, right: unknown): boolean {\n  return JSON.stringify(historyComparableValue(left)) === JSON.stringify(historyComparableValue(right));\n}\n\nfunction historyJson(value: unknown): string {\n  return JSON.stringify(historyComparableValue(value)) ?? 'null';\n}\n",
)
replace_once(
    'apps/api/src/routes/objects.ts',
    "          select: { id: true, workspaceId: true },\n",
    "          select: {\n            id: true,\n            workspaceId: true,\n            title: true,\n            description: true,\n            status: true,\n            priority: true,\n            progress: true,\n            assigneeId: true,\n            startDate: true,\n            dueDate: true,\n            metadata: true,\n          },\n",
)
replace_once(
    'apps/api/src/routes/objects.ts',
    "        const object = await tx.nexusObject.findUniqueOrThrow({\n          where: { id: params.data.id },\n        });\n\n        await Promise.all([\n          tx.domainEvent.create({\n            data: {\n              tenantId: actor.tenantId,\n              aggregateId: object.id,\n              eventType: 'nexus.object.updated',\n              payload: {\n                objectId: object.id,\n                actorId: actor.userId,\n                previousVersion: version,\n                version: object.version,\n                changedFields: Object.keys(updates),\n              },\n            },\n          }),\n          tx.auditLog.create({\n            data: {\n              tenantId: actor.tenantId,\n              userId: actor.userId,\n              action: 'OBJECT_UPDATED',\n              resource: 'NEXUS_OBJECT',\n              resourceId: object.id,\n              correlationId: request.id,\n              ipAddress: request.ip,\n              details: {\n                version: object.version,\n                changedFields: Object.keys(updates),\n              },\n            },\n          }),\n        ]);\n",
    "        const object = await tx.nexusObject.findUniqueOrThrow({\n          where: { id: params.data.id },\n        });\n\n        const historyChanges = [\n          ...(updates.title !== undefined ? [{ fieldKey: 'title', oldValue: current.title, newValue: object.title }] : []),\n          ...(updates.description !== undefined ? [{ fieldKey: 'description', oldValue: current.description, newValue: object.description }] : []),\n          ...(updates.status !== undefined ? [{ fieldKey: 'status', oldValue: current.status, newValue: object.status }] : []),\n          ...(updates.priority !== undefined ? [{ fieldKey: 'priority', oldValue: current.priority, newValue: object.priority }] : []),\n          ...(updates.progress !== undefined ? [{ fieldKey: 'progress', oldValue: current.progress, newValue: object.progress }] : []),\n          ...(updates.assigneeId !== undefined ? [{ fieldKey: 'assigneeId', oldValue: current.assigneeId, newValue: object.assigneeId }] : []),\n          ...(updates.startDate !== undefined ? [{ fieldKey: 'startDate', oldValue: current.startDate, newValue: object.startDate }] : []),\n          ...(updates.dueDate !== undefined ? [{ fieldKey: 'dueDate', oldValue: current.dueDate, newValue: object.dueDate }] : []),\n          ...(updates.metadata !== undefined ? [{ fieldKey: 'metadata', oldValue: current.metadata, newValue: object.metadata }] : []),\n        ].filter((entry) => !historyValuesEqual(entry.oldValue, entry.newValue));\n        const changedFields = historyChanges.map((entry) => entry.fieldKey);\n        const userAgentHeader = request.headers['user-agent'];\n        const userAgent = typeof userAgentHeader === 'string' ? userAgentHeader : null;\n\n        await Promise.all([\n          ...historyChanges.map((entry) => tx.$executeRaw(Prisma.sql`\n            INSERT INTO object_history\n              (tenant_id, object_id, user_id, field_key, old_value, new_value, ip_address, user_agent)\n            VALUES\n              (${actor.tenantId}::uuid, ${object.id}::uuid, ${actor.userId}::uuid, ${entry.fieldKey},\n               ${historyJson(entry.oldValue)}::jsonb, ${historyJson(entry.newValue)}::jsonb, ${request.ip}, ${userAgent})\n          `)),\n          tx.domainEvent.create({\n            data: {\n              tenantId: actor.tenantId,\n              aggregateId: object.id,\n              eventType: 'nexus.object.updated',\n              payload: {\n                objectId: object.id,\n                actorId: actor.userId,\n                previousVersion: version,\n                version: object.version,\n                changedFields,\n              },\n            },\n          }),\n          tx.auditLog.create({\n            data: {\n              tenantId: actor.tenantId,\n              userId: actor.userId,\n              action: 'OBJECT_UPDATED',\n              resource: 'NEXUS_OBJECT',\n              resourceId: object.id,\n              correlationId: request.id,\n              ipAddress: request.ip,\n              details: {\n                version: object.version,\n                changedFields,\n                historyEntries: historyChanges.length,\n              },\n            },\n          }),\n        ]);\n",
)

# -----------------------------------------------------------------------------
# Collaboration labels for relation audit
# -----------------------------------------------------------------------------
replace_once(
    'src/domain/collaborationV1.ts',
    "    case 'OBJECT_COMMENT_CREATED':\n      return 'Agregó un comentario';\n",
    "    case 'OBJECT_COMMENT_CREATED':\n      return 'Agregó un comentario';\n    case 'OBJECT_RELATION_CREATED':\n      return 'Vinculó un objeto';\n    case 'OBJECT_RELATION_DELETED':\n      return 'Eliminó una relación de objeto';\n",
)

# -----------------------------------------------------------------------------
# NexusContext: API relations + collaboration stale-response protection
# -----------------------------------------------------------------------------
replace_once(
    'src/context/NexusContext.tsx',
    "  useMemo,\n  useState,\n",
    "  useMemo,\n  useRef,\n  useState,\n",
)
replace_once(
    'src/context/NexusContext.tsx',
    "import { configureApiSession, BridataApiError } from '../api/client';\nimport { collaborationV1Api } from '../api/collaborationV1Client';\n",
    "import { configureApiSession, BridataApiError, bridataApi } from '../api/client';\nimport { collaborationV1Api } from '../api/collaborationV1Client';\nimport { objectRelationsV1Api } from '../api/objectRelationsV1Client';\n",
)
replace_once(
    'src/context/NexusContext.tsx',
    "export type ObjectDataStatus = 'mock' | 'waiting' | 'loading' | 'ready' | 'error';\nexport type CollaborationDataStatus = 'mock' | 'idle' | 'loading' | 'ready' | 'error';\n",
    "export type ObjectDataStatus = 'mock' | 'waiting' | 'loading' | 'ready' | 'error';\nexport type CollaborationDataStatus = 'mock' | 'idle' | 'loading' | 'ready' | 'error';\nexport type RelationDataStatus = 'mock' | 'waiting' | 'loading' | 'ready' | 'error';\n",
)
replace_once(
    'src/context/NexusContext.tsx',
    "  relations: ObjectRelation[];\n  activityLogs: ActivityLog[];\n",
    "  relations: ObjectRelation[];\n  relationDataStatus: RelationDataStatus;\n  relationDataError: string | null;\n  reloadRelations: () => Promise<void>;\n  activityLogs: ActivityLog[];\n",
)
replace_once(
    'src/context/NexusContext.tsx',
    "  addRelation: (\n    sourceId: string,\n    targetId: string,\n    relationType: ObjectRelation['relationType'],\n    notes?: string,\n  ) => void;\n",
    "  addRelation: (\n    sourceId: string,\n    targetId: string,\n    relationType: ObjectRelation['relationType'],\n    notes?: string,\n  ) => Promise<ObjectRelation>;\n  removeRelation: (relationId: string) => Promise<void>;\n",
)
replace_once(
    'src/context/NexusContext.tsx',
    "  ) => { object: NexusObject; relationType: string; notes?: string }[];\n",
    "  ) => { relationId: string; object: NexusObject; relationType: string; notes?: string }[];\n",
)
replace_once(
    'src/context/NexusContext.tsx',
    "  const [relations, setRelations] = useState<ObjectRelation[]>(isApiMode ? [] : mockRelations);\n  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>(isApiMode ? [] : mockActivityLogs);\n",
    "  const [relations, setRelations] = useState<ObjectRelation[]>(isApiMode ? [] : mockRelations);\n  const [relationDataStatus, setRelationDataStatus] = useState<RelationDataStatus>(isApiMode ? 'waiting' : 'mock');\n  const [relationDataError, setRelationDataError] = useState<string | null>(null);\n  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>(isApiMode ? [] : mockActivityLogs);\n",
)
replace_once(
    'src/context/NexusContext.tsx',
    "  const [collaborationError, setCollaborationError] = useState<string | null>(null);\n",
    "  const [collaborationError, setCollaborationError] = useState<string | null>(null);\n  const collaborationRequestVersionRef = useRef(0);\n",
)
replace_once(
    'src/context/NexusContext.tsx',
    "  const reloadObjectCollaboration = useCallback(async (objectId?: string): Promise<void> => {\n    if (!isApiMode) {\n",
    "  const reloadObjectCollaboration = useCallback(async (objectId?: string): Promise<void> => {\n    const requestVersion = ++collaborationRequestVersionRef.current;\n    if (!isApiMode) {\n",
)
replace_once(
    'src/context/NexusContext.tsx',
    "      const mapped = mapObjectCollaborationV1(payload);\n      setApiObjectComments(mapped.comments);\n      setApiObjectActivityLogs(mapped.activityLogs);\n      setCollaborationStatus('ready');\n    } catch (cause) {\n      setApiObjectComments([]);\n      setApiObjectActivityLogs([]);\n      setCollaborationStatus('error');\n      setCollaborationError(dataErrorMessage(cause));\n",
    "      if (requestVersion !== collaborationRequestVersionRef.current) return;\n      const mapped = mapObjectCollaborationV1(payload);\n      setApiObjectComments(mapped.comments);\n      setApiObjectActivityLogs(mapped.activityLogs);\n      setCollaborationStatus('ready');\n    } catch (cause) {\n      if (requestVersion !== collaborationRequestVersionRef.current) return;\n      setApiObjectComments([]);\n      setApiObjectActivityLogs([]);\n      setCollaborationStatus('error');\n      setCollaborationError(dataErrorMessage(cause));\n",
)
replace_once(
    'src/context/NexusContext.tsx',
    "  useEffect(() => {\n    void reloadObjects();\n  }, [reloadObjects]);\n",
    "  const reloadRelations = useCallback(async (): Promise<void> => {\n    if (!isApiMode) {\n      setRelationDataStatus('mock');\n      setRelationDataError(null);\n      return;\n    }\n    if (!apiReady || !currentWorkspaceId) {\n      setRelations([]);\n      setRelationDataStatus('waiting');\n      setRelationDataError(null);\n      return;\n    }\n\n    setRelationDataStatus('loading');\n    setRelationDataError(null);\n    try {\n      const response = await objectRelationsV1Api.list(currentWorkspaceId);\n      setRelations(response.items.map((item) => ({\n        id: item.id,\n        sourceObjectId: item.sourceObjectId,\n        targetObjectId: item.targetObjectId,\n        relationType: item.relationType,\n        ...(item.notes ? { notes: item.notes } : {}),\n      })));\n      setRelationDataStatus('ready');\n    } catch (cause) {\n      setRelations([]);\n      setRelationDataStatus('error');\n      setRelationDataError(dataErrorMessage(cause));\n    }\n  }, [isApiMode, apiReady, currentWorkspaceId]);\n\n  useEffect(() => {\n    void reloadObjects();\n  }, [reloadObjects]);\n\n  useEffect(() => {\n    void reloadRelations();\n  }, [reloadRelations]);\n",
)
replace_once(
    'src/context/NexusContext.tsx',
    "  const openObjectDrawer = (objectId: string) => {\n    if (isApiMode) {\n",
    "  const openObjectDrawer = (objectId: string) => {\n    collaborationRequestVersionRef.current += 1;\n    if (isApiMode) {\n",
)
replace_once(
    'src/context/NexusContext.tsx',
    "  const closeObjectDrawer = () => {\n    setIsDrawerOpen(false);\n",
    "  const closeObjectDrawer = () => {\n    collaborationRequestVersionRef.current += 1;\n    setIsDrawerOpen(false);\n",
)
replace_once(
    'src/context/NexusContext.tsx',
    "  const addRelation = (\n    sourceObjectId: string,\n    targetObjectId: string,\n    relationType: ObjectRelation['relationType'],\n    notes?: string,\n  ) => {\n    const newRelation: ObjectRelation = {\n      id: `rel-${crypto.randomUUID()}`,\n      sourceObjectId,\n      targetObjectId,\n      relationType,\n      ...(notes ? { notes } : {}),\n    };\n    setRelations((previous) => [...previous, newRelation]);\n  };\n",
    "  const addRelation = async (\n    sourceObjectId: string,\n    targetObjectId: string,\n    relationType: ObjectRelation['relationType'],\n    notes?: string,\n  ): Promise<ObjectRelation> => {\n    if (!isApiMode) {\n      const newRelation: ObjectRelation = {\n        id: `rel-${crypto.randomUUID()}`,\n        sourceObjectId,\n        targetObjectId,\n        relationType,\n        ...(notes ? { notes } : {}),\n      };\n      setRelations((previous) => [...previous, newRelation]);\n      return newRelation;\n    }\n\n    if (!apiReady) throw new Error('La API todavía no está lista para guardar relaciones.');\n    setRelationDataError(null);\n    try {\n      let newRelation: ObjectRelation;\n      if (relationType === 'DEPENDS_ON') {\n        const dependency = await bridataApi.createDependency({\n          predecessorId: targetObjectId,\n          successorId: sourceObjectId,\n          dependencyType: 'FS',\n          lagDays: 0,\n          ...(notes ? { notes } : {}),\n        });\n        newRelation = {\n          id: dependency.id,\n          sourceObjectId: dependency.successorId,\n          targetObjectId: dependency.predecessorId,\n          relationType: 'DEPENDS_ON',\n          ...(dependency.notes ? { notes: dependency.notes } : {}),\n          dependencyType: dependency.dependencyType,\n          lagDays: dependency.lagDays,\n        };\n      } else {\n        const relation = await objectRelationsV1Api.create({\n          sourceObjectId,\n          targetObjectId,\n          relationType,\n          ...(notes ? { notes } : {}),\n        });\n        newRelation = {\n          id: relation.id,\n          sourceObjectId: relation.sourceObjectId,\n          targetObjectId: relation.targetObjectId,\n          relationType: relation.relationType,\n          ...(relation.notes ? { notes: relation.notes } : {}),\n        };\n      }\n      setRelations((previous) => [...previous.filter((item) => item.id !== newRelation.id), newRelation]);\n      setRelationDataStatus('ready');\n      if (selectedObjectId === sourceObjectId || selectedObjectId === targetObjectId) {\n        void reloadObjectCollaboration(selectedObjectId);\n      }\n      return newRelation;\n    } catch (cause) {\n      setRelationDataStatus('error');\n      setRelationDataError(dataErrorMessage(cause));\n      throw cause;\n    }\n  };\n\n  const removeRelation = async (relationId: string): Promise<void> => {\n    const relation = relations.find((item) => item.id === relationId);\n    if (!relation) return;\n\n    if (!isApiMode) {\n      setRelations((previous) => previous.filter((item) => item.id !== relationId));\n      return;\n    }\n\n    setRelationDataError(null);\n    try {\n      if (relation.relationType === 'DEPENDS_ON') {\n        await bridataApi.deleteDependency(relationId);\n      } else {\n        await objectRelationsV1Api.delete(relationId);\n      }\n      setRelations((previous) => previous.filter((item) => item.id !== relationId));\n      setRelationDataStatus('ready');\n      if (selectedObjectId === relation.sourceObjectId || selectedObjectId === relation.targetObjectId) {\n        void reloadObjectCollaboration(selectedObjectId);\n      }\n    } catch (cause) {\n      setRelationDataStatus('error');\n      setRelationDataError(dataErrorMessage(cause));\n      throw cause;\n    }\n  };\n",
)
replace_once(
    'src/context/NexusContext.tsx',
    "  const getLinkedObjects = (objectId: string) => {\n    const linked: { object: NexusObject; relationType: string; notes?: string }[] = [];\n",
    "  const getLinkedObjects = (objectId: string) => {\n    const linked: { relationId: string; object: NexusObject; relationType: string; notes?: string }[] = [];\n",
)
replace_once(
    'src/context/NexusContext.tsx',
    "          linked.push({\n            object: target,\n            relationType: relation.relationType,\n",
    "          linked.push({\n            relationId: relation.id,\n            object: target,\n            relationType: relation.relationType,\n",
)
replace_once(
    'src/context/NexusContext.tsx',
    "          linked.push({\n            object: source,\n            relationType: `INVERSE_${relation.relationType}`,\n",
    "          linked.push({\n            relationId: relation.id,\n            object: source,\n            relationType: `INVERSE_${relation.relationType}`,\n",
)
replace_once(
    'src/context/NexusContext.tsx',
    "        relations,\n        activityLogs,\n",
    "        relations,\n        relationDataStatus,\n        relationDataError,\n        reloadRelations,\n        activityLogs,\n",
)
replace_once(
    'src/context/NexusContext.tsx',
    "        addRelation,\n        addComment,\n",
    "        addRelation,\n        removeRelation,\n        addComment,\n",
)

# -----------------------------------------------------------------------------
# Drawer: persistent relation UX + per-field old/new history
# -----------------------------------------------------------------------------
replace_once(
    'src/components/layout/UniversalObjectDrawer.tsx',
    "    addRelation,\n    addComment,\n",
    "    addRelation,\n    removeRelation,\n    relationDataStatus,\n    relationDataError,\n    reloadRelations,\n    addComment,\n",
)
replace_once(
    'src/components/layout/UniversalObjectDrawer.tsx',
    "  const [isLinkingOpen, setIsLinkingOpen] = useState(false);\n",
    "  const [isLinkingOpen, setIsLinkingOpen] = useState(false);\n  const [isRelationSubmitting, setIsRelationSubmitting] = useState(false);\n",
)
replace_once(
    'src/components/layout/UniversalObjectDrawer.tsx',
    "  const handleAddLink = () => {\n    if (!targetLinkObjectId) return;\n    addRelation(selectedObject.id, targetLinkObjectId, linkRelationType);\n    setIsLinkingOpen(false);\n    setTargetLinkObjectId('');\n  };\n",
    "  const handleAddLink = async () => {\n    if (!targetLinkObjectId || isRelationSubmitting) return;\n    setIsRelationSubmitting(true);\n    try {\n      await addRelation(selectedObject.id, targetLinkObjectId, linkRelationType);\n      setIsLinkingOpen(false);\n      setTargetLinkObjectId('');\n    } catch {\n      // NexusContext exposes a user-safe relation error.\n    } finally {\n      setIsRelationSubmitting(false);\n    }\n  };\n",
)
replace_once(
    'src/components/layout/UniversalObjectDrawer.tsx',
    "                  if (tab.id === 'comments' || tab.id === 'history') {\n                    void reloadObjectCollaboration(selectedObject.id);\n                  }\n",
    "                  if (tab.id === 'comments' || tab.id === 'history') {\n                    void reloadObjectCollaboration(selectedObject.id);\n                  }\n                  if (tab.id === 'relations') {\n                    void reloadRelations();\n                  }\n",
)
replace_once(
    'src/components/layout/UniversalObjectDrawer.tsx',
    "          {activeDrawerTab === 'relations' && (\n            <div className=\"space-y-4\">\n",
    "          {activeDrawerTab === 'relations' && (\n            <div className=\"space-y-4\">\n              {relationDataError && (\n                <div role=\"alert\" className=\"rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-300\">\n                  {relationDataError}\n                </div>\n              )}\n",
)
replace_once(
    'src/components/layout/UniversalObjectDrawer.tsx',
    "                      <button\n                        onClick={handleAddLink}\n                        className=\"rounded bg-indigo-600 px-3 py-1 font-semibold text-white hover:bg-indigo-700\"\n                      >\n                        Guardar Relación\n                      </button>\n",
    "                      <button\n                        onClick={() => void handleAddLink()}\n                        disabled={isRelationSubmitting}\n                        className=\"rounded bg-indigo-600 px-3 py-1 font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50\"\n                      >\n                        {isRelationSubmitting ? 'Guardando...' : 'Guardar Relación'}\n                      </button>\n",
)
replace_once(
    'src/components/layout/UniversalObjectDrawer.tsx',
    "              {linked.length === 0 ? (\n                <div className=\"p-8 text-center text-xs text-slate-400\">\n                  No hay relaciones configuradas aún para este objeto.\n                </div>\n              ) : (\n",
    "              {relationDataStatus === 'loading' ? (\n                <div className=\"p-8 text-center text-xs text-slate-400\">\n                  Cargando relaciones persistentes...\n                </div>\n              ) : linked.length === 0 ? (\n                <div className=\"p-8 text-center text-xs text-slate-400\">\n                  No hay relaciones configuradas aún para este objeto.\n                </div>\n              ) : (\n",
)
replace_once(
    'src/components/layout/UniversalObjectDrawer.tsx',
    "                  {linked.map((item, idx) => (\n                    <div\n                      key={idx}\n",
    "                  {linked.map((item) => (\n                    <div\n                      key={item.relationId}\n",
)
replace_once(
    'src/components/layout/UniversalObjectDrawer.tsx',
    "                      <ArrowRight className=\"h-4 w-4 text-slate-400\" />\n",
    "                      <div className=\"flex items-center gap-1\">\n                        <ArrowRight className=\"h-4 w-4 text-slate-400\" />\n                        <button\n                          type=\"button\"\n                          onClick={() => void removeRelation(item.relationId)}\n                          className=\"rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40\"\n                          aria-label=\"Eliminar relación\"\n                          title=\"Eliminar relación\"\n                        >\n                          <Trash2 className=\"h-3.5 w-3.5\" />\n                        </button>\n                      </div>\n",
)
replace_once(
    'src/components/layout/UniversalObjectDrawer.tsx',
    "                      <div className=\"flex items-center space-x-2 text-[11px] text-slate-400\">\n                        <span>{log.userName}</span>\n                        <span>•</span>\n                        <span>{new Date(log.timestamp).toLocaleString()}</span>\n                      </div>\n",
    "                      <div className=\"flex items-center space-x-2 text-[11px] text-slate-400\">\n                        <span>{log.userName}</span>\n                        <span>•</span>\n                        <span>{new Date(log.timestamp).toLocaleString()}</span>\n                      </div>\n                      {(log.oldValue !== undefined || log.newValue !== undefined) && (\n                        <div className=\"mt-1 flex items-start gap-1.5 rounded bg-slate-50 px-2 py-1 text-[10px] text-slate-500 dark:bg-slate-800/60 dark:text-slate-400\">\n                          <span className=\"max-w-[45%] break-all\">{log.oldValue ?? '—'}</span>\n                          <ArrowRight className=\"mt-0.5 h-3 w-3 shrink-0\" />\n                          <span className=\"max-w-[45%] break-all font-semibold text-slate-700 dark:text-slate-300\">{log.newValue ?? '—'}</span>\n                        </div>\n                      )}\n",
)

# -----------------------------------------------------------------------------
# CI future-proofing for when Actions quota returns
# -----------------------------------------------------------------------------
replace_once(
    '.github/workflows/ci.yml',
    "      - name: Verify persistent portfolio hierarchy\n",
    "      - name: Verify per-field object history and governed persistent relations\n        env:\n          AUTH_MODE: dev\n          DEV_AUTH_ENABLED: \"true\"\n          DEV_USER_ID: 00000000-0000-4000-8000-000000000001\n          DEV_TENANT_ID: 00000000-0000-4000-8000-000000000002\n        run: npx tsx apps/api/test/object-history-relations-v1-smoke.ts\n\n      - name: Verify persistent portfolio hierarchy\n",
)

# Self-delete: the committed final tree must contain only product changes.
Path(__file__).unlink()
print('OBJECT_HISTORY_RELATIONS_V1_PATCH_OK')
