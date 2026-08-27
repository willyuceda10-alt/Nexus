import React, { useEffect, useMemo, useState } from 'react';
import { Database, LayoutGrid, ListPlus, Plus, RefreshCw, Search, Settings2, Table2 } from 'lucide-react';
import { bridataApi } from '../../api/client';
import { workOsBoardConfigV1Api, type BoardConfigV1, type BoardFormulaExpressionV1, type BoardRelationTargetV1 } from '../../api/workOsBoardConfigV1Api';
import { workOsBoardEditorV1Api, type ApiAvailableBoardItemV1 } from '../../api/workOsBoardEditorV1Api';
import type { ApiWorkBoardColumnTypeV1, ApiWorkBoardColumnV1, ApiWorkBoardDataV1, ApiWorkBoardItemV1, ApiWorkBoardSummaryV1 } from '../../api/workOsBoardV1Contracts';
import { useApiBootstrap } from '../../context/ApiBootstrapContext';
import { useNexus } from '../../context/NexusContext';
import { AddBoardItemsDialogV1, NewBoardColumnDialogV1, NewBoardGroupDialogV1 } from './boardEditorV1/BoardEditorDialogsV1';
import { BoardKanbanV1 } from './boardEditorV1/BoardKanbanV1';
import type { BoardEditingCellV1 } from './boardEditorV1/BoardTableV1';
import { BoardViewSettingsV1 } from './boardEditorV1/BoardViewSettingsV1';
import { buildBoardEditorMock } from './boardEditorV1/boardEditorMock';
import { DEFAULT_STATUSES, safeBoardFieldKey } from './boardEditorV1/boardEditorUtils';
import { BoardDataModelPanelV1 } from './boardConfigV1/BoardDataModelPanelV1';
import { BoardGovernedTableV1 } from './boardConfigV1/BoardGovernedTableV1';

function mergeComputed(data: ApiWorkBoardDataV1, values: Record<string, Record<string, unknown>>): ApiWorkBoardDataV1 {
  return {
    ...data,
    items: data.items.map((item) => ({
      ...item,
      customFields: { ...item.customFields, ...(values[item.object.id] ?? {}) },
    })),
  };
}

