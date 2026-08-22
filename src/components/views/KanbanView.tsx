import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  Clock3,
  GripVertical,
  Plus,
  Search,
} from 'lucide-react';
import { useNexus } from '../../context/NexusContext';
import type { NexusObject, ObjectStatus, Priority } from '../../types/nexus';

interface KanbanColumn {
  id: string;
  title: string;
  description: string;
  statuses: ObjectStatus[];
  dropStatus: ObjectStatus;
  badgeClass: string;
  dotClass: string;
}

const COLUMNS: KanbanColumn[] = [
  {
    id: 'backlog',
    title: 'Planificación',
    description: 'Pendiente de iniciar',
    statuses: ['DRAFT', 'PLANNING', 'IDENTIFIED'],
    dropStatus: 'PLANNING',
    badgeClass: 'bg-slate-100 text-slate-700 ring-slate-200',
    dotClass: 'bg-slate-400',
  },
  {
    id: 'progress',
    title: 'En progreso',
    description: 'Trabajo en ejecución',
    statuses: ['IN_PROGRESS'],
    dropStatus: 'IN_PROGRESS',
    badgeClass: 'bg-green-50 text-green-800 ring-green-200',
    dotClass: 'bg-green-600',
  },
  {
    id: 'review',
    title: 'Revisión',
    description: 'Validación o aprobación',
    statuses: ['IN_REVIEW', 'PENDING_APPROVAL'],
    dropStatus: 'IN_REVIEW',
    badgeClass: 'bg-amber-50 text-amber-800 ring-amber-200',
    dotClass: 'bg-amber-500',
  },
  {
    id: 'blocked',
    title: 'Bloqueado',
    description: 'Requiere intervención',
    statuses: ['BLOCKED'],
    dropStatus: 'BLOCKED',
    badgeClass: 'bg-rose-50 text-rose-800 ring-rose-200',
    dotClass: 'bg-rose-500',
  },
  {
    id: 'done',
    title: 'Completado',
    description: 'Trabajo cerrado',
    statuses: ['COMPLETED', 'APPROVED'],
    dropStatus: 'COMPLETED',
    badgeClass: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
    dotClass: 'bg-emerald-500',
  },
];

const PRIORITY_TONE: Record<Priority, string> = {
  CRITICAL: 'bg-rose-50 text-rose-700 ring-rose-200',
  HIGH: 'bg-amber-50 text-amber-700 ring-amber-200',
  MEDIUM: 'bg-slate-100 text-slate-600 ring-slate-200',
  LOW: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
};

const BOARD_TYPES = new Set<NexusObject['type']>(['TASK', 'DELIVERABLE', 'MILESTONE', 'CHANGE_REQUEST', 'DOCUMENT']);

function shortDate(value?: string): string {
  if (!value) return 'Sin fecha';
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('es-PE', { day: '2-digit', month: 'short' }).format(date);
}

function isOverdue(item: NexusObject, today: string): boolean {
  return Boolean(
    item.endDate &&
      item.endDate < today &&
      !['COMPLETED', 'APPROVED', 'CANCELLED'].includes(item.status),
  );
}

