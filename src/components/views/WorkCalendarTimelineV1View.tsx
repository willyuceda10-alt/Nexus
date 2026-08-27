import React, { useEffect, useMemo, useState } from 'react';
import { CalendarDays, GanttChartSquare, Plus, RefreshCw } from 'lucide-react';
import { bridataApi } from '../../api/client';
import { workOsTemporalV1Api } from '../../api/workOsTemporalV1Api';
import type { ApiBoardTemporalDataV1, ApiBoardTemporalItemV1 } from '../../api/workOsTemporalV1Contracts';
import type { ApiWorkBoardDetailV1, ApiWorkBoardSummaryV1, ApiWorkViewV1 } from '../../api/workOsBoardV1Contracts';
import { useApiBootstrap } from '../../context/ApiBootstrapContext';
import { useNexus } from '../../context/NexusContext';
import { buildBoardEditorMock } from './boardEditorV1/boardEditorMock';
import { BoardCalendarV1 } from './boardTemporalV1/BoardCalendarV1';
import { BoardTimelineV1 } from './boardTemporalV1/BoardTimelineV1';
import { NewTemporalViewDialogV1 } from './boardTemporalV1/NewTemporalViewDialogV1';

function mockTemporalItems(objects: ReturnType<typeof useNexus>['objects']): ApiBoardTemporalItemV1[] {
  return objects.flatMap((object) => {
    const start = object.startDate ?? object.endDate;
    if (!start) return [];
    const end = object.endDate ?? object.startDate ?? start;
    return [{
      objectId: object.id,
      objectTypeKey: object.type,
      title: object.title,
      status: object.status,
      priority: object.priority,
      progress: object.progress,
      start,
      end,
      groupId: null,
      sortOrder: 0,
      assignee: object.assigneeId ? { id: object.assigneeId, fullName: object.assigneeName || 'Equipo', avatarUrl: object.assigneeAvatar || null } : null,
    }];
  });
}

