import React from 'react';
import { GripVertical } from 'lucide-react';
import type { ApiWorkBoardItemV1 } from '../../../api/workOsBoardV1Contracts';
import { DEFAULT_STATUSES, formatBoardDate, statusTone } from './boardEditorUtils';

export function BoardKanbanV1({
  items,
  onDropStatus,
  onOpen,
}: {
  items: ApiWorkBoardItemV1[];
  onDropStatus: (objectId: string, status: string) => Promise<void>;
  onOpen: (objectId: string) => void;
}) {
  const statuses = Array.from(new Set([...DEFAULT_STATUSES, ...items.map((item) => item.object.status)]));

  return (
    <div className="overflow-x-auto pb-2">
      <div className="grid min-w-[1100px] grid-flow-col auto-cols-[280px] gap-4">
        {statuses.map((status) => {
          const statusItems = items.filter((item) => item.object.status === status);
          return (
            <section
              key={status}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                const objectId = event.dataTransfer.getData('text/bridata-object-id');
                if (objectId) void onDropStatus(objectId, status);
              }}
              className="rounded-2xl border border-slate-200 bg-slate-50/70 p-3"
            >
              <div className="mb-3 flex items-center justify-between">
                <span className={`rounded-full px-2 py-1 text-[9px] font-black ring-1 ${statusTone(status)}`}>{status.replaceAll('_', ' ')}</span>
                <span className="text-[9px] font-bold text-slate-400">{statusItems.length}</span>
              </div>

              <div className="space-y-2.5">
                {statusItems.map((item) => (
                  <article
                    key={item.object.id}
                    draggable
                    onDragStart={(event) => event.dataTransfer.setData('text/bridata-object-id', item.object.id)}
                    className="cursor-grab rounded-xl border border-slate-200 bg-white p-3.5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] transition hover:-translate-y-0.5 hover:border-green-200 hover:shadow-md active:cursor-grabbing"
                  >
                    <div className="flex items-start gap-2">
                      <GripVertical className="mt-0.5 h-3.5 w-3.5 flex-none text-slate-300" />
                      <button onClick={() => onOpen(item.object.id)} className="min-w-0 flex-1 text-left">
                        <p className="text-[11px] font-extrabold leading-5 text-slate-900">{item.object.title}</p>
                        <p className="mt-2 text-[9px] font-semibold text-slate-400">{item.object.assignee?.fullName || 'Sin responsable'} · {formatBoardDate(item.object.dueDate)}</p>
                        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-green-600" style={{ width: `${Math.min(100, item.object.progress)}%` }} /></div>
                      </button>
                    </div>
                  </article>
                ))}
                {statusItems.length === 0 && <div className="rounded-xl border border-dashed border-slate-200 bg-white/60 p-6 text-center text-[9px] text-slate-400">Arrastra aquí</div>}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
