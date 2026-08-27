import React, { useEffect, useMemo, useState } from 'react';
import { LayoutGrid, ListPlus, Plus, RefreshCw, Search, Settings2, Table2 } from 'lucide-react';
import { bridataApi } from '../../api/client';
import { workOsBoardEditorV1Api, type ApiAvailableBoardItemV1 } from '../../api/workOsBoardEditorV1Api';
import type { ApiWorkBoardColumnTypeV1, ApiWorkBoardColumnV1, ApiWorkBoardDataV1, ApiWorkBoardItemV1, ApiWorkBoardSummaryV1 } from '../../api/workOsBoardV1Contracts';
import { useApiBootstrap } from '../../context/ApiBootstrapContext';
import { useNexus } from '../../context/NexusContext';
import { AddBoardItemsDialogV1, NewBoardColumnDialogV1, NewBoardGroupDialogV1 } from './boardEditorV1/BoardEditorDialogsV1';
import { BoardKanbanV1 } from './boardEditorV1/BoardKanbanV1';
import { BoardTableV1, type BoardEditingCellV1 } from './boardEditorV1/BoardTableV1';
import { BoardViewSettingsV1 } from './boardEditorV1/BoardViewSettingsV1';
import { buildBoardEditorMock } from './boardEditorV1/boardEditorMock';
import { rawBoardCellValue, safeBoardFieldKey } from './boardEditorV1/boardEditorUtils';

