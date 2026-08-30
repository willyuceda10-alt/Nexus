import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  CalendarClock,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  Database,
  Gauge,
  Layers3,
  ShieldCheck,
  Target,
  UsersRound,
} from 'lucide-react';
import { useApiBootstrap } from '../../context/ApiBootstrapContext';
import { useNexus } from '../../context/NexusContext';
import {
  workspaceSummaryV1Api,
  type WorkspaceSummaryV1,
} from '../../api/workspaceSummaryV1Client';

function localSummary(
  workspaceId: string,
  currentUserId: string,
  objects: ReturnType<typeof useNexus>['objects'],
  pendingApprovals: number,
): WorkspaceSummaryV1 {
  const scoped = objects.filter((item) => item.workspaceId === workspaceId);
  const projects = scoped.filter((item) => item.type === 'PROJECT');
  const activeProjects = projects.filter((item) => !['COMPLETED', 'CANCELLED', 'APPROVED'].includes(item.status));
  const openItems = scoped.filter(
    (item) => ['TASK', 'MILESTONE', 'DELIVERABLE', 'CHANGE_REQUEST', 'RISK'].includes(item.type)
      && !['COMPLETED', 'CANCELLED', 'APPROVED', 'CLOSED'].includes(item.status),
  );
  const today = new Date();
  const in14 = new Date(today.getTime() + 14 * 86_400_000);
  const due = (value?: string) => value ? new Date(`${value}T23:59:59`) : null;
  const criticalRisks = scoped.filter(
    (item) => item.type === 'RISK' && item.status !== 'CLOSED'
      && (item.priority === 'CRITICAL' || (item.riskScore ?? 0) >= 15),
  );

  return {
    workspaceId,
    totalObjects: scoped.length,
    projects: {
      total: projects.length,
      active: activeProjects.length,
      completed: projects.filter((item) => ['COMPLETED', 'APPROVED'].includes(item.status)).length,
      averageProgress: activeProjects.length
        ? Math.round(activeProjects.reduce((sum, item) => sum + item.progress, 0) / activeProjects.length)
        : 0,
    },
    work: {
      open: openItems.length,
      mine: openItems.filter((item) => item.assigneeId === currentUserId || item.ownerId === currentUserId).length,
      blocked: scoped.filter((item) => item.status === 'BLOCKED').length,
      overdue: openItems.filter((item) => {
        const date = due(item.endDate);
        return Boolean(date && date < today);
      }).length,
      dueNext14Days: openItems.filter((item) => {
        const date = due(item.endDate);
        return Boolean(date && date >= today && date < in14);
      }).length,
    },
    risk: { critical: criticalRisks.length },
    approvals: { pending: pendingApprovals },
    generatedAt: new Date().toISOString(),
  };
}

function MetricCard({
  label,
  value,
  hint,
  icon,
  tone = 'neutral',
}: {
  label: string;
  value: string | number;
  hint: string;
  icon: React.ReactNode;
  tone?: 'neutral' | 'good' | 'warn' | 'danger';
}) {
  const toneClass = {
    neutral: 'bg-slate-50 text-slate-700',
    good: 'bg-emerald-50 text-emerald-700',
    warn: 'bg-amber-50 text-amber-700',
    danger: 'bg-rose-50 text-rose-700',
  }[tone];

  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-slate-500">{label}</p>
          <p className="mt-2 text-3xl font-black tracking-tight text-slate-950">{value}</p>
          <p className="mt-1 text-xs text-slate-500">{hint}</p>
        </div>
        <div className={`grid h-10 w-10 place-items-center rounded-xl ${toneClass}`}>{icon}</div>
      </div>
    </article>
  );
}

function ActionCard({
  title,
  detail,
  icon,
  onClick,
}: {
  title: string;
  detail: string;
  icon: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="group flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 text-left transition hover:border-emerald-200 hover:bg-emerald-50/40"
    >
      <span className="grid h-9 w-9 flex-none place-items-center rounded-lg bg-slate-100 text-slate-600 group-hover:bg-white group-hover:text-emerald-700">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-bold text-slate-900">{title}</span>
        <span className="mt-0.5 block text-xs text-slate-500">{detail}</span>
      </span>
      <ArrowRight className="h-4 w-4 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-emerald-600" />
    </button>
  );
}

