from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def replace_once(relative: str, old: str, new: str) -> None:
    path = ROOT / relative
    text = path.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{relative}: expected exactly one match, found {count}\n---\n{old[:300]}")
    path.write_text(text.replace(old, new, 1), encoding="utf-8")
    print(f"PATCH_OK {relative}")


# 1. Reuse the exact same authenticated/session-aware request pipeline.
replace_once(
    "src/api/client.ts",
    "async function request<T>(path: string, init: RequestInit = {}): Promise<T> {",
    "export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {",
)

# 2. NexusContext imports.
replace_once(
    "src/context/NexusContext.tsx",
    "import { configureApiSession, BridataApiError } from '../api/client';\n",
    "import { configureApiSession, BridataApiError } from '../api/client';\n"
    "import { collaborationV1Api } from '../api/collaborationV1Client';\n"
    "import { mapApiObjectCommentV1, mapObjectCollaborationV1 } from '../domain/collaborationV1';\n",
)

replace_once(
    "src/context/NexusContext.tsx",
    "export type ObjectDataStatus = 'mock' | 'waiting' | 'loading' | 'ready' | 'error';\n",
    "export type ObjectDataStatus = 'mock' | 'waiting' | 'loading' | 'ready' | 'error';\n"
    "export type CollaborationDataStatus = 'mock' | 'idle' | 'loading' | 'ready' | 'error';\n",
)

replace_once(
    "src/context/NexusContext.tsx",
    "  activityLogs: ActivityLog[];\n  comments: Comment[];\n  approvals: ApprovalStep[];\n",
    "  activityLogs: ActivityLog[];\n"
    "  comments: Comment[];\n"
    "  selectedObjectActivityLogs: ActivityLog[];\n"
    "  selectedObjectComments: Comment[];\n"
    "  collaborationStatus: CollaborationDataStatus;\n"
    "  collaborationError: string | null;\n"
    "  reloadObjectCollaboration: (objectId?: string) => Promise<void>;\n"
    "  approvals: ApprovalStep[];\n",
)

replace_once(
    "src/context/NexusContext.tsx",
    "  addComment: (objectId: string, content: string) => void;\n",
    "  addComment: (objectId: string, content: string) => Promise<Comment>;\n",
)

replace_once(
    "src/context/NexusContext.tsx",
    "  const [comments, setComments] = useState<Comment[]>(isApiMode ? [] : mockComments);\n  const [approvals, setApprovals] = useState<ApprovalStep[]>(isApiMode ? [] : mockApprovals);\n",
    "  const [comments, setComments] = useState<Comment[]>(isApiMode ? [] : mockComments);\n"
    "  const [apiObjectComments, setApiObjectComments] = useState<Comment[]>([]);\n"
    "  const [apiObjectActivityLogs, setApiObjectActivityLogs] = useState<ActivityLog[]>([]);\n"
    "  const [collaborationStatus, setCollaborationStatus] = useState<CollaborationDataStatus>(\n"
    "    isApiMode ? 'idle' : 'mock',\n"
    "  );\n"
    "  const [collaborationError, setCollaborationError] = useState<string | null>(null);\n"
    "  const [approvals, setApprovals] = useState<ApprovalStep[]>(isApiMode ? [] : mockApprovals);\n",
)

