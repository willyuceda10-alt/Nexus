import React, { useMemo } from 'react';
import {
  ArrowRight,
  BadgeCheck,
  Boxes,
  CircleDollarSign,
  Database,
  FileSpreadsheet,
  PackageSearch,
  ShoppingCart,
  ShieldCheck,
  Warehouse,
  Workflow,
} from 'lucide-react';
import { useNexus } from '../../context/NexusContext';

type TargetTab = 'procurement' | 'inventory' | 'costs' | 'integrations' | 'materials';

interface ModuleCard {
  id: TargetTab;
  eyebrow: string;
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  version: string;
}

const modules: ModuleCard[] = [
  {
    id: 'procurement',
    eyebrow: 'Abastecimiento',
    title: 'Compras / Por llegar',
    description: 'SolP, Pedido SAP, posiciones, proveedores, entregas parciales y saldo pendiente por recibir.',
    icon: ShoppingCart,
    version: 'V1-G3',
  },
  {
    id: 'inventory',
    eyebrow: 'Inventario',
    title: 'Stock SAP',
    description: 'Entradas, reversas, consumos, stock canónico y trazabilidad exacta por documento y posición.',
    icon: Warehouse,
    version: 'V1-G4',
  },
  {
    id: 'costs',
    eyebrow: 'Finanzas',
    title: 'Costos SAP',
    description: 'DATA PEP como costo real, compromisos abiertos y lectura financiera sin doble conteo logístico.',
    icon: CircleDollarSign,
    version: 'V1-G5',
  },
  {
    id: 'integrations',
    eyebrow: 'Conectividad',
    title: 'Integraciones SAP',
    description: 'Estado de sincronización, fuentes detectadas, autenticación y salud del canal de integración.',
    icon: Workflow,
    version: 'V1-G1',
  },
];

const flow = [
  { label: 'SolP', detail: 'Solicitud', icon: FileSpreadsheet },
  { label: 'Pedido', detail: 'OC SAP', icon: ShoppingCart },
  { label: '101', detail: 'Recepción', icon: PackageSearch },
  { label: 'Stock', detail: 'Inventario', icon: Warehouse },
  { label: '221', detail: 'Consumo', icon: Boxes },
  { label: 'DATA PEP', detail: 'Costo real', icon: CircleDollarSign },
];

