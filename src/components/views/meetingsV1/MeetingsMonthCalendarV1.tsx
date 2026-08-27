import React, { useMemo, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Video } from 'lucide-react';
import type { ApiMeetingV1 } from '../../../api/meetingsV1Contracts';

function startOfMonth(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), 1);
}

function addMonths(value: Date, months: number): Date {
  return new Date(value.getFullYear(), value.getMonth() + months, 1);
}

function dayKey(value: Date): string {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

function meetingDayKeys(meeting: ApiMeetingV1): string[] {
  const start = new Date(meeting.startAt);
  const end = new Date(meeting.endAt);
  const cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const last = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  const keys: string[] = [];
  let guard = 0;
  while (cursor <= last && guard < 370) {
    keys.push(dayKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
    guard += 1;
  }
  return keys;
}

function timeLabel(value: string): string {
  return new Intl.DateTimeFormat('es-PE', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

export const MeetingsMonthCalendarV1: React.FC<{
  meetings: ApiMeetingV1[];
  onOpen: (meetingObjectId: string) => void;
  onJoinTeams: (joinUrl: string) => void;
}> = ({ meetings, onOpen, onJoinTeams }) => {
  const [month, setMonth] = useState(() => startOfMonth(new Date()));

  const cells = useMemo(() => {
    const first = startOfMonth(month);
    const mondayOffset = (first.getDay() + 6) % 7;
    const gridStart = new Date(first);
    gridStart.setDate(first.getDate() - mondayOffset);
    return Array.from({ length: 42 }, (_, index) => {
      const date = new Date(gridStart);
      date.setDate(gridStart.getDate() + index);
      return date;
    });
  }, [month]);

  const meetingsByDay = useMemo(() => {
    const result = new Map<string, ApiMeetingV1[]>();
    for (const meeting of meetings) {
      for (const key of meetingDayKeys(meeting)) {
        const bucket = result.get(key) ?? [];
        bucket.push(meeting);
        result.set(key, bucket);
      }
    }
    for (const bucket of result.values()) {
      bucket.sort((a, b) => a.startAt.localeCompare(b.startAt));
    }
    return result;
  }, [meetings]);

  const monthLabel = new Intl.DateTimeFormat('es-PE', {
    month: 'long',
    year: 'numeric',
  }).format(month);
  const today = dayKey(new Date());

  return (
    <section className="command-panel overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-xl bg-green-50 text-green-700 ring-1 ring-green-100">
            <CalendarDays className="h-4 w-4" />
          </span>
          <div>
            <p className="text-[8px] font-black uppercase tracking-[0.12em] text-slate-400">Calendario de reuniones</p>
            <h2 className="mt-0.5 text-[13px] font-extrabold capitalize text-slate-900">{monthLabel}</h2>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => setMonth(addMonths(month, -1))} className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-slate-50" aria-label="Mes anterior">
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <button onClick={() => setMonth(startOfMonth(new Date()))} className="h-8 rounded-lg border border-slate-200 bg-white px-3 text-[9px] font-bold text-slate-600 hover:bg-slate-50">Hoy</button>
          <button onClick={() => setMonth(addMonths(month, 1))} className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-slate-50" aria-label="Mes siguiente">
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 border-b border-slate-100 bg-slate-50/70">
        {['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map((day) => (
          <div key={day} className="px-2 py-2 text-center text-[8px] font-black uppercase tracking-[0.08em] text-slate-400">{day}</div>
        ))}
      </div>

      <div className="grid grid-cols-7 bg-slate-100 gap-px">
        {cells.map((date) => {
          const key = dayKey(date);
          const inMonth = date.getMonth() === month.getMonth();
          const dayMeetings = meetingsByDay.get(key) ?? [];
          return (
            <div key={key} className={`min-h-[116px] bg-white p-2 ${inMonth ? '' : 'bg-slate-50/70'}`}>
              <div className="flex items-center justify-between">
                <span className={`grid h-6 min-w-6 place-items-center rounded-full px-1 text-[9px] font-bold ${key === today ? 'bg-green-700 text-white' : inMonth ? 'text-slate-700' : 'text-slate-300'}`}>{date.getDate()}</span>
                {dayMeetings.length > 0 && <span className="text-[8px] font-black text-slate-300">{dayMeetings.length}</span>}
              </div>
              <div className="mt-1.5 space-y-1">
                {dayMeetings.slice(0, 3).map((meeting) => (
                  <div key={`${key}-${meeting.id}`} className={`group rounded-lg border px-2 py-1.5 ${meeting.syncStatus === 'FAILED' ? 'border-rose-100 bg-rose-50' : meeting.joinUrl ? 'border-green-100 bg-green-50' : 'border-slate-100 bg-slate-50'}`}>
                    <button onClick={() => onOpen(meeting.meetingObjectId)} className="block w-full truncate text-left text-[8px] font-bold text-slate-700 group-hover:text-green-800">
                      {timeLabel(meeting.startAt)} · {meeting.title}
                    </button>
                    {meeting.joinUrl && (
                      <button onClick={() => onJoinTeams(meeting.joinUrl!)} className="mt-1 inline-flex items-center gap-1 text-[7px] font-black uppercase tracking-[0.06em] text-green-700">
                        <Video className="h-2.5 w-2.5" /> Teams
                      </button>
                    )}
                  </div>
                ))}
                {dayMeetings.length > 3 && <p className="px-1 text-[7px] font-bold text-slate-400">+{dayMeetings.length - 3} más</p>}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
};