export const WorkBoardsEditorV1View: React.FC = () => {
  const apiBootstrap = useApiBootstrap();
  const { tenant, currentWorkspace, objects, openObjectDrawer } = useNexus();
  const apiReady = apiBootstrap.dataMode === 'api' && apiBootstrap.status === 'ready';
  const mockBase = useMemo(() => buildBoardEditorMock(objects), [objects]);

  const [boards, setBoards] = useState<ApiWorkBoardSummaryV1[]>([]);
  const [selectedBoardId, setSelectedBoardId] = useState<string | null>(null);
  const [data, setData] = useState<ApiWorkBoardDataV1 | null>(null);
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [columnOpen, setColumnOpen] = useState(false);
  const [groupOpen, setGroupOpen] = useState(false);
  const [available, setAvailable] = useState<ApiAvailableBoardItemV1[]>([]);
  const [availableSearch, setAvailableSearch] = useState('');
  const [editing, setEditing] = useState<BoardEditingCellV1 | null>(null);
  const [newColumn, setNewColumn] = useState({ label: '', fieldKey: '', dataType: 'TEXT' as ApiWorkBoardColumnTypeV1 });
  const [newGroupName, setNewGroupName] = useState('');

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
      const result = await bridataApi.workBoardDataV1(boardId, viewId);
      setData(result);
      setActiveViewId(result.selectedView?.id ?? result.views[0]?.id ?? null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo cargar el tablero.'); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    if (apiReady) void loadBoards();
    else {
      setBoards([mockBase.board]);
      setSelectedBoardId(mockBase.board.id);
      setData(mockBase);
      setActiveViewId(mockBase.selectedView?.id ?? null);
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
    try {
      await workOsBoardEditorV1Api.updateView(tenant.id, data.board.id, selectedView.id, { config: patch });
      await loadData(data.board.id, selectedView.id);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo guardar la vista.'); }
    finally { setSaving(false); }
  };

  const saveCell = async (item: ApiWorkBoardItemV1, column: ApiWorkBoardColumnV1, value: unknown) => {
    if (!data) return;
    setSaving(true); setError(null);
    try {
      if (apiReady) {
        await workOsBoardEditorV1Api.updateCell(tenant.id, data.board.id, item.object.id, column.id, { version: item.object.version, value });
        await loadData(data.board.id, selectedView?.id);
      } else {
        const items = data.items.map((current) => {
          if (current.object.id !== item.object.id) return current;
          if (column.source === 'CUSTOM') return { ...current, customFields: { ...current.customFields, [column.field_key]: value }, object: { ...current.object, version: current.object.version + 1 } };
          return { ...current, object: { ...current.object, [column.field_key]: value, version: current.object.version + 1 } } as ApiWorkBoardItemV1;
        });
        setData({ ...data, items });
      }
      setEditing(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo actualizar la celda.'); }
    finally { setSaving(false); }
  };

  const moveGroup = async (item: ApiWorkBoardItemV1, groupId: string | null) => {
    if (!data) return;
    setSaving(true); setError(null);
    try {
      if (apiReady) { await bridataApi.updateWorkBoardPlacementV1(data.board.id, item.object.id, { groupId }); await loadData(data.board.id, selectedView?.id); }
      else setData({ ...data, items: data.items.map((current) => current.object.id === item.object.id ? { ...current, placement: { ...current.placement, groupId } } : current) });
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo mover el elemento.'); }
    finally { setSaving(false); }
  };

  const dropStatus = async (objectId: string, status: string) => {
    if (!data) return;
    const item = data.items.find((current) => current.object.id === objectId);
    const statusColumn = data.columns.find((column) => column.source === 'CORE' && column.field_key === 'status');
    if (item && statusColumn && item.object.status !== status) await saveCell(item, statusColumn, status);
  };

  const loadAvailable = async () => {
    if (!data) return;
    if (!apiReady) {
      const used = new Set(data.items.map((item) => item.object.id));
      setAvailable(objects.filter((object) => object.type === 'TASK' && !used.has(object.id)).slice(0, 100).map((object) => ({ id: object.id, title: object.title, status: object.status, priority: object.priority, progress: object.progress, version: object.version ?? 1, assignee: object.assigneeId ? { id: object.assigneeId, fullName: object.assigneeName || 'Equipo', avatarUrl: object.assigneeAvatar || null } : null })));
      return;
    }
    try { setAvailable((await workOsBoardEditorV1Api.availableItems(tenant.id, data.board.id, availableSearch)).items); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudieron cargar elementos disponibles.'); }
  };

  useEffect(() => { if (addOpen) void loadAvailable(); }, [addOpen, availableSearch]);

  const addItem = async (candidate: ApiAvailableBoardItemV1) => {
    if (!data) return;
    const firstGroup = data.groups[0]?.id ?? null;
    if (apiReady) {
      await bridataApi.placeWorkBoardItemV1(data.board.id, { objectId: candidate.id, groupId: firstGroup, sortOrder: data.items.length * 10 + 10 });
      await loadData(data.board.id, selectedView?.id); await loadAvailable();
    } else {
      const source = objects.find((object) => object.id === candidate.id);
      if (!source) return;
      const mockItem = buildBoardEditorMock([source]).items[0];
      if (mockItem) setData({ ...data, items: [...data.items, { ...mockItem, placement: { groupId: firstGroup, sortOrder: data.items.length * 10 + 10 } }] });
      setAvailable((items) => items.filter((item) => item.id !== candidate.id));
    }
  };

  const createColumn = async () => {
    if (!data || !newColumn.label.trim()) return;
    const fieldKey = newColumn.fieldKey.trim() || safeBoardFieldKey(newColumn.label);
    if (!fieldKey) return;
    setSaving(true); setError(null);
    try {
      if (apiReady) { await bridataApi.createWorkBoardColumnV1(data.board.id, { label: newColumn.label.trim(), source: 'CUSTOM', dataType: newColumn.dataType, fieldKey, width: 160, isEditable: true }); await loadData(data.board.id, selectedView?.id); }
      else setData({ ...data, columns: [...data.columns, { id: `mock-column-${Date.now()}`, key: fieldKey, label: newColumn.label.trim(), source: 'CUSTOM', data_type: newColumn.dataType, field_key: fieldKey, width: 160, sort_order: data.columns.length * 10 + 10, is_visible: true, is_editable: true, config: null }] });
      setNewColumn({ label: '', fieldKey: '', dataType: 'TEXT' }); setColumnOpen(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo crear la columna.'); }
    finally { setSaving(false); }
  };

  const createGroup = async () => {
    if (!data || !newGroupName.trim()) return;
    setSaving(true); setError(null);
    try {
      if (apiReady) { await bridataApi.createWorkBoardGroupV1(data.board.id, { name: newGroupName.trim(), color: '#16a34a', sortOrder: data.groups.length * 10 + 10 }); await loadData(data.board.id, selectedView?.id); }
      else setData({ ...data, groups: [...data.groups, { id: `mock-group-${Date.now()}`, key: safeBoardFieldKey(newGroupName), name: newGroupName.trim(), color: '#16a34a', sort_order: data.groups.length * 10 + 10 }] });
      setNewGroupName(''); setGroupOpen(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo crear el grupo.'); }
    finally { setSaving(false); }
  };

  const toggleColumn = async (column: ApiWorkBoardColumnV1) => {
    if (column.field_key === 'title') return;
    const next = hiddenColumnKeys.includes(column.key) ? hiddenColumnKeys.filter((key) => key !== column.key) : [...hiddenColumnKeys, column.key];
    await persistViewConfig({ hiddenColumnKeys: next });
  };

  const moveColumn = async (column: ApiWorkBoardColumnV1, direction: -1 | 1) => {
    const order = orderedColumns.map((item) => item.key); const index = order.indexOf(column.key); const target = index + direction;
    if (index < 0 || target < 0 || target >= order.length) return;
    [order[index], order[target]] = [order[target]!, order[index]!];
    await persistViewConfig({ columnOrder: order });
  };

  if (!data && loading) return <div className="p-8 text-[11px] text-slate-500">Cargando Board Editor...</div>;

  return (
    <div className="mx-auto w-full max-w-[1680px] px-5 py-5 lg:px-7">
      <div className="grid min-h-[calc(100vh-110px)] grid-cols-1 gap-4 xl:grid-cols-[240px_minmax(0,1fr)]">
        <aside className="command-panel overflow-hidden p-3">
          <div className="flex items-center justify-between px-2 py-2"><div><p className="text-[9px] font-black uppercase tracking-[0.14em] text-slate-400">Tableros</p><p className="mt-1 text-[11px] font-bold text-slate-700">{boards.length} en el workspace</p></div><LayoutGrid className="h-4 w-4 text-green-700" /></div>
          <div className="mt-2 space-y-1">{boards.map((board) => <button key={board.id} onClick={() => setSelectedBoardId(board.id)} className={`w-full rounded-xl px-3 py-3 text-left transition ${selectedBoardId === board.id ? 'bg-green-50 text-green-900 ring-1 ring-green-100' : 'text-slate-600 hover:bg-slate-50'}`}><p className="truncate text-[11px] font-bold">{board.name}</p><p className="mt-1 truncate text-[9px] text-slate-400">{board.description || 'Board configurable'}</p></button>)}</div>
        </aside>

        <main className="min-w-0 space-y-4">
          <section className="command-panel overflow-visible">
            <div className="flex flex-col gap-4 border-b border-slate-100 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0"><div className="flex items-center gap-2"><span className="rounded-full bg-green-50 px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.1em] text-green-800 ring-1 ring-green-100">Work OS Board</span>{saving && <span className="text-[9px] font-bold text-slate-400">Guardando...</span>}</div><h1 className="mt-2 truncate text-[22px] font-extrabold tracking-tight text-slate-950">{data?.board.name || 'Tablero'}</h1><p className="mt-1 text-[10px] text-slate-400">Un dato · múltiples vistas · configuración persistente.</p></div>
              <div className="flex flex-wrap items-center gap-2"><button onClick={() => setAddOpen(true)} className="inline-flex h-9 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-[10px] font-bold text-slate-700 hover:bg-slate-50"><ListPlus className="h-3.5 w-3.5" /> Añadir elementos</button><button onClick={() => setColumnOpen(true)} className="inline-flex h-9 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-[10px] font-bold text-slate-700 hover:bg-slate-50"><Plus className="h-3.5 w-3.5" /> Columna</button><button onClick={() => setSettingsOpen((value) => !value)} className={`inline-flex h-9 items-center gap-2 rounded-xl px-3 text-[10px] font-bold ${settingsOpen ? 'bg-green-700 text-white' : 'border border-slate-200 bg-white text-slate-700'}`}><Settings2 className="h-3.5 w-3.5" /> Vista</button></div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
              <div className="flex min-w-0 items-center gap-1 overflow-x-auto no-scrollbar">{data?.views.map((view) => <button key={view.id} onClick={() => { setActiveViewId(view.id); if (apiReady && data) void loadData(data.board.id, view.id); }} className={`inline-flex h-8 items-center gap-2 whitespace-nowrap rounded-lg px-3 text-[9px] font-black ${activeViewId === view.id ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-50'}`}>{view.view_type === 'KANBAN' ? <LayoutGrid className="h-3 w-3" /> : <Table2 className="h-3 w-3" />}{view.name}</button>)}</div>
              <div className="flex items-center gap-2"><div className="flex h-8 min-w-[220px] items-center gap-2 rounded-lg border border-slate-200 bg-white px-3"><Search className="h-3.5 w-3.5 text-slate-400" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar en la vista..." className="w-full bg-transparent text-[10px] outline-none placeholder:text-slate-300" /></div><button onClick={() => data && void loadData(data.board.id, selectedView?.id)} disabled={!apiReady} className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 bg-white text-slate-500 disabled:opacity-40"><RefreshCw className="h-3.5 w-3.5" /></button></div>
            </div>

            {settingsOpen && selectedView && <BoardViewSettingsV1 statusFilter={statusFilter} sortField={sortField} sortDirection={sortDirection} columns={orderedColumns} hiddenColumnKeys={hiddenColumnKeys} statuses={data?.items.map((item) => item.object.status) ?? []} onFilterChange={async (status) => persistViewConfig({ filters: { ...filterConfig, status } })} onSortChange={async (fieldKey, direction) => persistViewConfig({ sort: { fieldKey, direction } })} onToggleColumn={toggleColumn} onMoveColumn={moveColumn} onNewGroup={() => setGroupOpen(true)} />}
          </section>

          {error && <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[10px] font-semibold text-rose-700">{error}</div>}
          {selectedView?.view_type === 'KANBAN' ? <BoardKanbanV1 items={filteredItems} onDropStatus={dropStatus} onOpen={openObjectDrawer} /> : <BoardTableV1 items={filteredItems} groups={data?.groups ?? []} columns={visibleColumns} editing={editing} setEditing={setEditing} onSaveCell={saveCell} onMoveGroup={moveGroup} />}
        </main>
      </div>

      {addOpen && <AddBoardItemsDialogV1 search={availableSearch} onSearch={setAvailableSearch} items={available} onAdd={addItem} onClose={() => setAddOpen(false)} />}
      {columnOpen && <NewBoardColumnDialogV1 value={newColumn} onChange={setNewColumn} onCreate={createColumn} onClose={() => setColumnOpen(false)} saving={saving} />}
      {groupOpen && <NewBoardGroupDialogV1 name={newGroupName} onName={setNewGroupName} onCreate={createGroup} onClose={() => setGroupOpen(false)} saving={saving} />}
    </div>
  );
};