replace_once(
    "src/context/NexusContext.tsx",
    "  const selectedObject = useMemo(() => {\n    if (!selectedObjectId) return null;\n    return objects.find((object) => object.id === selectedObjectId) ?? null;\n  }, [objects, selectedObjectId]);\n\n  const repositoryContext = useCallback((): ObjectRepositoryContext => {",
    "  const selectedObject = useMemo(() => {\n"
    "    if (!selectedObjectId) return null;\n"
    "    return objects.find((object) => object.id === selectedObjectId) ?? null;\n"
    "  }, [objects, selectedObjectId]);\n\n"
    "  const selectedObjectComments = useMemo<Comment[]>(() => {\n"
    "    if (!selectedObjectId) return [];\n"
    "    return isApiMode\n"
    "      ? apiObjectComments\n"
    "      : comments.filter((comment) => comment.objectId === selectedObjectId);\n"
    "  }, [selectedObjectId, isApiMode, apiObjectComments, comments]);\n\n"
    "  const selectedObjectActivityLogs = useMemo<ActivityLog[]>(() => {\n"
    "    if (!selectedObjectId) return [];\n"
    "    return isApiMode\n"
    "      ? apiObjectActivityLogs\n"
    "      : activityLogs.filter((log) => log.objectId === selectedObjectId);\n"
    "  }, [selectedObjectId, isApiMode, apiObjectActivityLogs, activityLogs]);\n\n"
    "  const reloadObjectCollaboration = useCallback(async (objectId?: string): Promise<void> => {\n"
    "    if (!isApiMode) {\n"
    "      setCollaborationStatus('mock');\n"
    "      setCollaborationError(null);\n"
    "      return;\n"
    "    }\n\n"
    "    const targetId = objectId ?? selectedObjectId;\n"
    "    if (!apiReady || !targetId) {\n"
    "      setApiObjectComments([]);\n"
    "      setApiObjectActivityLogs([]);\n"
    "      setCollaborationStatus('idle');\n"
    "      setCollaborationError(null);\n"
    "      return;\n"
    "    }\n\n"
    "    setCollaborationStatus('loading');\n"
    "    setCollaborationError(null);\n"
    "    try {\n"
    "      const payload = await collaborationV1Api.getObjectCollaboration(targetId, {\n"
    "        commentLimit: 100,\n"
    "        auditLimit: 100,\n"
    "        historyLimit: 100,\n"
    "      });\n"
    "      const mapped = mapObjectCollaborationV1(payload);\n"
    "      setApiObjectComments(mapped.comments);\n"
    "      setApiObjectActivityLogs(mapped.activityLogs);\n"
    "      setCollaborationStatus('ready');\n"
    "    } catch (cause) {\n"
    "      setApiObjectComments([]);\n"
    "      setApiObjectActivityLogs([]);\n"
    "      setCollaborationStatus('error');\n"
    "      setCollaborationError(dataErrorMessage(cause));\n"
    "    }\n"
    "  }, [isApiMode, apiReady, selectedObjectId]);\n\n"
    "  const repositoryContext = useCallback((): ObjectRepositoryContext => {",
)

replace_once(
    "src/context/NexusContext.tsx",
    "  useEffect(() => {\n    void reloadObjects();\n  }, [reloadObjects]);\n\n  useEffect(() => {\n    if (!isApiMode || objectDataStatus !== 'ready') return;",
    "  useEffect(() => {\n"
    "    void reloadObjects();\n"
    "  }, [reloadObjects]);\n\n"
    "  useEffect(() => {\n"
    "    if (!isDrawerOpen || !selectedObjectId) return;\n"
    "    void reloadObjectCollaboration(selectedObjectId);\n"
    "  }, [isDrawerOpen, selectedObjectId, reloadObjectCollaboration]);\n\n"
    "  useEffect(() => {\n"
    "    if (!isApiMode || objectDataStatus !== 'ready') return;",
)

replace_once(
    "src/context/NexusContext.tsx",
    "  const openObjectDrawer = (objectId: string) => {\n    setSelectedObjectId(objectId);\n    setIsDrawerOpen(true);\n  };\n\n  const closeObjectDrawer = () => {\n    setIsDrawerOpen(false);\n    setSelectedObjectId(null);\n  };",
    "  const openObjectDrawer = (objectId: string) => {\n"
    "    if (isApiMode) {\n"
    "      setApiObjectComments([]);\n"
    "      setApiObjectActivityLogs([]);\n"
    "      setCollaborationStatus('loading');\n"
    "      setCollaborationError(null);\n"
    "    }\n"
    "    setSelectedObjectId(objectId);\n"
    "    setIsDrawerOpen(true);\n"
    "  };\n\n"
    "  const closeObjectDrawer = () => {\n"
    "    setIsDrawerOpen(false);\n"
    "    setSelectedObjectId(null);\n"
    "    if (isApiMode) {\n"
    "      setApiObjectComments([]);\n"
    "      setApiObjectActivityLogs([]);\n"
    "      setCollaborationStatus('idle');\n"
    "      setCollaborationError(null);\n"
    "    }\n"
    "  };",
)

replace_once(
    "src/context/NexusContext.tsx",
    "      const log: ActivityLog = {\n        id: `act-${crypto.randomUUID()}`,\n        objectId: created.id,\n        userId: currentUser.id,\n        userName: currentUser.name,\n        userAvatar: currentUser.avatar,\n        action: `Creó el objeto (${created.type}) \"${created.title}\"`,\n        newValue: created.status,\n        timestamp: new Date().toISOString(),\n      };\n      setActivityLogs((previous) => [log, ...previous]);",
    "      if (!isApiMode) {\n"
    "        const log: ActivityLog = {\n"
    "          id: `act-${crypto.randomUUID()}`,\n"
    "          objectId: created.id,\n"
    "          userId: currentUser.id,\n"
    "          userName: currentUser.name,\n"
    "          userAvatar: currentUser.avatar,\n"
    "          action: `Creó el objeto (${created.type}) \"${created.title}\"`,\n"
    "          newValue: created.status,\n"
    "          timestamp: new Date().toISOString(),\n"
    "        };\n"
    "        setActivityLogs((previous) => [log, ...previous]);\n"
    "      }",
)