export const KanbanView: React.FC<{ projectId: string }> = ({ projectId }) => {
  const { objects, openObjectDrawer, openCreateModal, updateNexusObject } = useNexus();
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropColumnId, setDropColumnId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [priority, setPriority] = useState<'ALL' | Priority>('ALL');
  const [savingId, setSavingId] = useState<string | null>(null);

  const today = new Date().toISOString().slice(0, 10);

  const boardItems = useMemo(
    () =>
      objects
        .filter((item) => item.projectId === projectId && BOARD_TYPES.has(item.type))
        .filter((item) => item.status !== 'CANCELLED')
        .filter((item) => priority === 'ALL' || item.priority === priority)
        .filter((item) => {
          const query = search.trim().toLowerCase();
          if (!query) return true;
          return [item.title, item.description, item.ownerName, item.assigneeName || '']
            .join(' ')
            .toLowerCase()
            .includes(query);
        })
        .sort((a, b) => {
          const aDate = a.endDate || '9999-12-31';
          const bDate = b.endDate || '9999-12-31';
          if (aDate !== bDate) return aDate.localeCompare(bDate);
          return b.priority.localeCompare(a.priority);
        }),
    [objects, priority, projectId, search],
  );

  const overdueCount = boardItems.filter((item) => isOverdue(item, today)).length;
  const blockedCount = boardItems.filter((item) => item.status === 'BLOCKED').length;
  const completedCount = boardItems.filter((item) => ['COMPLETED', 'APPROVED'].includes(item.status)).length;

  const moveItem = async (itemId: string, column: KanbanColumn) => {
    const item = boardItems.find((candidate) => candidate.id === itemId);
    if (!item || column.statuses.includes(item.status)) return;

    setSavingId(itemId);
    try {
      await updateNexusObject(itemId, { status: column.dropStatus });
    } finally {
      setSavingId(null);
      setDraggingId(null);
      setDropColumnId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex h-9 min-w-[250px] items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-slate-400">
            <Search className="h-3.5 w-3.5" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar trabajo, responsable..."
              className="w-full bg-transparent text-[10px] font-medium text-slate-700 outline-none placeholder:text-slate-400"
            />
          </div>

          <select
            value={priority}
            onChange={(event) => setPriority(event.target.value as 'ALL' | Priority)}
            className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-[10px] font-semibold text-slate-600 outline-none"
          >
            <option value="ALL">Toda prioridad</option>
            <option value="CRITICAL">Crítica</option>
            <option value="HIGH">Alta</option>
            <option value="MEDIUM">Media</option>
            <option value="LOW">Baja</option>
          </select>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-[9px] font-semibold">
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-600">{boardItems.length} visibles</span>
          <span className="rounded-full bg-rose-50 px-2.5 py-1 text-rose-700">{overdueCount} vencidos</span>
          <span className="rounded-full bg-amber-50 px-2.5 py-1 text-amber-700">{blockedCount} bloqueados</span>
          <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-emerald-700">{completedCount} cerrados</span>
          <button
            onClick={() => openCreateModal('TASK')}
            className="ml-1 flex h-9 items-center gap-2 rounded-xl bg-green-700 px-3 text-[10px] font-bold text-white transition hover:bg-green-800"
          >
            <Plus className="h-3.5 w-3.5" /> Nueva tarea
          </button>
        </div>
      </div>

      <div className="flex gap-3 overflow-x-auto pb-3">
        {COLUMNS.map((column) => {
          const columnItems = boardItems.filter((item) => column.statuses.includes(item.status));
          const isDropTarget = dropColumnId === column.id && Boolean(draggingId);

          return (
            <section
              key={column.id}
              onDragOver={(event) => {
                event.preventDefault();
                setDropColumnId(column.id);
              }}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                  setDropColumnId(null);
                }
              }}
              onDrop={(event) => {
                event.preventDefault();
                const itemId = event.dataTransfer.getData('text/plain') || draggingId;
                if (itemId) void moveItem(itemId, column);
              }}
              className={`flex min-h-[520px] w-[300px] flex-shrink-0 flex-col rounded-2xl border p-3 transition ${
                isDropTarget
                  ? 'border-green-300 bg-green-50/60 shadow-[inset_0_0_0_1px_rgba(34,197,94,0.15)]'
                  : 'border-slate-200 bg-slate-50/70'
              }`}
            >
              <header className="mb-3 flex items-start justify-between gap-3 px-1">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`h-2 w-2 rounded-full ${column.dotClass}`} />
                    <h3 className="text-[11px] font-bold text-slate-900">{column.title}</h3>
                    <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold ring-1 ${column.badgeClass}`}>
                      {columnItems.length}
                    </span>
                  </div>
                  <p className="mt-1 pl-4 text-[9px] text-slate-400">{column.description}</p>
                </div>
                <button
                  onClick={() => openCreateModal('TASK')}
                  className="grid h-7 w-7 place-items-center rounded-lg text-slate-400 transition hover:bg-white hover:text-green-700 hover:shadow-sm"
                  aria-label={`Agregar trabajo a ${column.title}`}
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </header>

              <div className="flex-1 space-y-2 overflow-y-auto pr-0.5 no-scrollbar">
                {columnItems.length === 0 ? (
                  <div className={`rounded-xl border border-dashed px-4 py-8 text-center text-[10px] transition ${isDropTarget ? 'border-green-300 text-green-700' : 'border-slate-200 text-slate-400'}`}>
                    {isDropTarget ? 'Suelta aquí para cambiar el estado' : 'Sin trabajo en esta etapa'}
                  </div>
                ) : (
                  columnItems.map((item) => {
                    const overdue = isOverdue(item, today);
                    const saving = savingId === item.id;
                    const ownerInitials = (item.assigneeName || item.ownerName || 'BP')
                      .split(' ')
                      .filter(Boolean)
                      .slice(0, 2)
                      .map((part) => part[0])
                      .join('')
                      .toUpperCase();

                    return (
                      <article
                        key={item.id}
                        draggable={!saving}
                        onDragStart={(event) => {
                          setDraggingId(item.id);
                          event.dataTransfer.effectAllowed = 'move';
                          event.dataTransfer.setData('text/plain', item.id);
                        }}
                        onDragEnd={() => {
                          setDraggingId(null);
                          setDropColumnId(null);
                        }}
                        onClick={() => openObjectDrawer(item.id)}
                        className={`group cursor-pointer rounded-xl border bg-white p-3.5 shadow-sm transition ${
                          draggingId === item.id
                            ? 'border-green-300 opacity-55'
                            : overdue
                              ? 'border-rose-200 hover:border-rose-300 hover:shadow-md'
                              : 'border-slate-200 hover:border-green-300 hover:shadow-md'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <GripVertical className="h-3.5 w-3.5 cursor-grab text-slate-300 transition group-hover:text-slate-500" />
                            <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-[0.08em] text-slate-500">
                              {item.type.replace('_', ' ')}
                            </span>
                          </div>
                          <span className={`rounded-full px-2 py-0.5 text-[8px] font-bold ring-1 ${PRIORITY_TONE[item.priority]}`}>
                            {item.priority}
                          </span>
                        </div>

                        <h4 className="mt-2.5 line-clamp-2 text-[11px] font-bold leading-4 text-slate-900 transition group-hover:text-green-800">
                          {item.title}
                        </h4>

                        {item.description && (
                          <p className="mt-1.5 line-clamp-2 text-[9px] leading-4 text-slate-400">{item.description}</p>
                        )}

                        <div className="mt-3 flex items-center justify-between gap-2 text-[9px]">
                          <span className={`flex items-center gap-1 font-semibold ${overdue ? 'text-rose-600' : 'text-slate-400'}`}>
                            {overdue ? <AlertTriangle className="h-3 w-3" /> : <CalendarDays className="h-3 w-3" />}
                            {shortDate(item.endDate)}
                          </span>
                          <span className="font-bold text-green-700">{item.progress}%</span>
                        </div>

                        <div className="mt-2 h-1 overflow-hidden rounded-full bg-slate-100">
                          <div
                            className={`h-full rounded-full transition-all ${['COMPLETED', 'APPROVED'].includes(item.status) ? 'bg-emerald-500' : item.status === 'BLOCKED' ? 'bg-rose-500' : 'bg-green-600'}`}
                            style={{ width: `${Math.max(0, Math.min(100, item.progress))}%` }}
                          />
                        </div>

                        <footer className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2.5">
                          <div className="flex min-w-0 items-center gap-2">
                            <span className="grid h-6 w-6 flex-shrink-0 place-items-center rounded-lg bg-green-50 text-[8px] font-bold text-green-800 ring-1 ring-green-100">
                              {ownerInitials}
                            </span>
                            <span className="max-w-[120px] truncate text-[9px] font-medium text-slate-500">
                              {item.assigneeName || item.ownerName || 'Sin responsable'}
                            </span>
                          </div>
                          {saving ? (
                            <span className="flex items-center gap-1 text-[8px] font-semibold text-green-700"><Clock3 className="h-3 w-3 animate-pulse" />Guardando</span>
                          ) : ['COMPLETED', 'APPROVED'].includes(item.status) ? (
                            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                          ) : null}
                        </footer>
                      </article>
                    );
                  })
                )}
              </div>
            </section>
          );
        })}
      </div>

      <p className="px-1 text-[9px] font-medium text-slate-400">
        Arrastra una tarjeta entre columnas para cambiar su estado. El cambio se persiste usando el mismo control de versión de Bridata Project.
      </p>
    </div>
  );
};
