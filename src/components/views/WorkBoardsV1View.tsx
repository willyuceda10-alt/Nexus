import React, { useEffect, useMemo, useState } from 'react';
import {
  ChevronDown,
  Columns3,
  LayoutGrid,
  ListFilter,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Table2,
} from 'lucide-react';
import { bridataApi, BridataApiError } from '../../api/client';
import type {
  ApiWorkBoardColumnV1,
  ApiWorkBoardDataV1,
  ApiWorkBoardGroupV1,
  ApiWorkBoardItemV1,
  ApiWorkBoardSummaryV1,
  ApiWorkViewV1,
} from '../../api/workOsBoardV1Contracts';
import { useApiBootstrap } from '../../context/ApiBootstrapContext';
import { useNexus } from '../../context/NexusContext';

const MOCK_BOARD_ID = 'mock-work-board';

function formatDate(value: unknown): string {
  if (!value) return '—';
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('es-PE', { day: '2-digit', month: 'short' }).format(date);
}

function statusTone(status: string): string {
  const value = status.toUpperCase();
  if (['COMPLETED', 'APPROVED', 'DONE'].includes(value)) return 'bg-emerald-50 text-emerald-700 ring-emerald-200';
  if (['BLOCKED', 'CANCELLED'].includes(value)) return 'bg-rose-50 text-rose-700 ring-rose-200';
  if (['IN_PROGRESS', 'IN_REVIEW'].includes(value)) return 'bg-green-50 text-green-800 ring-green-200';
  return 'bg-slate-100 text-slate-600 ring-slate-200';
}

function displayCell(item: ApiWorkBoardItemV1, column: ApiWorkBoardColumnV1): React.ReactNode {
  const object = item.object as unknown as Record<string, unknown>;
  const value = column.source === 'CORE' ? object[column.field_key] : item.customFields[column.field_key];

  if (column.field_key === 'assigneeId') {
    return item.object.assignee?.fullName || <span className="text-slate-300">Sin asignar</span>;
  }
  if (column.data_type === 'DATE') return formatDate(value);
  if (column.data_type === 'STATUS') {
    const text = String(value ?? 'Sin estado').replaceAll('_', ' ');
    return <span className={`inline-flex rounded-full px-2 py-1 text-[9px] font-black ring-1 ${statusTone(String(value ?? ''))}`}>{text}</span>;
  }
  if (column.data_type === 'PRIORITY') {
    return <span className="text-[10px] font-bold text-slate-600">{String(value ?? '—').replaceAll('_', ' ')}</span>;
  }
  if (column.data_type === 'PROGRESS') {
    const progress = Math.max(0, Math.min(100, Number(value ?? 0)));
    return (
      <div className="flex min-w-[110px] items-center gap-2">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-green-600" style={{ width: `${progress}%` }} /></div>
        <span className="w-8 text-right text-[9px] font-bold text-slate-500">{progress}%</span>
      </div>
    );
  }
  if (column.data_type === 'BOOLEAN') return value ? 'Sí' : 'No';
  return value === null || value === undefined || value === '' ? <span className="text-slate-300">—</span> : String(value);
}