export const SapCommandCenterV1H1View: React.FC = () => {
  const {
    currentWorkspace,
    objects,
    selectedProjectId,
    setSelectedProjectId,
    setActiveTab,
  } = useNexus();

  const projects = useMemo(
    () => objects.filter((item) => item.type === 'PROJECT'),
    [objects],
  );

  const projectId = selectedProjectId && projects.some((project) => project.id === selectedProjectId)
    ? selectedProjectId
    : projects[0]?.id ?? null;

  const selectedProject = projects.find((project) => project.id === projectId) ?? null;

  const openModule = (tab: TargetTab) => {
    if (projectId && selectedProjectId !== projectId) setSelectedProjectId(projectId);
    setActiveTab(tab);
  };

  return (
    <div className="mx-auto w-full max-w-[1660px] space-y-5 px-6 py-6 lg:px-8">
      <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-[0_14px_45px_rgba(15,23,42,0.045)]">
        <div className="grid xl:grid-cols-[minmax(0,1.45fr)_minmax(360px,0.55fr)]">
          <div className="p-6 lg:p-7">
            <div className="flex flex-wrap items-center gap-2 text-[10px] font-black uppercase tracking-[0.14em] text-green-700">
              <Database className="h-4 w-4" /> Centro SAP · V1-H1
            </div>
            <h1 className="mt-3 max-w-4xl text-[30px] font-extrabold tracking-[-0.04em] text-slate-950">
              La cadena SAP completa, visible desde una sola pantalla.
            </h1>
            <p className="mt-3 max-w-3xl text-[12px] leading-5 text-slate-500">
              Bridata conecta abastecimiento, recepción, inventario, consumo y costo real con trazabilidad documental. Excel queda como canal de carga; el runtime opera sobre PostgreSQL Bridata.
            </p>

            <div className="mt-5 flex flex-wrap gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1.5 text-[9px] font-extrabold text-emerald-700 ring-1 ring-emerald-200">
                <BadgeCheck className="h-3.5 w-3.5" /> DATA PEP = autoridad real
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-50 px-3 py-1.5 text-[9px] font-extrabold text-slate-600 ring-1 ring-slate-200">
                <Database className="h-3.5 w-3.5" /> BRIDATA_POSTGRESQL
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-50 px-3 py-1.5 text-[9px] font-extrabold text-sky-700 ring-1 ring-sky-200">
                <ShieldCheck className="h-3.5 w-3.5" /> Sin dependencia Excel en runtime
              </span>
            </div>
          </div>

          <div className="border-t border-slate-100 bg-slate-50/70 p-6 xl:border-l xl:border-t-0">
            <p className="text-[9px] font-black uppercase tracking-[0.13em] text-slate-400">Contexto operativo</p>
            <p className="mt-2 text-[13px] font-extrabold text-slate-900">{currentWorkspace?.name ?? 'Workspace'}</p>
            <p className="mt-1 text-[9px] text-slate-400">Selecciona el proyecto que gobernará costos y trazabilidad financiera.</p>

            <label className="mt-4 block rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
              <span className="text-[8px] font-black uppercase tracking-[0.1em] text-slate-400">Proyecto activo</span>
              <select
                value={projectId ?? ''}
                onChange={(event) => setSelectedProjectId(event.target.value)}
                disabled={projects.length === 0}
                className="mt-1.5 w-full bg-transparent text-[11px] font-bold text-slate-800 outline-none disabled:text-slate-400"
              >
                {projects.length === 0 && <option value="">Sin proyectos disponibles</option>}
                {projects.map((project) => <option key={project.id} value={project.id}>{project.title}</option>)}
              </select>
            </label>

            <div className="mt-4 grid grid-cols-2 gap-2">
              <div className="rounded-xl border border-slate-200 bg-white p-3">
                <p className="text-[8px] font-black uppercase tracking-[0.09em] text-slate-400">Proyecto</p>
                <p className="mt-1 truncate text-[10px] font-bold text-slate-800">{selectedProject?.title ?? 'Sin selección'}</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-3">
                <p className="text-[8px] font-black uppercase tracking-[0.09em] text-slate-400">Estado</p>
                <p className="mt-1 text-[10px] font-bold text-green-700">Cadena habilitada</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-[0_6px_28px_rgba(15,23,42,0.03)]">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-[9px] font-black uppercase tracking-[0.13em] text-slate-400">Flujo canónico</p>
            <h2 className="mt-1 text-[15px] font-extrabold text-slate-950">Documento → movimiento → costo</h2>
          </div>
          <button onClick={() => openModule('materials')} className="inline-flex items-center gap-2 text-[10px] font-bold text-green-700 hover:text-green-800">
            Abrir flujo de materiales <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="mt-5 overflow-x-auto pb-1">
          <div className="flex min-w-[920px] items-center">
            {flow.map((step, index) => {
              const Icon = step.icon;
              return (
                <React.Fragment key={step.label}>
                  <div className="min-w-[122px] flex-1 rounded-2xl border border-slate-200 bg-slate-50/60 p-4 text-center">
                    <div className="mx-auto grid h-10 w-10 place-items-center rounded-xl bg-white text-green-700 shadow-sm ring-1 ring-slate-200">
                      <Icon className="h-4.5 w-4.5" />
                    </div>
                    <p className="mt-3 text-[11px] font-extrabold text-slate-900">{step.label}</p>
                    <p className="mt-1 text-[8px] font-semibold text-slate-400">{step.detail}</p>
                  </div>
                  {index < flow.length - 1 && (
                    <div className="flex w-10 flex-none items-center justify-center text-slate-300">
                      <ArrowRight className="h-4 w-4" />
                    </div>
                  )}
                </React.Fragment>
              );
            })}
          </div>
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {modules.map((module) => {
          const Icon = module.icon;
          return (
            <button
              key={module.id}
              onClick={() => openModule(module.id)}
              className="group flex min-h-[205px] flex-col rounded-[22px] border border-slate-200 bg-white p-5 text-left shadow-[0_5px_24px_rgba(15,23,42,0.028)] transition hover:-translate-y-0.5 hover:border-green-200 hover:shadow-md"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="grid h-11 w-11 place-items-center rounded-2xl bg-green-50 text-green-700 ring-1 ring-green-100">
                  <Icon className="h-5 w-5" />
                </div>
                <span className="rounded-full bg-slate-50 px-2.5 py-1 text-[8px] font-black text-slate-500 ring-1 ring-slate-200">{module.version}</span>
              </div>
              <p className="mt-5 text-[8px] font-black uppercase tracking-[0.12em] text-green-700">{module.eyebrow}</p>
              <h3 className="mt-1 text-[14px] font-extrabold text-slate-950">{module.title}</h3>
              <p className="mt-2 flex-1 text-[9px] leading-4 text-slate-500">{module.description}</p>
              <div className="mt-4 flex items-center gap-2 text-[9px] font-extrabold text-slate-700 transition group-hover:text-green-700">
                Abrir módulo <ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" />
              </div>
            </button>
          );
        })}
      </section>

      <section className="grid gap-3 lg:grid-cols-4">
        <ControlRule title="Documento + posición" detail="La trazabilidad conserva la identidad SAP exacta para pedido, recepción, salida y reversa." />
        <ControlRule title="DATA PEP gobierna el real" detail="Los movimientos físicos no sustituyen el costo real cuando la autoridad financiera ya está activa." />
        <ControlRule title="SolP no duplica Pedido" detail="El compromiso pre-Pedido se cierra cuando aparece la orden de compra correspondiente." />
        <ControlRule title="Excel es transporte" detail="Las pantallas operativas consumen datos persistidos; no dependen del archivo durante la ejecución." />
      </section>
    </div>
  );
};

const ControlRule: React.FC<{ title: string; detail: string }> = ({ title, detail }) => (
  <div className="rounded-[18px] border border-slate-200 bg-white p-4 shadow-sm">
    <div className="flex items-center gap-2">
      <ShieldCheck className="h-4 w-4 flex-none text-emerald-600" />
      <p className="text-[10px] font-extrabold text-slate-800">{title}</p>
    </div>
    <p className="mt-2 text-[8px] leading-4 text-slate-400">{detail}</p>
  </div>
);