export const PmoCommandCenterV1H4View: React.FC = () => {
  const apiBootstrap = useApiBootstrap();
  const {
    currentWorkspace,
    currentUser,
    objects,
    approvals,
    setActiveTab,
    getProjectHealth,
  } = useNexus();
  const [summary, setSummary] = useState<WorkspaceSummaryV1 | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const workspaceRole = useMemo(() => {
    if (!currentWorkspace || !apiBootstrap.bootstrap) return currentUser.roleName;
    return apiBootstrap.bootstrap.workspaces.find((item) => item.id === currentWorkspace.id)?.role
      ?? currentUser.roleName;
  }, [apiBootstrap.bootstrap, currentUser.roleName, currentWorkspace]);

  useEffect(() => {
    if (!currentWorkspace) {
      setSummary(null);
      return;
    }
    if (apiBootstrap.dataMode !== 'api' || apiBootstrap.status !== 'ready') {
      setSummary(localSummary(
        currentWorkspace.id,
        currentUser.id,
        objects,
        approvals.filter((item) => item.status === 'PENDING').length,
      ));
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void workspaceSummaryV1Api.get(currentWorkspace.id, controller.signal)
      .then(setSummary)
      .catch((cause) => {
        if (controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : 'No se pudo cargar el resumen PMO.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [
    apiBootstrap.dataMode,
    apiBootstrap.status,
    currentWorkspace,
    currentUser.id,
    objects,
    approvals,
  ]);

  const activeProjects = useMemo(() => objects
    .filter((item) => item.workspaceId === currentWorkspace?.id && item.type === 'PROJECT')
    .filter((item) => !['COMPLETED', 'CANCELLED', 'APPROVED'].includes(item.status))
    .map((project) => ({ project, health: getProjectHealth(project.id) }))
    .sort((a, b) => a.health.healthScore - b.health.healthScore)
    .slice(0, 6), [objects, currentWorkspace?.id, getProjectHealth]);

  const isPmo = ['PMO_SENIOR', 'OWNER', 'ADMIN', 'TENANT_ADMIN'].includes(workspaceRole.replaceAll(' ', '_').toUpperCase());
  const value = summary;

  return (
    <div className="mx-auto w-full max-w-[1680px] px-4 py-5 sm:px-5 lg:px-7">
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 bg-[linear-gradient(135deg,#F8FBF9_0%,#EEF8F1_100%)] px-5 py-5 lg:px-6">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-bold text-emerald-800">
                  <ShieldCheck className="h-3.5 w-3.5" /> Control PMO
                </span>
                <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-600">
                  {workspaceRole.replaceAll('_', ' ')}
                </span>
              </div>
              <h1 className="mt-3 text-2xl font-black tracking-tight text-slate-950 sm:text-3xl">PMO Senior · Centro de control</h1>
              <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">
                Controla portafolio, cronograma, baselines, cambios, riesgos, capacidad y señales SAP sin asumir privilegios de administración técnica.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-600">
                Workspace: <strong className="text-slate-900">{currentWorkspace?.name ?? '—'}</strong>
              </span>
              <span className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-600">
                {loading ? 'Actualizando…' : value ? `Actualizado ${new Date(value.generatedAt).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' })}` : 'Sin datos'}
              </span>
            </div>
          </div>
          {!isPmo && (
            <div className="mt-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-none" />
              Esta vista puede consultarse, pero las acciones PMO quedan sujetas al RBAC del servidor. El rol recomendado es PMO Senior.
            </div>
          )}
          {error && <p className="mt-3 text-xs font-semibold text-rose-600">{error}</p>}
        </div>

        <div className="p-5 lg:p-6">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard label="Proyectos activos" value={value?.projects.active ?? '—'} hint={`${value?.projects.averageProgress ?? 0}% avance promedio`} icon={<Layers3 className="h-5 w-5" />} tone="good" />
            <MetricCard label="Vencidos" value={value?.work.overdue ?? '—'} hint={`${value?.work.dueNext14Days ?? 0} próximos en 14 días`} icon={<CalendarClock className="h-5 w-5" />} tone={(value?.work.overdue ?? 0) > 0 ? 'danger' : 'good'} />
            <MetricCard label="Riesgos críticos" value={value?.risk.critical ?? '—'} hint={`${value?.work.blocked ?? 0} elementos bloqueados`} icon={<AlertTriangle className="h-5 w-5" />} tone={(value?.risk.critical ?? 0) > 0 ? 'warn' : 'good'} />
            <MetricCard label="Decisiones pendientes" value={value?.approvals.pending ?? '—'} hint="Aprobaciones y cambios por resolver" icon={<Target className="h-5 w-5" />} tone={(value?.approvals.pending ?? 0) > 0 ? 'warn' : 'neutral'} />
          </div>

          <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(320px,0.75fr)]">
            <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
              <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3.5">
                <div>
                  <h2 className="text-sm font-black text-slate-950">Salud del portafolio</h2>
                  <p className="mt-0.5 text-xs text-slate-500">Proyectos con menor salud primero</p>
                </div>
                <button onClick={() => setActiveTab('portfolios')} className="text-xs font-bold text-emerald-700 hover:text-emerald-800">Ver portafolios</button>
              </div>
              <div className="divide-y divide-slate-100">
                {activeProjects.map(({ project, health }) => (
                  <button key={project.id} onClick={() => setActiveTab('projects')} className="grid w-full gap-3 px-4 py-3 text-left transition hover:bg-slate-50 sm:grid-cols-[minmax(0,1fr)_110px_130px] sm:items-center">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-slate-900">{project.title}</p>
                      <p className="mt-0.5 truncate text-xs text-slate-500">{project.description || 'Sin descripción'}</p>
                    </div>
                    <div>
                      <p className="text-[11px] font-semibold text-slate-500">Avance</p>
                      <p className="mt-0.5 text-sm font-black text-slate-900">{project.progress}%</p>
                    </div>
                    <div>
                      <p className="text-[11px] font-semibold text-slate-500">Salud</p>
                      <div className="mt-1 flex items-center gap-2">
                        <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.max(0, Math.min(100, health.healthScore))}%` }} /></div>
                        <strong className="text-xs text-slate-700">{health.healthScore}</strong>
                      </div>
                    </div>
                  </button>
                ))}
                {activeProjects.length === 0 && (
                  <div className="flex items-center gap-2 px-4 py-8 text-sm text-slate-500"><CheckCircle2 className="h-4 w-4 text-emerald-600" /> No hay proyectos activos para revisar.</div>
                )}
              </div>
            </section>

            <section className="space-y-3">
              <div className="rounded-2xl border border-slate-200 bg-[#F8FAF9] p-4">
                <div className="flex items-center gap-2"><Gauge className="h-4 w-4 text-emerald-700" /><h2 className="text-sm font-black text-slate-950">Accesos PMO</h2></div>
                <div className="mt-3 space-y-2">
                  <ActionCard title="Plan maestro" detail="Cronograma, hitos y ruta crítica" icon={<Clock3 className="h-4 w-4" />} onClick={() => setActiveTab('timeline')} />
                  <ActionCard title="Costos y forecast" detail="Lectura SAP + proyección EAC" icon={<CircleDollarSign className="h-4 w-4" />} onClick={() => setActiveTab('costs')} />
                  <ActionCard title="Capacidad de recursos" detail="Carga, disponibilidad y cuellos" icon={<UsersRound className="h-4 w-4" />} onClick={() => setActiveTab('resources')} />
                  <ActionCard title="Centro SAP" detail="Trazabilidad SolP → costo real" icon={<Database className="h-4 w-4" />} onClick={() => setActiveTab('sap')} />
                  <ActionCard title="Analítica ejecutiva" detail="KPIs consolidados del workspace" icon={<BarChart3 className="h-4 w-4" />} onClick={() => setActiveTab('reports')} />
                </div>
              </div>

              <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4">
                <div className="flex items-center gap-2 text-emerald-800"><ShieldCheck className="h-4 w-4" /><p className="text-sm font-black">Separación de funciones</p></div>
                <p className="mt-2 text-xs leading-5 text-emerald-900/80">
                  PMO Senior puede gobernar baseline, cambios, forecast y portafolio. No administra permisos, integraciones ni modifica el costo real autoritativo proveniente de SAP/DATA PEP.
                </p>
              </div>
            </section>
          </div>
        </div>
      </section>
    </div>
  );
};