function MockBoardData(): ApiWorkBoardDataV1 {
  return {
    board: {
      id: MOCK_BOARD_ID,
      workspaceId: 'mock',
      objectDefinitionId: 'mock-task-definition',
      name: 'Ejecución operativa',
      description: 'Trabajo activo del workspace organizado en un Board configurable.',
      icon: 'layout-grid',
      isArchived: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    groups: [
      { id: 'g-plan', key: 'planificado', name: 'Planificado', color: '#94a3b8', sort_order: 10 },
      { id: 'g-run', key: 'ejecucion', name: 'En ejecución', color: '#16a34a', sort_order: 20 },
      { id: 'g-close', key: 'cerrado', name: 'Cerrado', color: '#059669', sort_order: 30 },
    ],
    columns: [
      { id: 'c-title', key: 'titulo', label: 'Elemento', source: 'CORE', data_type: 'TEXT', field_key: 'title', width: 340, sort_order: 10, is_visible: true, is_editable: true, config: null },
      { id: 'c-status', key: 'estado', label: 'Estado', source: 'CORE', data_type: 'STATUS', field_key: 'status', width: 150, sort_order: 20, is_visible: true, is_editable: true, config: null },
      { id: 'c-owner', key: 'responsable', label: 'Responsable', source: 'CORE', data_type: 'PERSON', field_key: 'assigneeId', width: 180, sort_order: 30, is_visible: true, is_editable: true, config: null },
      { id: 'c-date', key: 'fecha_fin', label: 'Fecha objetivo', source: 'CORE', data_type: 'DATE', field_key: 'dueDate', width: 145, sort_order: 40, is_visible: true, is_editable: true, config: null },
      { id: 'c-progress', key: 'avance', label: 'Avance', source: 'CORE', data_type: 'PROGRESS', field_key: 'progress', width: 140, sort_order: 50, is_visible: true, is_editable: true, config: null },
    ],
    views: [
      { id: 'v-table', name: 'Tabla principal', view_type: 'TABLE', is_default: true, sort_order: 10, config: { density: 'comfortable' } },
      { id: 'v-kanban', name: 'Kanban', view_type: 'KANBAN', is_default: false, sort_order: 20, config: { kanbanColumnKey: 'status' } },
    ],
    selectedView: { id: 'v-table', name: 'Tabla principal', view_type: 'TABLE', is_default: true, sort_order: 10, config: { density: 'comfortable' } },
    items: [],
  };
}

function BoardTable({ data, onOpen }: { data: ApiWorkBoardDataV1; onOpen: (id: string) => void }) {
  const visibleColumns = data.columns.filter((column) => column.is_visible);
  const groupMap = new Map(data.groups.map((group) => [group.id, group]));
  const groups: Array<{ group: ApiWorkBoardGroupV1 | null; items: ApiWorkBoardItemV1[] }> = [];
  for (const group of data.groups) groups.push({ group, items: data.items.filter((item) => item.placement.groupId === group.id) });
  const ungrouped = data.items.filter((item) => !item.placement.groupId || !groupMap.has(item.placement.groupId));
  if (ungrouped.length) groups.unshift({ group: null, items: ungrouped });
  if (groups.length === 0) groups.push({ group: null, items: [] });

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <div className="overflow-x-auto">
        <div style={{ minWidth: Math.max(880, visibleColumns.reduce((sum, column) => sum + (column.width ?? 150), 0) + 60) }}>
          <div className="grid border-b border-slate-200 bg-slate-50/80" style={{ gridTemplateColumns: `44px ${visibleColumns.map((column) => `${column.width ?? 150}px`).join(' ')}` }}>
            <div className="border-r border-slate-200 px-3 py-3 text-[9px] font-black uppercase tracking-[0.12em] text-slate-400">#</div>
            {visibleColumns.map((column) => <div key={column.id} className="border-r border-slate-200 px-3 py-3 text-[9px] font-black uppercase tracking-[0.1em] text-slate-500 last:border-r-0">{column.label}</div>)}
          </div>

          {groups.map(({ group, items }) => (
            <div key={group?.id ?? 'ungrouped'}>
              <div className="flex items-center gap-2 border-b border-slate-100 bg-white px-4 py-2.5">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: group?.color || '#cbd5e1' }} />
                <span className="text-[11px] font-extrabold text-slate-800">{group?.name || 'Sin grupo'}</span>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[9px] font-bold text-slate-500">{items.length}</span>
              </div>
              {items.length === 0 ? (
                <div className="border-b border-slate-100 px-14 py-4 text-[10px] text-slate-400">Sin elementos en este grupo.</div>
              ) : items.map((item, index) => (
                <button key={item.object.id} onClick={() => onOpen(item.object.id)} className="grid w-full border-b border-slate-100 text-left transition hover:bg-green-50/30" style={{ gridTemplateColumns: `44px ${visibleColumns.map((column) => `${column.width ?? 150}px`).join(' ')}` }}>
                  <div className="border-r border-slate-100 px-3 py-3 text-center text-[9px] font-semibold text-slate-300">{index + 1}</div>
                  {visibleColumns.map((column) => (
                    <div key={column.id} className={`min-w-0 border-r border-slate-100 px-3 py-3 text-[10px] text-slate-600 last:border-r-0 ${column.field_key === 'title' ? 'font-bold text-slate-900' : ''}`}>
                      <div className="truncate">{displayCell(item, column)}</div>
                    </div>
                  ))}
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function BoardKanban({ data, onOpen }: { data: ApiWorkBoardDataV1; onOpen: (id: string) => void }) {
  const statuses = Array.from(new Set(data.items.map((item) => item.object.status || 'DRAFT')));
  if (statuses.length === 0) statuses.push('DRAFT', 'IN_PROGRESS', 'COMPLETED');
  return (
    <div className="grid min-w-[920px] grid-cols-3 gap-4 overflow-x-auto pb-2">
      {statuses.map((status) => {
        const items = data.items.filter((item) => (item.object.status || 'DRAFT') === status);
        return (
          <section key={status} className="rounded-2xl border border-slate-200 bg-slate-50/70 p-3">
            <div className="mb-3 flex items-center justify-between px-1">
              <div className="flex items-center gap-2"><span className={`h-2.5 w-2.5 rounded-full ${status.includes('COMP') || status.includes('APPRO') ? 'bg-emerald-500' : status.includes('PROGRESS') ? 'bg-green-600' : 'bg-slate-400'}`} /><h3 className="text-[10px] font-black uppercase tracking-[0.09em] text-slate-700">{status.replaceAll('_', ' ')}</h3></div>
              <span className="rounded-full bg-white px-2 py-0.5 text-[9px] font-bold text-slate-500 ring-1 ring-slate-200">{items.length}</span>
            </div>
            <div className="space-y-2.5">
              {items.length === 0 ? <div className="rounded-xl border border-dashed border-slate-200 bg-white/60 p-5 text-center text-[10px] text-slate-400">Sin elementos</div> : items.map((item) => (
                <button key={item.object.id} onClick={() => onOpen(item.object.id)} className="w-full rounded-xl border border-slate-200 bg-white p-3.5 text-left shadow-[0_1px_2px_rgba(15,23,42,0.03)] transition hover:-translate-y-0.5 hover:border-green-200 hover:shadow-md">
                  <p className="text-[11px] font-extrabold leading-5 text-slate-900">{item.object.title}</p>
                  <div className="mt-3 flex items-center justify-between gap-3"><span className="truncate text-[9px] font-semibold text-slate-400">{item.object.assignee?.fullName || 'Sin responsable'}</span><span className="text-[9px] font-bold text-slate-500">{formatDate(item.object.dueDate)}</span></div>
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-green-600" style={{ width: `${Math.min(100, item.object.progress)}%` }} /></div>
                </button>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

export const WorkBoardsV1View: React.FC = () => {
  const apiBootstrap = useApiBootstrap();
  const { currentWorkspace, objects, openObjectDrawer } = useNexus();
  const apiReady = apiBootstrap.dataMode === 'api' && apiBootstrap.status === 'ready';
  const [boards, setBoards] = useState<ApiWorkBoardSummaryV1[]>([]);
  const [selectedBoardId, setSelectedBoardId] = useState<string | null>(null);
  const [data, setData] = useState<ApiWorkBoardDataV1 | null>(null);
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createDefinitionId, setCreateDefinitionId] = useState('');

  const definitions = apiBootstrap.bootstrap?.objectDefinitions ?? [];

  const mockData = useMemo(() => {
    const base = MockBoardData();
    const tasks = objects.filter((object) => object.type === 'TASK').slice(0, 18);
    base.items = tasks.map((object, index) => ({
      object: {
        id: object.id,
        objectTypeKey: object.type,
        title: object.title,
        description: object.description || null,
        status: object.status,
        priority: object.priority,
        progress: object.progress,
        ownerId: object.ownerId,
        assigneeId: object.assigneeId || null,
        startDate: object.startDate || null,
        dueDate: object.endDate || null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        version: 1,
        owner: { id: object.ownerId, fullName: 'Responsable', email: '', avatarUrl: null },
        assignee: object.assigneeId ? { id: object.assigneeId, fullName: 'Equipo asignado', email: '', avatarUrl: null } : null,
      },
      customFields: {},
      placement: {
        groupId: ['COMPLETED', 'APPROVED'].includes(object.status) ? 'g-close' : object.status === 'IN_PROGRESS' ? 'g-run' : 'g-plan',
        sortOrder: index * 10,
      },
    }));
    return base;
  }, [objects]);

  const loadBoards = async () => {
    if (!apiReady || !currentWorkspace) return;
    setLoading(true); setError(null);
    try {
      const result = await bridataApi.workBoardsV1(currentWorkspace.id);
      setBoards(result.items);
      setSelectedBoardId((current) => current && result.items.some((board) => board.id === current) ? current : result.items[0]?.id ?? null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudieron cargar los tableros.');
    } finally { setLoading(false); }
  };

  useEffect(() => {
    if (!apiReady) {
      setBoards([mockData.board]);
      setSelectedBoardId(MOCK_BOARD_ID);
      setData(mockData);
      setActiveViewId(mockData.selectedView?.id ?? null);
      return;
    }
    void loadBoards();
  }, [apiReady, currentWorkspace?.id]);

  useEffect(() => {
    if (!apiReady || !selectedBoardId) return;
    let cancelled = false;
    setLoading(true); setError(null);
    bridataApi.workBoardDataV1(selectedBoardId, activeViewId)
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setActiveViewId((current) => current ?? result.selectedView?.id ?? result.views[0]?.id ?? null);
      })
      .catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : 'No se pudo abrir el tablero.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [apiReady, selectedBoardId, activeViewId]);

  const selectedView: ApiWorkViewV1 | null = data?.views.find((view) => view.id === activeViewId) ?? data?.selectedView ?? null;
  const filteredData = useMemo<ApiWorkBoardDataV1 | null>(() => {
    if (!data || !search.trim()) return data;
    const term = search.trim().toLowerCase();
    return { ...data, items: data.items.filter((item) => item.object.title.toLowerCase().includes(term) || item.object.status.toLowerCase().includes(term)) };
  }, [data, search]);

  const createBoard = async () => {
    if (!apiReady || !currentWorkspace || !createName.trim() || !createDefinitionId) return;
    setLoading(true); setError(null);
    try {
      const created = await bridataApi.createWorkBoardV1({ workspaceId: currentWorkspace.id, objectDefinitionId: createDefinitionId, name: createName.trim() });
      setCreateOpen(false); setCreateName(''); setCreateDefinitionId('');
      await loadBoards();
      setSelectedBoardId(created.id);
    } catch (cause) {
      setError(cause instanceof BridataApiError ? cause.message : cause instanceof Error ? cause.message : 'No se pudo crear el tablero.');
    } finally { setLoading(false); }
  };

  return (
    <div className="flex min-h-full">
      <aside className="hidden w-[238px] flex-none border-r border-slate-200 bg-white/80 xl:block">
        <div className="border-b border-slate-100 px-4 py-4"><p className="text-[9px] font-black uppercase tracking-[0.14em] text-slate-400">Tableros del workspace</p><p className="mt-1 truncate text-[11px] font-bold text-slate-800">{currentWorkspace?.name || 'Workspace'}</p></div>
        <div className="p-3">
          <button onClick={() => setCreateOpen(true)} className="mb-3 flex h-9 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-green-300 bg-green-50/60 text-[10px] font-black text-green-800 hover:bg-green-50"><Plus className="h-3.5 w-3.5" /> Nuevo tablero</button>
          <div className="space-y-1">
            {boards.map((board) => <button key={board.id} onClick={() => { setSelectedBoardId(board.id); setActiveViewId(null); }} className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-[11px] transition ${selectedBoardId === board.id ? 'bg-green-50 font-extrabold text-green-900 ring-1 ring-green-100' : 'font-semibold text-slate-600 hover:bg-slate-50'}`}><LayoutGrid className="h-3.5 w-3.5 flex-none" /><span className="truncate">{board.name}</span></button>)}
            {!loading && boards.length === 0 && <div className="rounded-xl border border-dashed border-slate-200 p-4 text-center text-[10px] leading-5 text-slate-400">No hay tableros todavía.<br />Crea el primero.</div>}
          </div>
        </div>
      </aside>

      <div className="min-w-0 flex-1 px-5 py-5 lg:px-7">
        <section className="mb-4 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[9px] font-black uppercase tracking-[0.12em] text-green-700"><Columns3 className="h-3.5 w-3.5" /> Work OS · Board Engine V1</div>
            <h1 className="mt-2 truncate text-[24px] font-black tracking-[-0.03em] text-slate-950">{data?.board.name || 'Tableros'}</h1>
            <p className="mt-1 max-w-2xl text-[11px] leading-5 text-slate-500">{data?.board.description || 'Organiza objetos del workspace en vistas configurables sin duplicar los datos.'}</p>
          </div>
          <div className="flex items-center gap-2"><button className="grid h-9 w-9 place-items-center rounded-xl border border-slate-200 bg-white text-slate-500 hover:bg-slate-50" title="Filtros"><ListFilter className="h-4 w-4" /></button><button className="grid h-9 w-9 place-items-center rounded-xl border border-slate-200 bg-white text-slate-500 hover:bg-slate-50" title="Configurar tablero"><Settings2 className="h-4 w-4" /></button><button onClick={() => setCreateOpen(true)} className="flex h-9 items-center gap-2 rounded-xl bg-green-700 px-3.5 text-[10px] font-black text-white shadow-sm hover:bg-green-800"><Plus className="h-3.5 w-3.5" /> Nuevo tablero</button></div>
        </section>

        <section className="mb-4 rounded-2xl border border-slate-200 bg-white p-2.5 shadow-sm">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto no-scrollbar">
              {(data?.views ?? []).map((view) => <button key={view.id} onClick={() => setActiveViewId(view.id)} className={`flex h-9 items-center gap-2 whitespace-nowrap rounded-xl px-3 text-[10px] font-black transition ${activeViewId === view.id ? 'bg-green-700 text-white' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800'}`}>{view.view_type === 'KANBAN' ? <LayoutGrid className="h-3.5 w-3.5" /> : <Table2 className="h-3.5 w-3.5" />}{view.name}</button>)}
              <button className="flex h-9 items-center gap-2 rounded-xl px-3 text-[10px] font-bold text-slate-400 hover:bg-slate-50"><Plus className="h-3.5 w-3.5" /> Vista</button>
            </div>
            <div className="relative min-w-[230px]"><Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar en este tablero..." className="h-9 w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-3 text-[10px] font-medium text-slate-700 outline-none focus:border-green-300 focus:bg-white" /></div>
          </div>
        </section>

        {error && <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[10px] font-semibold text-rose-700">{error}</div>}
        {loading && !filteredData ? <div className="flex min-h-[260px] items-center justify-center rounded-2xl border border-slate-200 bg-white"><RefreshCw className="h-5 w-5 animate-spin text-green-700" /></div> : filteredData ? (
          selectedView?.view_type === 'KANBAN' ? <BoardKanban data={filteredData} onOpen={openObjectDrawer} /> : <BoardTable data={filteredData} onOpen={openObjectDrawer} />
        ) : <div className="rounded-2xl border border-dashed border-slate-300 bg-white/70 p-12 text-center text-[11px] text-slate-500">Selecciona o crea un tablero para empezar.</div>}
      </div>

      {createOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/20 p-4 backdrop-blur-[2px]">
          <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-5 shadow-2xl">
            <div className="flex items-start justify-between"><div><p className="text-[9px] font-black uppercase tracking-[0.14em] text-green-700">Nuevo tablero</p><h2 className="mt-1 text-[17px] font-black text-slate-950">Configura tu espacio de trabajo</h2></div><button onClick={() => setCreateOpen(false)} className="rounded-lg px-2 py-1 text-slate-400 hover:bg-slate-100">×</button></div>
            <label className="mt-5 block text-[10px] font-bold text-slate-600">Nombre<input value={createName} onChange={(event) => setCreateName(event.target.value)} placeholder="Ej. Control semanal de mantenimiento" className="mt-2 h-10 w-full rounded-xl border border-slate-200 px-3 text-[11px] outline-none focus:border-green-400" /></label>
            {apiReady ? <label className="mt-4 block text-[10px] font-bold text-slate-600">Tipo de objeto<select value={createDefinitionId} onChange={(event) => setCreateDefinitionId(event.target.value)} className="mt-2 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-[11px] outline-none focus:border-green-400"><option value="">Selecciona una definición</option>{definitions.map((definition) => <option key={definition.id} value={definition.id}>{definition.name} · {definition.key}</option>)}</select></label> : <div className="mt-4 rounded-xl bg-green-50 px-3 py-3 text-[10px] leading-5 text-green-800">El preview está en modo mock. La creación persistente se habilita al conectar la API DEV; el diseño puede revisarse ahora.</div>}
            <div className="mt-5 flex justify-end gap-2"><button onClick={() => setCreateOpen(false)} className="h-9 rounded-xl border border-slate-200 px-4 text-[10px] font-bold text-slate-600">Cancelar</button><button onClick={() => void createBoard()} disabled={!apiReady || !createName.trim() || !createDefinitionId || loading} className="h-9 rounded-xl bg-green-700 px-4 text-[10px] font-black text-white disabled:cursor-not-allowed disabled:opacity-40">Crear tablero</button></div>
          </div>
        </div>
      )}
    </div>
  );
};
