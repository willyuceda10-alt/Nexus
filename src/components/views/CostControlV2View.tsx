import React, { useMemo } from 'react';
import { CircleDollarSign, FolderKanban } from 'lucide-react';
import { useNexus } from '../../context/NexusContext';
import { ProjectCostsV2View } from './ProjectCostsV2View';

export const CostControlV2View: React.FC = () => {
  const { objects, selectedProjectId, setSelectedProjectId } = useNexus();
  const projects = useMemo(() => objects.filter((item) => item.type === 'PROJECT'), [objects]);
  const projectId = selectedProjectId && projects.some((item) => item.id === selectedProjectId)
    ? selectedProjectId
    : projects[0]?.id ?? null;

  if (!projectId) {
    return (
      <div className="mx-auto max-w-[1500px] px-6 py-8 lg:px-8">
        <div className="command-panel flex min-h-[360px] flex-col items-center justify-center border-dashed text-center">
          <CircleDollarSign className="h-8 w-8 text-green-700" />
          <h2 className="mt-4 text-[15px] font-extrabold text-slate-900">Cost Engine V2 necesita un proyecto</h2>
          <p className="mt-2 text-[11px] text-slate-500">Crea un proyecto para comenzar a controlar presupuesto, compromisos, reales y forecast.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-5 px-6 py-6 lg:px-8">
      <header className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <div className="flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-[0.14em] text-green-700"><CircleDollarSign className="h-4 w-4" /> Control financiero de proyectos</div>
          <h1 className="mt-2 text-[25px] font-extrabold tracking-tight text-slate-950">Centro de costos</h1>
          <p className="mt-1 text-[11px] text-slate-500">Presupuesto, compromisos, costos reales y forecast conectados a WBS, materiales y compras.</p>
        </div>
        <label className="flex min-w-[300px] items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
          <FolderKanban className="h-4 w-4 text-slate-400" />
          <select value={projectId} onChange={(event) => setSelectedProjectId(event.target.value)} className="min-w-0 flex-1 bg-transparent text-[11px] font-bold text-slate-700 outline-none">
            {projects.map((project) => <option key={project.id} value={project.id}>{project.title}</option>)}
          </select>
        </label>
      </header>
      <ProjectCostsV2View projectId={projectId} />
    </div>
  );
};