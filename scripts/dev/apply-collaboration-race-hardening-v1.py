from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'PATCH_FAIL {path}: expected 1 occurrence, found {count}')
    p.write_text(text.replace(old, new, 1), encoding='utf-8')
    print(f'PATCH_OK {path}')


path = 'src/context/NexusContext.tsx'
replace_once(
    path,
    "  const [collaborationError, setCollaborationError] = useState<string | null>(null);\n  const collaborationRequestVersionRef = useRef(0);\n",
    "  const [collaborationError, setCollaborationError] = useState<string | null>(null);\n  const collaborationRequestVersionRef = useRef(0);\n  const collaborationObjectIdRef = useRef<string | null>(null);\n",
)
replace_once(
    path,
    "      if (requestVersion !== collaborationRequestVersionRef.current) return;\n      const mapped = mapObjectCollaborationV1(payload);\n",
    "      if (requestVersion !== collaborationRequestVersionRef.current || collaborationObjectIdRef.current !== targetId) return;\n      const mapped = mapObjectCollaborationV1(payload);\n",
)
replace_once(
    path,
    "    } catch (cause) {\n      if (requestVersion !== collaborationRequestVersionRef.current) return;\n      setApiObjectComments([]);\n",
    "    } catch (cause) {\n      if (requestVersion !== collaborationRequestVersionRef.current || collaborationObjectIdRef.current !== targetId) return;\n      setApiObjectComments([]);\n",
)
replace_once(
    path,
    "  const openObjectDrawer = (objectId: string) => {\n    collaborationRequestVersionRef.current += 1;\n    if (isApiMode) {\n",
    "  const openObjectDrawer = (objectId: string) => {\n    collaborationRequestVersionRef.current += 1;\n    collaborationObjectIdRef.current = objectId;\n    if (isApiMode) {\n",
)
replace_once(
    path,
    "  const closeObjectDrawer = () => {\n    collaborationRequestVersionRef.current += 1;\n    setIsDrawerOpen(false);\n",
    "  const closeObjectDrawer = () => {\n    collaborationRequestVersionRef.current += 1;\n    collaborationObjectIdRef.current = null;\n    setIsDrawerOpen(false);\n",
)
replace_once(
    path,
    "        const mapped = mapApiObjectCommentV1(created);\n        setApiObjectComments((previous) => [mapped, ...previous.filter((item) => item.id !== mapped.id)]);\n        await reloadObjectCollaboration(objectId);\n        return mapped;\n      } catch (cause) {\n        setCollaborationStatus('error');\n        setCollaborationError(dataErrorMessage(cause));\n        throw cause;\n",
    "        const mapped = mapApiObjectCommentV1(created);\n        if (collaborationObjectIdRef.current === objectId) {\n          setApiObjectComments((previous) => [mapped, ...previous.filter((item) => item.id !== mapped.id)]);\n          await reloadObjectCollaboration(objectId);\n        }\n        return mapped;\n      } catch (cause) {\n        if (collaborationObjectIdRef.current === objectId) {\n          setCollaborationStatus('error');\n          setCollaborationError(dataErrorMessage(cause));\n        }\n        throw cause;\n",
)

Path(__file__).unlink()
print('COLLABORATION_RACE_HARDENING_V1_PATCH_OK')