replace_once(
    "src/context/NexusContext.tsx",
    "      if (updates.status && updates.status !== existing.status) {",
    "      if (!isApiMode && updates.status && updates.status !== existing.status) {",
)

replace_once(
    "src/context/NexusContext.tsx",
    "  const addComment = (objectId: string, content: string) => {\n    const newComment: Comment = {\n      id: `cmt-${crypto.randomUUID()}`,\n      objectId,\n      userId: currentUser.id,\n      userName: currentUser.name,\n      userAvatar: currentUser.avatar,\n      content,\n      createdAt: new Date().toISOString(),\n    };\n    setComments((previous) => [newComment, ...previous]);\n  };",
    "  const addComment = async (objectId: string, content: string): Promise<Comment> => {\n"
    "    const normalized = content.trim();\n"
    "    if (!normalized) throw new Error('El comentario no puede estar vacío.');\n\n"
    "    if (isApiMode) {\n"
    "      if (!apiReady) throw new Error('La API todavía no está lista para guardar comentarios.');\n"
    "      setCollaborationError(null);\n"
    "      try {\n"
    "        const created = await collaborationV1Api.createObjectComment(objectId, { content: normalized });\n"
    "        const mapped = mapApiObjectCommentV1(created);\n"
    "        setApiObjectComments((previous) => [mapped, ...previous.filter((item) => item.id !== mapped.id)]);\n"
    "        await reloadObjectCollaboration(objectId);\n"
    "        return mapped;\n"
    "      } catch (cause) {\n"
    "        setCollaborationStatus('error');\n"
    "        setCollaborationError(dataErrorMessage(cause));\n"
    "        throw cause;\n"
    "      }\n"
    "    }\n\n"
    "    const newComment: Comment = {\n"
    "      id: `cmt-${crypto.randomUUID()}`,\n"
    "      objectId,\n"
    "      userId: currentUser.id,\n"
    "      userName: currentUser.name,\n"
    "      userAvatar: currentUser.avatar,\n"
    "      content: normalized,\n"
    "      createdAt: new Date().toISOString(),\n"
    "    };\n"
    "    setComments((previous) => [newComment, ...previous]);\n"
    "    return newComment;\n"
    "  };",
)

replace_once(
    "src/context/NexusContext.tsx",
    "        activityLogs,\n        comments,\n        approvals,",
    "        activityLogs,\n"
    "        comments,\n"
    "        selectedObjectActivityLogs,\n"
    "        selectedObjectComments,\n"
    "        collaborationStatus,\n"
    "        collaborationError,\n"
    "        reloadObjectCollaboration,\n"
    "        approvals,",
)

# 3. Drawer uses selected-object persistent collaboration instead of global mock arrays.
replace_once(
    "src/components/layout/UniversalObjectDrawer.tsx",
    "    addComment,\n    comments,\n    activityLogs,\n    getLinkedObjects,",
    "    addComment,\n"
    "    selectedObjectComments,\n"
    "    selectedObjectActivityLogs,\n"
    "    collaborationStatus,\n"
    "    collaborationError,\n"
    "    reloadObjectCollaboration,\n"
    "    getLinkedObjects,",
)

replace_once(
    "src/components/layout/UniversalObjectDrawer.tsx",
    "  const [newCommentText, setNewCommentText] = useState('');\n",
    "  const [newCommentText, setNewCommentText] = useState('');\n"
    "  const [isCommentSubmitting, setIsCommentSubmitting] = useState(false);\n",
)

replace_once(
    "src/components/layout/UniversalObjectDrawer.tsx",
    "  const objComments = comments.filter((c) => c.objectId === selectedObject.id);\n  const objLogs = activityLogs.filter((l) => l.objectId === selectedObject.id);",
    "  const objComments = selectedObjectComments;\n  const objLogs = selectedObjectActivityLogs;",
)

