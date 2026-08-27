import React, { useMemo, useState } from 'react';
import { Search, UserRoundCheck } from 'lucide-react';
import type { ApiMeetingWorkspacePersonV1 } from '../../../api/meetingsV1Contracts';

export const MeetingAttendeePickerV1: React.FC<{
  people: ApiMeetingWorkspacePersonV1[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}> = ({ people, selectedIds, onChange }) => {
  const [query, setQuery] = useState('');
  const selected = new Set(selectedIds);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return people.filter((person) => !needle || `${person.fullName} ${person.email} ${person.workspaceRole}`.toLowerCase().includes(needle));
  }, [people, query]);

  const toggle = (id: string) => {
    if (selected.has(id)) onChange(selectedIds.filter((value) => value !== id));
    else onChange([...selectedIds, id]);
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-[8px] font-black uppercase tracking-[0.1em] text-slate-400">Participantes Bridata</p>
          <p className="mt-0.5 text-[9px] font-semibold text-slate-600">{selectedIds.length} seleccionados</p>
        </div>
        <UserRoundCheck className="h-4 w-4 text-green-700" />
      </div>
      <label className="mt-2 flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5">
        <Search className="h-3.5 w-3.5 text-slate-400" />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar persona..." className="min-w-0 flex-1 bg-transparent text-[9px] outline-none" />
      </label>
      <div className="mt-2 max-h-36 space-y-1 overflow-y-auto pr-1">
        {filtered.map((person) => {
          const checked = selected.has(person.id);
          return (
            <button key={person.id} type="button" onClick={() => toggle(person.id)} className={`flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left ${checked ? 'border-green-200 bg-green-50' : 'border-transparent bg-white hover:border-slate-200'}`}>
              {person.avatarUrl ? <img src={person.avatarUrl} alt="" className="h-7 w-7 rounded-lg object-cover" /> : <span className="grid h-7 w-7 place-items-center rounded-lg bg-slate-100 text-[8px] font-black text-slate-600">{person.fullName.slice(0, 2).toUpperCase()}</span>}
              <span className="min-w-0 flex-1"><span className="block truncate text-[9px] font-bold text-slate-800">{person.fullName}{person.isCurrentUser ? ' · Tú' : ''}</span><span className="block truncate text-[7px] text-slate-400">{person.email} · {person.workspaceRole}</span></span>
              <span className={`h-4 w-4 rounded border ${checked ? 'border-green-700 bg-green-700 shadow-[inset_0_0_0_3px_white]' : 'border-slate-300 bg-white'}`} />
            </button>
          );
        })}
        {!filtered.length && <p className="px-2 py-4 text-center text-[8px] text-slate-400">No hay personas que coincidan.</p>}
      </div>
    </div>
  );
};
