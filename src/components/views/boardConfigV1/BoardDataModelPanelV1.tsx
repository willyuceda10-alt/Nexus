import React, { useMemo, useState } from 'react';
import { Calculator, Link2, ListChecks, UsersRound, X } from 'lucide-react';
import type { BoardConfigV1, BoardFormulaExpressionV1 } from '../../../api/workOsBoardConfigV1Api';
import type { ApiWorkBoardColumnV1 } from '../../../api/workOsBoardV1Contracts';
import { safeBoardFieldKey } from '../boardEditorV1/boardEditorUtils';

export function BoardDataModelPanelV1({
  columns,
  config,
  saving,
  onClose,
  onSaveOptions,
  onCreateRelation,
  onCreateFormula,
}: {
  columns: ApiWorkBoardColumnV1[];
  config: BoardConfigV1;
  saving: boolean;
  onClose: () => void;
  onSaveOptions: (column: ApiWorkBoardColumnV1, options: Array<{ key: string; label: string; color?: string | null }>) => Promise<void>;
  onCreateRelation: (input: { label: string; fieldKey: string; targetBoardId: string; multiple: boolean }) => Promise<void>;
  onCreateFormula: (input: { label: string; fieldKey: string; expression: BoardFormulaExpressionV1; format: 'NUMBER' | 'CURRENCY' | 'PERCENT'; decimals: number }) => Promise<void>;
}) {
  const configurableOptions = columns.filter((column) => ['STATUS', 'PRIORITY', 'TAGS'].includes(column.data_type));
  const numericColumns = columns.filter((column) => ['NUMBER', 'CURRENCY', 'PROGRESS'].includes(column.data_type));
  const [optionColumnId, setOptionColumnId] = useState(configurableOptions[0]?.id ?? '');
  const activeOptionSet = config.optionSets.find((set) => set.columnId === optionColumnId);
  const [optionText, setOptionText] = useState('');
  const [relation, setRelation] = useState({ label: '', targetBoardId: config.boards.find((board) => board.id !== config.boardId)?.id ?? '', multiple: false });
  const [formula, setFormula] = useState({ label: '', left: numericColumns[0]?.field_key ?? 'progress', op: 'MULTIPLY' as 'ADD' | 'SUBTRACT' | 'MULTIPLY' | 'DIVIDE' | 'MIN' | 'MAX', right: numericColumns[1]?.field_key ?? 'progress', format: 'NUMBER' as 'NUMBER' | 'CURRENCY' | 'PERCENT' });

  const effectiveOptionText = useMemo(() => {
    if (optionText) return optionText;
    return (activeOptionSet?.options.filter((option) => option.isActive !== false) ?? []).map((option) => `${option.label}|${option.color ?? ''}`).join('\n');
  }, [optionText, activeOptionSet]);

  const parseOptions = () => effectiveOptionText.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
    const [labelPart, colorPart] = line.split('|');
    const label = (labelPart ?? '').trim();
    return { key: safeBoardFieldKey(label), label, color: colorPart?.trim() || null };
  }).filter((option) => option.label);

  const formulaExpression: BoardFormulaExpressionV1 = {
    kind: 'BINARY', op: formula.op,
    left: { kind: 'FIELD', fieldKey: formula.left },
    right: { kind: 'FIELD', fieldKey: formula.right },
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/20 backdrop-blur-[2px]" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
      <aside className="h-full w-full max-w-[560px] overflow-y-auto border-l border-slate-200 bg-[#F8FAF9] shadow-[-24px_0_70px_rgba(15,23,42,0.16)]">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white/95 px-6 py-5 backdrop-blur">
          <div><p className="text-[9px] font-black uppercase tracking-[0.14em] text-green-700">Board Configuration V1</p><h2 className="mt-1 text-[18px] font-extrabold tracking-tight text-slate-950">Modelo de datos</h2><p className="mt-1 text-[10px] text-slate-400">Opciones, personas, relaciones y fórmulas gobernadas.</p></div>
          <button onClick={onClose} className="grid h-9 w-9 place-items-center rounded-xl border border-slate-200 bg-white text-slate-500 hover:bg-slate-50"><X className="h-4 w-4" /></button>
        </div>

        <div className="space-y-4 p-5">
          <section className="rounded-2xl border border-slate-200 bg-white p-5">
            <div className="flex items-start gap-3"><span className="grid h-9 w-9 place-items-center rounded-xl bg-green-50 text-green-700"><UsersRound className="h-4 w-4" /></span><div><h3 className="text-[12px] font-extrabold text-slate-900">Personas del workspace</h3><p className="mt-1 text-[9px] text-slate-400">El selector PERSON solo muestra miembros activos de este workspace.</p></div></div>
            <div className="mt-4 grid grid-cols-2 gap-2">{config.people.slice(0, 8).map((person) => <div key={person.id} className="rounded-xl bg-slate-50 px-3 py-2.5"><p className="truncate text-[10px] font-bold text-slate-800">{person.fullName}</p><p className="mt-0.5 truncate text-[8px] font-semibold text-slate-400">{person.workspaceRole}</p></div>)}</div>
            <p className="mt-3 text-[9px] text-slate-400">{config.people.length} miembros elegibles.</p>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5">
            <div className="flex items-start gap-3"><span className="grid h-9 w-9 place-items-center rounded-xl bg-emerald-50 text-emerald-700"><ListChecks className="h-4 w-4" /></span><div><h3 className="text-[12px] font-extrabold text-slate-900">Opciones administradas</h3><p className="mt-1 text-[9px] text-slate-400">Estados, prioridades y etiquetas mantienen un diccionario versionable por columna.</p></div></div>
            <div className="mt-4 space-y-3">
              <select value={optionColumnId} onChange={(event) => { setOptionColumnId(event.target.value); setOptionText(''); }} className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-[10px] font-bold text-slate-700">
                {configurableOptions.map((column) => <option key={column.id} value={column.id}>{column.label} · {column.data_type}</option>)}
              </select>
              <textarea value={effectiveOptionText} onChange={(event) => setOptionText(event.target.value)} rows={6} placeholder={'Pendiente|#94a3b8\nEn curso|#16a34a\nCompletado|#059669'} className="w-full rounded-xl border border-slate-200 px-3 py-3 font-mono text-[9px] leading-5 text-slate-600 outline-none focus:border-green-500" />
              <p className="text-[8px] text-slate-400">Una opción por línea: <span className="font-mono">Etiqueta|#color</span>. Las opciones retiradas se desactivan; no se borran del histórico.</p>
              <button disabled={!optionColumnId || saving || parseOptions().length === 0} onClick={() => { const column = columns.find((item) => item.id === optionColumnId); if (column) void onSaveOptions(column, parseOptions()).then(() => setOptionText('')); }} className="h-9 w-full rounded-xl bg-green-700 text-[9px] font-black text-white disabled:opacity-40">Guardar diccionario</button>
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5">
            <div className="flex items-start gap-3"><span className="grid h-9 w-9 place-items-center rounded-xl bg-sky-50 text-sky-700"><Link2 className="h-4 w-4" /></span><div><h3 className="text-[12px] font-extrabold text-slate-900">Conectar tableros</h3><p className="mt-1 text-[9px] text-slate-400">Crea una columna RELATION respaldada por ObjectRelation.</p></div></div>
            <div className="mt-4 space-y-3">
              <input value={relation.label} onChange={(event) => setRelation({ ...relation, label: event.target.value })} placeholder="Ej. Proyecto relacionado" className="h-10 w-full rounded-xl border border-slate-200 px-3 text-[10px] font-semibold outline-none focus:border-green-500" />
              <select value={relation.targetBoardId} onChange={(event) => setRelation({ ...relation, targetBoardId: event.target.value })} className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-[10px] font-bold text-slate-700">{config.boards.filter((board) => board.id !== config.boardId).map((board) => <option key={board.id} value={board.id}>{board.name}</option>)}</select>
              <label className="flex items-center gap-2 text-[9px] font-semibold text-slate-600"><input type="checkbox" checked={relation.multiple} onChange={(event) => setRelation({ ...relation, multiple: event.target.checked })} /> Permitir varios elementos relacionados</label>
              <button disabled={!relation.label.trim() || !relation.targetBoardId || saving} onClick={() => void onCreateRelation({ ...relation, fieldKey: safeBoardFieldKey(relation.label) }).then(() => setRelation({ ...relation, label: '' }))} className="h-9 w-full rounded-xl bg-slate-900 text-[9px] font-black text-white disabled:opacity-40">Crear columna conectada</button>
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5">
            <div className="flex items-start gap-3"><span className="grid h-9 w-9 place-items-center rounded-xl bg-amber-50 text-amber-700"><Calculator className="h-4 w-4" /></span><div><h3 className="text-[12px] font-extrabold text-slate-900">Fórmula segura</h3><p className="mt-1 text-[9px] text-slate-400">Solo aritmética tipada. Sin JavaScript, eval ni referencias circulares.</p></div></div>
            <div className="mt-4 space-y-3">
              <input value={formula.label} onChange={(event) => setFormula({ ...formula, label: event.target.value })} placeholder="Ej. Costo total" className="h-10 w-full rounded-xl border border-slate-200 px-3 text-[10px] font-semibold outline-none focus:border-green-500" />
              <div className="grid grid-cols-[1fr_100px_1fr] gap-2">
                <select value={formula.left} onChange={(event) => setFormula({ ...formula, left: event.target.value })} className="h-10 rounded-xl border border-slate-200 bg-white px-2 text-[9px] font-bold text-slate-700">{numericColumns.map((column) => <option key={column.id} value={column.field_key}>{column.label}</option>)}</select>
                <select value={formula.op} onChange={(event) => setFormula({ ...formula, op: event.target.value as typeof formula.op })} className="h-10 rounded-xl border border-slate-200 bg-white px-2 text-[9px] font-black text-slate-700"><option value="ADD">+</option><option value="SUBTRACT">−</option><option value="MULTIPLY">×</option><option value="DIVIDE">÷</option><option value="MIN">MIN</option><option value="MAX">MAX</option></select>
                <select value={formula.right} onChange={(event) => setFormula({ ...formula, right: event.target.value })} className="h-10 rounded-xl border border-slate-200 bg-white px-2 text-[9px] font-bold text-slate-700">{numericColumns.map((column) => <option key={column.id} value={column.field_key}>{column.label}</option>)}</select>
              </div>
              <select value={formula.format} onChange={(event) => setFormula({ ...formula, format: event.target.value as typeof formula.format })} className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-[9px] font-bold text-slate-700"><option value="NUMBER">Número</option><option value="CURRENCY">Moneda</option><option value="PERCENT">Porcentaje</option></select>
              <button disabled={!formula.label.trim() || numericColumns.length === 0 || saving} onClick={() => void onCreateFormula({ label: formula.label.trim(), fieldKey: safeBoardFieldKey(formula.label), expression: formulaExpression, format: formula.format, decimals: 2 }).then(() => setFormula({ ...formula, label: '' }))} className="h-9 w-full rounded-xl bg-amber-500 text-[9px] font-black text-slate-950 disabled:opacity-40">Crear fórmula</button>
            </div>
          </section>
        </div>
      </aside>
    </div>
  );
}