function mockValue(item: ApiWorkBoardItemV1, fieldKey: string): number {
  const object = item.object as unknown as Record<string, unknown>;
  const value = object[fieldKey] ?? item.customFields[fieldKey] ?? 0;
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function evaluateMockFormula(item: ApiWorkBoardItemV1, expression: BoardFormulaExpressionV1): number | null {
  if (expression.kind === 'LITERAL') return expression.value;
  if (expression.kind === 'FIELD') return mockValue(item, expression.fieldKey);
  const left = evaluateMockFormula(item, expression.left);
  const right = evaluateMockFormula(item, expression.right);
  if (left === null || right === null) return null;
  if (expression.op === 'ADD') return left + right;
  if (expression.op === 'SUBTRACT') return left - right;
  if (expression.op === 'MULTIPLY') return left * right;
  if (expression.op === 'DIVIDE') return right === 0 ? null : left / right;
  if (expression.op === 'MIN') return Math.min(left, right);
  return Math.max(left, right);
}

export const WorkBoardsConfigOptionsV1View: React.FC = () => {
  const apiBootstrap = useApiBootstrap();
  const { tenant, currentWorkspace, currentUser, objects, openObjectDrawer } = useNexus();
  const apiReady = apiBootstrap.dataMode === 'api' && apiBootstrap.status === 'ready';
  const mockBase = useMemo(() => buildBoardEditorMock(objects), [objects]);

  const [boards, setBoards] = useState<ApiWorkBoardSummaryV1[]>([]);
  const [selectedBoardId, setSelectedBoardId] = useState<string | null>(null);
  const [data, setData] = useState<ApiWorkBoardDataV1 | null>(null);
  const [governance, setGovernance] = useState<BoardConfigV1 | null>(null);
  const [relationCandidates, setRelationCandidates] = useState<Record<string, BoardRelationTargetV1[]>>({});
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [dataModelOpen, setDataModelOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [columnOpen, setColumnOpen] = useState(false);
  const [groupOpen, setGroupOpen] = useState(false);
  const [available, setAvailable] = useState<ApiAvailableBoardItemV1[]>([]);
  const [availableSearch, setAvailableSearch] = useState('');
  const [editing, setEditing] = useState<BoardEditingCellV1 | null>(null);
  const [newColumn, setNewColumn] = useState({ label: '', fieldKey: '', dataType: 'TEXT' as ApiWorkBoardColumnTypeV1 });
  const [newGroupName, setNewGroupName] = useState('');

  const buildMockGovernance = (boardData: ApiWorkBoardDataV1): BoardConfigV1 => {
    const statusColumn = boardData.columns.find((column) => column.field_key === 'status');
    const priorityColumn = boardData.columns.find((column) => column.field_key === 'priority');
    const people = new Map<string, BoardConfigV1['people'][number]>();
    people.set(currentUser.id, { id: currentUser.id, fullName: currentUser.name, email: currentUser.email, avatarUrl: currentUser.avatar || null, workspaceRole: currentUser.roleName });
    for (const object of objects) {
      if (object.assigneeId && object.assigneeName) people.set(object.assigneeId, { id: object.assigneeId, fullName: object.assigneeName, email: '', avatarUrl: object.assigneeAvatar || null, workspaceRole: 'MEMBER' });
      if (object.ownerId && object.ownerName) people.set(object.ownerId, { id: object.ownerId, fullName: object.ownerName, email: '', avatarUrl: object.ownerAvatar || null, workspaceRole: 'MEMBER' });
    }
    return {
      boardId: boardData.board.id,
      workspaceId: currentWorkspace?.id ?? 'mock',
      people: [...people.values()],
      boards: [
        { id: boardData.board.id, name: boardData.board.name, objectDefinitionId: boardData.board.objectDefinitionId },
        { id: 'mock-related-board', name: 'Proyectos relacionados', objectDefinitionId: 'mock-project-definition' },
      ],
      optionSets: [
        ...(statusColumn ? [{ id: 'mock-status-options', columnId: statusColumn.id, name: 'Estados', allowMultiple: false, options: DEFAULT_STATUSES.map((status, index) => ({ key: status, label: status.replaceAll('_', ' '), color: null, sortOrder: (index + 1) * 10, isActive: true })) }] : []),
        ...(priorityColumn ? [{ id: 'mock-priority-options', columnId: priorityColumn.id, name: 'Prioridades', allowMultiple: false, options: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map((priority, index) => ({ key: priority, label: priority, color: null, sortOrder: (index + 1) * 10, isActive: true })) }] : []),
      ],
    };
  };

  const loadBoards = async () => {
    if (!apiReady || !currentWorkspace) return;
    setLoading(true); setError(null);
    try {
      const result = await bridataApi.workBoardsV1(currentWorkspace.id);
      setBoards(result.items);
      setSelectedBoardId((current) => current && result.items.some((board) => board.id === current) ? current : result.items[0]?.id ?? null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudieron cargar los tableros.'); }
    finally { setLoading(false); }
  };

  const loadData = async (boardId: string, viewId?: string | null) => {
    if (!apiReady) return;
    setLoading(true); setError(null);
    try {
      const [result, configuration, computed] = await Promise.all([
        bridataApi.workBoardDataV1(boardId, viewId),
        workOsBoardConfigV1Api.configuration(tenant.id, boardId),
        workOsBoardConfigV1Api.computedValues(tenant.id, boardId),
      ]);
      const merged = mergeComputed(result, computed.valuesByObjectId);
      setData(merged);
      setGovernance(configuration);
      setActiveViewId(merged.selectedView?.id ?? merged.views[0]?.id ?? null);
      const relationColumns = merged.columns.filter((column) => column.data_type === 'RELATION');
      const candidatePairs = await Promise.all(relationColumns.map(async (column) => [column.id, (await workOsBoardConfigV1Api.relationCandidates(tenant.id, boardId, column.id)).items] as const));
      setRelationCandidates(Object.fromEntries(candidatePairs));
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo cargar el tablero.'); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    if (apiReady) void loadBoards();
    else {
      setBoards([mockBase.board]); setSelectedBoardId(mockBase.board.id); setData(mockBase); setActiveViewId(mockBase.selectedView?.id ?? null);
      setGovernance(buildMockGovernance(mockBase));
      setRelationCandidates({});
    }
  }, [apiReady, currentWorkspace?.id, mockBase]);

  useEffect(() => { if (apiReady && selectedBoardId) void loadData(selectedBoardId); }, [apiReady, selectedBoardId]);

  const selectedView = data?.views.find((view) => view.id === activeViewId) ?? data?.selectedView ?? null;
  const config = selectedView?.config ?? {};
  const hiddenColumnKeys = Array.isArray(config.hiddenColumnKeys) ? config.hiddenColumnKeys.filter((value): value is string => typeof value === 'string') : [];
  const configuredOrder = Array.isArray(config.columnOrder) ? config.columnOrder.filter((value): value is string => typeof value === 'string') : [];
  const filterConfig = typeof config.filters === 'object' && config.filters !== null ? config.filters as Record<string, unknown> : {};
  const sortConfig = typeof config.sort === 'object' && config.sort !== null ? config.sort as Record<string, unknown> : {};
  const statusFilter = typeof filterConfig.status === 'string' ? filterConfig.status : '';
  const sortField = typeof sortConfig.fieldKey === 'string' ? sortConfig.fieldKey : 'title';
  const sortDirection: 'asc' | 'desc' = sortConfig.direction === 'desc' ? 'desc' : 'asc';

  const orderedColumns = useMemo(() => {
    if (!data) return [];
    const byKey = new Map(data.columns.map((column) => [column.key, column]));
    const ordered = configuredOrder.flatMap((key) => byKey.get(key) ? [byKey.get(key)!] : []);
    return [...ordered, ...data.columns.filter((column) => !configuredOrder.includes(column.key)).sort((a, b) => a.sort_order - b.sort_order)];
  }, [data, configuredOrder.join('|')]);

  const visibleColumns = orderedColumns.filter((column) => column.is_visible && !hiddenColumnKeys.includes(column.key));
  const filteredItems = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    const items = data.items.filter((item) => (!q || `${item.object.title} ${item.object.status} ${item.object.priority}`.toLowerCase().includes(q)) && (!statusFilter || item.object.status === statusFilter));
    return [...items].sort((a, b) => {
      const get = (item: ApiWorkBoardItemV1): string | number => sortField === 'title' ? item.object.title : sortField === 'progress' ? item.object.progress : sortField === 'dueDate' ? (item.object.dueDate ?? '') : String((item.object as unknown as Record<string, unknown>)[sortField] ?? item.customFields[sortField] ?? '');
      const aValue = get(a); const bValue = get(b);
      const comparison = typeof aValue === 'number' && typeof bValue === 'number' ? aValue - bValue : String(aValue).localeCompare(String(bValue), 'es');
      return sortDirection === 'desc' ? -comparison : comparison;
    });
  }, [data, search, statusFilter, sortField, sortDirection]);

  const mutateMockView = (patch: Record<string, unknown>) => {
    if (!data || !selectedView) return;
    const nextConfig = { ...selectedView.config, ...patch };
    const views = data.views.map((view) => view.id === selectedView.id ? { ...view, config: nextConfig } : view);
    setData({ ...data, views, selectedView: { ...selectedView, config: nextConfig } });
  };

  const persistViewConfig = async (patch: Record<string, unknown>) => {
    if (!data || !selectedView) return;
    if (!apiReady) { mutateMockView(patch); return; }
    setSaving(true); setError(null);
    try { await workOsBoardEditorV1Api.updateView(tenant.id, data.board.id, selectedView.id, { config: patch }); await loadData(data.board.id, selectedView.id); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo guardar la vista.'); }
    finally { setSaving(false); }
  };

  const saveCell = async (item: ApiWorkBoardItemV1, column: ApiWorkBoardColumnV1, value: unknown) => {
    if (!data) return;
    setSaving(true); setError(null);
    try {
      if (apiReady) { await workOsBoardEditorV1Api.updateCell(tenant.id, data.board.id, item.object.id, column.id, { version: item.object.version, value }); await loadData(data.board.id, selectedView?.id); }
      else {
        const items = data.items.map((current) => current.object.id !== item.object.id ? current : column.source === 'CUSTOM'
          ? { ...current, customFields: { ...current.customFields, [column.field_key]: value }, object: { ...current.object, version: current.object.version + 1 } }
          : { ...current, object: { ...current.object, [column.field_key]: value, version: current.object.version + 1 } } as ApiWorkBoardItemV1);
        setData({ ...data, items });
      }
      setEditing(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo actualizar la celda.'); }
    finally { setSaving(false); }
  };

  const saveManagedOption = async (item: ApiWorkBoardItemV1, column: ApiWorkBoardColumnV1, value: string | string[] | null) => {
    if (!data) return;
    setSaving(true); setError(null);
    try {
      if (apiReady) {
        await workOsBoardConfigV1Api.updateManagedOptionCell(tenant.id, data.board.id, item.object.id, column.id, { version: item.object.version, value });
        await loadData(data.board.id, selectedView?.id);
      } else {
        const items = data.items.map((current) => current.object.id !== item.object.id ? current : column.source === 'CUSTOM'
          ? { ...current, customFields: { ...current.customFields, [column.field_key]: value }, object: { ...current.object, version: current.object.version + 1 } }
          : { ...current, object: { ...current.object, [column.field_key]: value, version: current.object.version + 1 } } as ApiWorkBoardItemV1);
        setData({ ...data, items });
      }
      setEditing(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'El valor no pertenece al diccionario activo de esta columna.'); }
    finally { setSaving(false); }
  };

  const savePerson = async (item: ApiWorkBoardItemV1, column: ApiWorkBoardColumnV1, userId: string | null) => {
    if (!data || !governance) return;
    setSaving(true); setError(null);
    try {
      if (apiReady) { await workOsBoardConfigV1Api.updatePersonCell(tenant.id, data.board.id, item.object.id, column.id, { version: item.object.version, userId }); await loadData(data.board.id, selectedView?.id); }
      else {
        const person = governance.people.find((candidate) => candidate.id === userId) ?? null;
        setData({ ...data, items: data.items.map((current) => current.object.id !== item.object.id ? current : column.source === 'CORE'
          ? { ...current, object: { ...current.object, assigneeId: userId, assignee: person ? { id: person.id, fullName: person.fullName, email: person.email, avatarUrl: person.avatarUrl } : null, version: current.object.version + 1 } }
          : { ...current, customFields: { ...current.customFields, [column.field_key]: userId }, object: { ...current.object, version: current.object.version + 1 } }) });
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo asignar la persona.'); }
    finally { setSaving(false); }
  };

  const saveRelation = async (item: ApiWorkBoardItemV1, column: ApiWorkBoardColumnV1, targetObjectIds: string[]) => {
    if (!data) return;
    setSaving(true); setError(null);
    try {
      if (apiReady) { await workOsBoardConfigV1Api.updateRelationCell(tenant.id, data.board.id, item.object.id, column.id, { version: item.object.version, targetObjectIds }); await loadData(data.board.id, selectedView?.id); }
      else {
        const candidates = relationCandidates[column.id] ?? [];
        setData({ ...data, items: data.items.map((current) => current.object.id !== item.object.id ? current : { ...current, customFields: { ...current.customFields, [column.field_key]: candidates.filter((candidate) => targetObjectIds.includes(candidate.id)) }, object: { ...current.object, version: current.object.version + 1 } }) });
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo guardar la relación.'); }
    finally { setSaving(false); }
  };

  const moveGroup = async (item: ApiWorkBoardItemV1, groupId: string | null) => {
    if (!data) return;
    if (apiReady) { await bridataApi.updateWorkBoardPlacementV1(data.board.id, item.object.id, { groupId }); await loadData(data.board.id, selectedView?.id); }
    else setData({ ...data, items: data.items.map((current) => current.object.id === item.object.id ? { ...current, placement: { ...current.placement, groupId } } : current) });
  };

  const dropStatus = async (objectId: string, status: string) => {
    if (!data) return;
    const item = data.items.find((current) => current.object.id === objectId);
    const statusColumn = data.columns.find((column) => column.source === 'CORE' && column.field_key === 'status');
    if (!item || !statusColumn || item.object.status === status) return;
    const managed = governance?.optionSets.some((set) => set.columnId === statusColumn.id) ?? false;
    if (managed) await saveManagedOption(item, statusColumn, status);
    else await saveCell(item, statusColumn, status);
  };

  const loadAvailable = async () => {
    if (!data) return;
    if (!apiReady) {
      const used = new Set(data.items.map((item) => item.object.id));
      setAvailable(objects.filter((object) => object.type === 'TASK' && !used.has(object.id)).slice(0, 100).map((object) => ({ id: object.id, title: object.title, status: object.status, priority: object.priority, progress: object.progress, version: object.version ?? 1, assignee: object.assigneeId ? { id: object.assigneeId, fullName: object.assigneeName || 'Equipo', avatarUrl: object.assigneeAvatar || null } : null })));
      return;
    }
    setAvailable((await workOsBoardEditorV1Api.availableItems(tenant.id, data.board.id, availableSearch)).items);
  };
  useEffect(() => { if (addOpen) void loadAvailable(); }, [addOpen, availableSearch]);

  const addItem = async (candidate: ApiAvailableBoardItemV1) => {
    if (!data) return;
    const firstGroup = data.groups[0]?.id ?? null;
    if (apiReady) { await bridataApi.placeWorkBoardItemV1(data.board.id, { objectId: candidate.id, groupId: firstGroup, sortOrder: data.items.length * 10 + 10 }); await loadData(data.board.id, selectedView?.id); await loadAvailable(); }
    else {
      const source = objects.find((object) => object.id === candidate.id); const mockItem = source ? buildBoardEditorMock([source]).items[0] : null;
      if (mockItem) setData({ ...data, items: [...data.items, { ...mockItem, placement: { groupId: firstGroup, sortOrder: data.items.length * 10 + 10 } }] });
      setAvailable((items) => items.filter((item) => item.id !== candidate.id));
    }
  };

  const createColumn = async () => {
    if (!data || !newColumn.label.trim()) return;
    const fieldKey = newColumn.fieldKey.trim() || safeBoardFieldKey(newColumn.label); if (!fieldKey) return;
    setSaving(true); setError(null);
    try {
      if (apiReady) { await bridataApi.createWorkBoardColumnV1(data.board.id, { label: newColumn.label.trim(), source: 'CUSTOM', dataType: newColumn.dataType, fieldKey, width: 160, isEditable: true }); await loadData(data.board.id, selectedView?.id); }
      else {
        const column: ApiWorkBoardColumnV1 = { id: `mock-column-${Date.now()}`, key: fieldKey, label: newColumn.label.trim(), source: 'CUSTOM', data_type: newColumn.dataType, field_key: fieldKey, width: 160, sort_order: data.columns.length * 10 + 10, is_visible: true, is_editable: true, config: null };
        setData({ ...data, columns: [...data.columns, column] });
        if (governance && ['STATUS', 'PRIORITY', 'TAGS'].includes(column.data_type)) setGovernance({ ...governance, optionSets: [...governance.optionSets, { id: `mock-options-${column.id}`, columnId: column.id, name: column.label, allowMultiple: column.data_type === 'TAGS', options: [] }] });
      }
      setNewColumn({ label: '', fieldKey: '', dataType: 'TEXT' }); setColumnOpen(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo crear la columna.'); }
    finally { setSaving(false); }
  };

  const createGroup = async () => {
    if (!data || !newGroupName.trim()) return;
    if (apiReady) { await bridataApi.createWorkBoardGroupV1(data.board.id, { name: newGroupName.trim(), color: '#16a34a', sortOrder: data.groups.length * 10 + 10 }); await loadData(data.board.id, selectedView?.id); }
    else setData({ ...data, groups: [...data.groups, { id: `mock-group-${Date.now()}`, key: safeBoardFieldKey(newGroupName), name: newGroupName.trim(), color: '#16a34a', sort_order: data.groups.length * 10 + 10 }] });
    setNewGroupName(''); setGroupOpen(false);
  };

  const saveOptions = async (column: ApiWorkBoardColumnV1, options: Array<{ key: string; label: string; color?: string | null }>) => {
    if (!data || !governance) return;
    setSaving(true); setError(null);
    try {
      if (apiReady) { await workOsBoardConfigV1Api.replaceOptions(tenant.id, data.board.id, column.id, { name: column.label, options }); await loadData(data.board.id, selectedView?.id); }
      else {
        const set = { id: governance.optionSets.find((item) => item.columnId === column.id)?.id ?? `mock-options-${column.id}`, columnId: column.id, name: column.label, allowMultiple: column.data_type === 'TAGS', options: options.map((option, index) => ({ ...option, sortOrder: (index + 1) * 10, isActive: true, color: option.color ?? null })) };
        setGovernance({ ...governance, optionSets: [...governance.optionSets.filter((item) => item.columnId !== column.id), set] });
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo guardar el diccionario.'); }
    finally { setSaving(false); }
  };

  const createRelation = async (input: { label: string; fieldKey: string; targetBoardId: string; multiple: boolean }) => {
    if (!data) return;
    setSaving(true); setError(null);
    try {
      if (apiReady) { await workOsBoardConfigV1Api.createRelationColumn(tenant.id, data.board.id, input); await loadData(data.board.id, selectedView?.id); }
      else {
        const column: ApiWorkBoardColumnV1 = { id: `mock-relation-${Date.now()}`, key: input.fieldKey, label: input.label, source: 'CUSTOM', data_type: 'RELATION', field_key: input.fieldKey, width: 220, sort_order: data.columns.length * 10 + 10, is_visible: true, is_editable: true, config: { targetBoardId: input.targetBoardId, relationType: `MOCK:${input.fieldKey}`, multiple: input.multiple } };
        setData({ ...data, columns: [...data.columns, column] });
        setRelationCandidates({ ...relationCandidates, [column.id]: objects.filter((object) => object.type === 'PROJECT').slice(0, 30).map((object) => ({ id: object.id, title: object.title, status: object.status, objectTypeKey: object.type })) });
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo crear la relación.'); }
    finally { setSaving(false); }
  };

  const createFormula = async (input: { label: string; fieldKey: string; expression: BoardFormulaExpressionV1; format: 'NUMBER' | 'CURRENCY' | 'PERCENT'; decimals: number }) => {
    if (!data) return;
    setSaving(true); setError(null);
    try {
      if (apiReady) { await workOsBoardConfigV1Api.createFormulaColumn(tenant.id, data.board.id, input); await loadData(data.board.id, selectedView?.id); }
      else {
        const column: ApiWorkBoardColumnV1 = { id: `mock-formula-${Date.now()}`, key: input.fieldKey, label: input.label, source: 'CUSTOM', data_type: 'FORMULA', field_key: input.fieldKey, width: 160, sort_order: data.columns.length * 10 + 10, is_visible: true, is_editable: false, config: { formula: input.expression, format: input.format, decimals: input.decimals, currency: input.format === 'CURRENCY' ? 'PEN' : null } };
        setData({ ...data, columns: [...data.columns, column], items: data.items.map((item) => ({ ...item, customFields: { ...item.customFields, [input.fieldKey]: evaluateMockFormula(item, input.expression) } })) });
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo crear la fórmula.'); }
    finally { setSaving(false); }
  };

  const toggleColumn = async (column: ApiWorkBoardColumnV1) => { if (column.field_key !== 'title') await persistViewConfig({ hiddenColumnKeys: hiddenColumnKeys.includes(column.key) ? hiddenColumnKeys.filter((key) => key !== column.key) : [...hiddenColumnKeys, column.key] }); };
  const moveColumn = async (column: ApiWorkBoardColumnV1, direction: -1 | 1) => {
    const order = orderedColumns.map((item) => item.key); const index = order.indexOf(column.key); const target = index + direction;
    if (index < 0 || target < 0 || target >= order.length) return; [order[index], order[target]] = [order[target]!, order[index]!]; await persistViewConfig({ columnOrder: order });
  };

  if (!data && loading) return <div className="p-8 text-[11px] text-slate-500">Cargando Board Configuration...</div>;

  return (
    <div className="mx-auto w-full max-w-[1680px] px-5 py-5 lg:px-7">
      <div className="grid min-h-[calc(100vh-110px)] grid-cols-1 gap-4 xl:grid-cols-[240px_minmax(0,1fr)]">
        <aside className="command-panel overflow-hidden p-3"><div className="flex items-center justify-between px-2 py-2"><div><p className="text-[9px] font-black uppercase tracking-[0.14em] text-slate-400">Tableros</p><p className="mt-1 text-[11px] font-bold text-slate-700">{boards.length} en el workspace</p></div><LayoutGrid className="h-4 w-4 text-green-700" /></div><div className="mt-2 space-y-1">{boards.map((board) => <button key={board.id} onClick={() => setSelectedBoardId(board.id)} className={`w-full rounded-xl px-3 py-3 text-left transition ${selectedBoardId === board.id ? 'bg-green-50 text-green-900 ring-1 ring-green-100' : 'text-slate-600 hover:bg-slate-50'}`}><p className="truncate text-[11px] font-bold">{board.name}</p><p className="mt-1 truncate text-[9px] text-slate-400">{board.description || 'Board configurable'}</p></button>)}</div></aside>

        <main className="min-w-0 space-y-4">
          <section className="command-panel overflow-visible">
            <div className="flex flex-col gap-4 border-b border-slate-100 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0"><div className="flex items-center gap-2"><span className="rounded-full bg-green-50 px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.1em] text-green-800 ring-1 ring-green-100">Work OS Board</span>{saving && <span className="text-[9px] font-bold text-slate-400">Guardando...</span>}</div><h1 className="mt-2 truncate text-[22px] font-extrabold tracking-tight text-slate-950">{data?.board.name || 'Tablero'}</h1><p className="mt-1 text-[10px] text-slate-400">Datos gobernados · vistas configurables · relaciones y fórmulas seguras.</p></div>
              <div className="flex flex-wrap items-center gap-2"><button onClick={() => setAddOpen(true)} className="inline-flex h-9 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-[10px] font-bold text-slate-700"><ListPlus className="h-3.5 w-3.5" /> Añadir</button><button onClick={() => setColumnOpen(true)} className="inline-flex h-9 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-[10px] font-bold text-slate-700"><Plus className="h-3.5 w-3.5" /> Columna</button><button onClick={() => setDataModelOpen(true)} className="inline-flex h-9 items-center gap-2 rounded-xl border border-green-200 bg-green-50 px-3 text-[10px] font-bold text-green-800"><Database className="h-3.5 w-3.5" /> Modelo de datos</button><button onClick={() => setSettingsOpen((value) => !value)} className={`inline-flex h-9 items-center gap-2 rounded-xl px-3 text-[10px] font-bold ${settingsOpen ? 'bg-slate-900 text-white' : 'border border-slate-200 bg-white text-slate-700'}`}><Settings2 className="h-3.5 w-3.5" /> Vista</button></div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3"><div className="flex min-w-0 items-center gap-1 overflow-x-auto no-scrollbar">{data?.views.map((view) => <button key={view.id} onClick={() => { setActiveViewId(view.id); if (apiReady && data) void loadData(data.board.id, view.id); }} className={`inline-flex h-8 items-center gap-2 whitespace-nowrap rounded-lg px-3 text-[9px] font-black ${activeViewId === view.id ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-50'}`}>{view.view_type === 'KANBAN' ? <LayoutGrid className="h-3 w-3" /> : <Table2 className="h-3 w-3" />}{view.name}</button>)}</div><div className="flex items-center gap-2"><div className="flex h-8 min-w-[220px] items-center gap-2 rounded-lg border border-slate-200 bg-white px-3"><Search className="h-3.5 w-3.5 text-slate-400" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar en la vista..." className="w-full bg-transparent text-[10px] outline-none" /></div><button onClick={() => data && apiReady && void loadData(data.board.id, selectedView?.id)} className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 bg-white text-slate-500"><RefreshCw className="h-3.5 w-3.5" /></button></div></div>
            {settingsOpen && selectedView && <BoardViewSettingsV1 statusFilter={statusFilter} sortField={sortField} sortDirection={sortDirection} columns={orderedColumns} hiddenColumnKeys={hiddenColumnKeys} statuses={data?.items.map((item) => item.object.status) ?? []} onFilterChange={async (status) => persistViewConfig({ filters: { ...filterConfig, status } })} onSortChange={async (fieldKey, direction) => persistViewConfig({ sort: { fieldKey, direction } })} onToggleColumn={toggleColumn} onMoveColumn={moveColumn} onNewGroup={() => setGroupOpen(true)} />}
          </section>

          {error && <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[10px] font-semibold text-rose-700">{error}</div>}
          {selectedView?.view_type === 'KANBAN'
            ? <BoardKanbanV1 items={filteredItems} onDropStatus={dropStatus} onOpen={openObjectDrawer} />
            : governance
              ? <BoardGovernedTableV1 items={filteredItems} groups={data?.groups ?? []} columns={visibleColumns} configuration={governance} relationCandidates={relationCandidates} editing={editing} setEditing={setEditing} onSaveCell={saveCell} onSaveManagedOption={saveManagedOption} onSavePerson={savePerson} onSaveRelation={saveRelation} onMoveGroup={moveGroup} />
              : null}
        </main>
      </div>

      {addOpen && <AddBoardItemsDialogV1 search={availableSearch} onSearch={setAvailableSearch} items={available} onAdd={addItem} onClose={() => setAddOpen(false)} />}
      {columnOpen && <NewBoardColumnDialogV1 value={newColumn} onChange={setNewColumn} onCreate={createColumn} onClose={() => setColumnOpen(false)} saving={saving} />}
      {groupOpen && <NewBoardGroupDialogV1 name={newGroupName} onName={setNewGroupName} onCreate={createGroup} onClose={() => setGroupOpen(false)} saving={saving} />}
      {dataModelOpen && data && governance && <BoardDataModelPanelV1 columns={data.columns} config={governance} saving={saving} onClose={() => setDataModelOpen(false)} onSaveOptions={saveOptions} onCreateRelation={createRelation} onCreateFormula={createFormula} />}
    </div>
  );
};