export const WorkCalendarTimelineV1View: React.FC = () => {
  const apiBootstrap = useApiBootstrap();
  const { tenant, currentWorkspace, objects, openObjectDrawer } = useNexus();
  const apiReady = apiBootstrap.dataMode === 'api' && apiBootstrap.status === 'ready';
  const mockBoard = useMemo(() => buildBoardEditorMock(objects), [objects]);
  const [boards, setBoards] = useState<ApiWorkBoardSummaryV1[]>([]);
  const [detail, setDetail] = useState<ApiWorkBoardDetailV1 | null>(null);
  const [selectedBoardId, setSelectedBoardId] = useState<string | null>(null);
  const [selectedViewId, setSelectedViewId] = useState<string | null>(null);
  const [temporal, setTemporal] = useState<ApiBoardTemporalDataV1 | null>(null);
  const [newViewOpen, setNewViewOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const temporalViews = detail?.views.filter((view) => view.view_type === 'CALENDAR' || view.view_type === 'TIMELINE') ?? [];
  const selectedView = temporalViews.find((view) => view.id === selectedViewId) ?? temporalViews[0] ?? null;

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

  const loadDetail = async (boardId: string) => {
    if (!apiReady) return;
    setLoading(true); setError(null);
    try {
      const result = await bridataApi.workBoardV1(boardId);
      setDetail(result);
      const first = result.views.find((view) => view.view_type === 'CALENDAR' || view.view_type === 'TIMELINE') ?? null;
      setSelectedViewId((current) => current && result.views.some((view) => view.id === current) ? current : first?.id ?? null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo cargar el Board.'); }
    finally { setLoading(false); }
  };

  const loadTemporal = async (boardId: string, view: ApiWorkViewV1) => {
    if (!apiReady) return;
    setLoading(true); setError(null);
    try {
      const now = new Date();
      const from = new Date(Date.UTC(now.getUTCFullYear() - 1, 0, 1)).toISOString();
      const to = new Date(Date.UTC(now.getUTCFullYear() + 2, 11, 31, 23, 59, 59)).toISOString();
      setTemporal(await workOsTemporalV1Api.data(tenant.id, boardId, view.id, from, to));
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo cargar la vista temporal.'); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    if (apiReady) void loadBoards();
    else {
      setBoards([mockBoard.board]);
      setSelectedBoardId(mockBoard.board.id);
      const calendar: ApiWorkViewV1 = { id: 'mock-calendar-v1', name: 'Calendario', view_type: 'CALENDAR', is_default: false, sort_order: 30, config: { temporal: { startFieldKey: 'startDate', endFieldKey: 'dueDate' } } };
      const timeline: ApiWorkViewV1 = { id: 'mock-timeline-v1', name: 'Timeline', view_type: 'TIMELINE', is_default: false, sort_order: 40, config: { temporal: { startFieldKey: 'startDate', endFieldKey: 'dueDate' } } };
      setDetail({ ...mockBoard.board, groups: mockBoard.groups, columns: mockBoard.columns, views: [...mockBoard.views, calendar, timeline] });
      setSelectedViewId(calendar.id);
      setTemporal({ viewId: calendar.id, viewType: 'CALENDAR', temporal: { startFieldKey: 'startDate', endFieldKey: 'dueDate', allDay: true }, items: mockTemporalItems(objects) });
    }
  }, [apiReady, currentWorkspace?.id, mockBoard]);

  useEffect(() => { if (apiReady && selectedBoardId) void loadDetail(selectedBoardId); }, [apiReady, selectedBoardId]);
  useEffect(() => { if (apiReady && selectedBoardId && selectedView) void loadTemporal(selectedBoardId, selectedView); }, [apiReady, selectedBoardId, selectedView?.id]);
  useEffect(() => {
    if (!apiReady && selectedView) setTemporal((current) => current ? { ...current, viewId: selectedView.id, viewType: selectedView.view_type as 'CALENDAR' | 'TIMELINE' } : current);
  }, [apiReady, selectedView?.id]);

  const createTemporalView = async (input: { name: string; viewType: 'CALENDAR' | 'TIMELINE'; config: { startFieldKey: string; endFieldKey?: string | null; titleFieldKey?: string; colorFieldKey?: string | null; allDay?: boolean } }) => {
    if (!detail) return;
    setSaving(true); setError(null);
    try {
      if (apiReady) {
        const created = await workOsTemporalV1Api.createView(tenant.id, detail.id, input);
        await loadDetail(detail.id);
        setSelectedViewId(created.id);
      } else {
        const created: ApiWorkViewV1 = { id: `mock-${input.viewType.toLowerCase()}-${Date.now()}`, name: input.name, view_type: input.viewType, is_default: false, sort_order: detail.views.length * 10 + 10, config: { temporal: input.config } };
        setDetail({ ...detail, views: [...detail.views, created] });
        setSelectedViewId(created.id);
        setTemporal({ viewId: created.id, viewType: input.viewType, temporal: input.config, items: mockTemporalItems(objects) });
      }
      setNewViewOpen(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo crear la vista temporal.'); }
    finally { setSaving(false); }
  };

  return (
    <div className="mx-auto w-full max-w-[1680px] px-5 py-5 lg:px-7">
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-[9px] font-black uppercase tracking-[0.14em] text-green-700">Planificación visual</p>
          <h1 className="mt-1 text-[24px] font-extrabold tracking-tight text-slate-950">Calendario & Timeline</h1>
          <p className="mt-1 text-[10px] text-slate-400">Los mismos objetos del Board, organizados por sus campos DATE.</p>
        </div>
        <button disabled={!detail} onClick={() => setNewViewOpen(true)} className="inline-flex h-9 items-center gap-2 rounded-xl bg-green-700 px-4 text-[10px] font-black text-white disabled:opacity-40"><Plus className="h-4 w-4" /> Nueva vista</button>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[250px_minmax(0,1fr)]">
        <aside className="command-panel p-3">
          <p className="px-2 py-2 text-[9px] font-black uppercase tracking-[0.12em] text-slate-400">Boards</p>
          <div className="space-y-1">{boards.map((board) => <button key={board.id} onClick={() => setSelectedBoardId(board.id)} className={`w-full rounded-xl px-3 py-3 text-left ${selectedBoardId === board.id ? 'bg-green-50 text-green-900 ring-1 ring-green-100' : 'text-slate-600 hover:bg-slate-50'}`}><p className="truncate text-[10px] font-bold">{board.name}</p><p className="mt-1 truncate text-[8px] text-slate-400">{board.description || 'Board configurable'}</p></button>)}</div>
        </aside>

        <main className="min-w-0 space-y-4">
          <section className="command-panel flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div className="flex items-center gap-1 overflow-x-auto">
              {temporalViews.map((view) => <button key={view.id} onClick={() => setSelectedViewId(view.id)} className={`inline-flex h-8 items-center gap-2 rounded-lg px-3 text-[9px] font-black ${selectedViewId === view.id ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-50'}`}>{view.view_type === 'CALENDAR' ? <CalendarDays className="h-3.5 w-3.5" /> : <GanttChartSquare className="h-3.5 w-3.5" />}{view.name}</button>)}
              {!temporalViews.length && <span className="px-2 text-[9px] text-slate-400">Este Board aún no tiene vistas temporales.</span>}
            </div>
            <button disabled={!apiReady || !selectedBoardId || !selectedView} onClick={() => selectedBoardId && selectedView && void loadTemporal(selectedBoardId, selectedView)} className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 bg-white text-slate-500 disabled:opacity-40"><RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /></button>
          </section>
          {error && <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[10px] font-semibold text-rose-700">{error}</div>}
          {temporal?.viewType === 'CALENDAR' && <BoardCalendarV1 items={temporal.items} onOpen={openObjectDrawer} />}
          {temporal?.viewType === 'TIMELINE' && <BoardTimelineV1 items={temporal.items} onOpen={openObjectDrawer} />}
          {!temporal && !loading && <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center"><p className="text-[11px] font-bold text-slate-700">Crea una vista Calendario o Timeline para este Board.</p></div>}
        </main>
      </div>

      {newViewOpen && detail && <NewTemporalViewDialogV1 columns={detail.columns} saving={saving} onClose={() => setNewViewOpen(false)} onCreate={createTemporalView} />}
    </div>
  );
};