replace_once(
    "src/components/layout/UniversalObjectDrawer.tsx",
    "  const handleCommentSubmit = (e: React.FormEvent) => {\n    e.preventDefault();\n    if (!newCommentText.trim()) return;\n    addComment(selectedObject.id, newCommentText);\n    setNewCommentText('');\n  };",
    "  const handleCommentSubmit = async (e: React.FormEvent) => {\n"
    "    e.preventDefault();\n"
    "    if (!newCommentText.trim() || isCommentSubmitting) return;\n"
    "    setIsCommentSubmitting(true);\n"
    "    try {\n"
    "      await addComment(selectedObject.id, newCommentText);\n"
    "      setNewCommentText('');\n"
    "    } catch {\n"
    "      // NexusContext preserves the typed text and exposes a user-safe error.\n"
    "    } finally {\n"
    "      setIsCommentSubmitting(false);\n"
    "    }\n"
    "  };",
)

replace_once(
    "src/components/layout/UniversalObjectDrawer.tsx",
    "                onClick={() => setActiveDrawerTab(tab.id as any)}",
    "                onClick={() => {\n"
    "                  setActiveDrawerTab(tab.id as any);\n"
    "                  if (tab.id === 'comments' || tab.id === 'history') {\n"
    "                    void reloadObjectCollaboration(selectedObject.id);\n"
    "                  }\n"
    "                }}",
)

replace_once(
    "src/components/layout/UniversalObjectDrawer.tsx",
    "        <div className=\"flex-1 overflow-y-auto p-4\">\n          {/* TAB 1: OVERVIEW */}",
    "        <div className=\"flex-1 overflow-y-auto p-4\">\n"
    "          {(activeDrawerTab === 'comments' || activeDrawerTab === 'history') && collaborationError && (\n"
    "            <div role=\"alert\" className=\"mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-300\">\n"
    "              {collaborationError}\n"
    "            </div>\n"
    "          )}\n"
    "          {/* TAB 1: OVERVIEW */}",
)

replace_once(
    "src/components/layout/UniversalObjectDrawer.tsx",
    "                {objComments.length === 0 ? (\n                  <div className=\"p-8 text-center text-xs text-slate-400\">\n                    Sin comentarios aún. Escribe el primero abajo.\n                  </div>\n                ) : (",
    "                {collaborationStatus === 'loading' ? (\n"
    "                  <div className=\"p-8 text-center text-xs text-slate-400\">\n"
    "                    Cargando comentarios persistentes...\n"
    "                  </div>\n"
    "                ) : objComments.length === 0 ? (\n"
    "                  <div className=\"p-8 text-center text-xs text-slate-400\">\n"
    "                    Sin comentarios aún. Escribe el primero abajo.\n"
    "                  </div>\n"
    "                ) : (",
)

replace_once(
    "src/components/layout/UniversalObjectDrawer.tsx",
    "                <button\n                  type=\"submit\"\n                  className=\"rounded-lg bg-indigo-600 p-2 text-white hover:bg-indigo-700\"\n                >",
    "                <button\n"
    "                  type=\"submit\"\n"
    "                  disabled={isCommentSubmitting}\n"
    "                  aria-label={isCommentSubmitting ? 'Guardando comentario' : 'Enviar comentario'}\n"
    "                  className=\"rounded-lg bg-indigo-600 p-2 text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50\"\n"
    "                >",
)

replace_once(
    "src/components/layout/UniversalObjectDrawer.tsx",
    "              {objLogs.length === 0 ? (\n                <div className=\"p-8 text-center text-xs text-slate-400\">\n                  Sin registros de auditoría aún.\n                </div>\n              ) : (",
    "              {collaborationStatus === 'loading' ? (\n"
    "                <div className=\"p-8 text-center text-xs text-slate-400\">\n"
    "                  Cargando auditoría persistente...\n"
    "                </div>\n"
    "              ) : objLogs.length === 0 ? (\n"
    "                <div className=\"p-8 text-center text-xs text-slate-400\">\n"
    "                  Sin registros de auditoría aún.\n"
    "                </div>\n"
    "              ) : (",
)

replace_once(
    "src/components/layout/UniversalObjectDrawer.tsx",
    "                Historial de Modificaciones Inmutables",
    "                Auditoría persistente del objeto",
)

# 4. Keep the pure frontend mapper smoke in normal local test flow.
replace_once(
    "package.json",
    '    "test": "tsx src/domain/myWork.smoke.ts && npm run test --workspace @nexus/api",',
    '    "test": "tsx src/domain/myWork.smoke.ts && tsx src/domain/collaborationV1.smoke.ts && npm run test --workspace @nexus/api",',
)

# This one-time helper must not survive in the final PR diff.
Path(__file__).unlink()
print("COLLABORATION_V1B_PATCH_OK")
