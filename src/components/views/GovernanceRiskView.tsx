import React, { useState } from 'react';
import { ShieldAlert, AlertTriangle, Plus, FileCheck2, ArrowUpRight, CheckCircle2, XCircle } from 'lucide-react';
import { useNexus } from '../../context/NexusContext';
import { TimelineView } from './TimelineView';

export const GovernanceRiskView: React.FC<{ projectId?: string }> = ({ projectId }) => {
  const { objects, openObjectDrawer, openCreateModal, updateNexusObject, decideApproval, approvals } = useNexus();
  const [tab, setTab] = useState<'risks' | 'audit'>('risks');

  const risks = objects.filter((o) => o.type === 'RISK' && (!projectId || o.projectId === projectId));
  const changeRequests = objects.filter((o) => o.type === 'CHANGE_REQUEST' && (!projectId || o.projectId === projectId));

  // Heatmap Matrix grid (5x5)
  // Rows: Probability (5 down to 1)
  // Cols: Impact (1 to 5)
  const renderHeatmapCell = (prob: number, imp: number) => {
    const score = prob * imp;
    const count = risks.filter((r) => (r.probability || 1) === prob && (r.impact || 1) === imp).length;

    let bg = 'bg-emerald-100 text-emerald-900 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-200';
    if (score >= 15) {
      // rose-600 en vez de rose-500: el blanco sobre rose-500 daba 3.75:1. Sin
      // animate-pulse — una celda parpadeando permanentemente en una matriz de 25
      // no añade información y dificulta leer el número.
      bg = 'bg-rose-600 text-white font-extrabold';
    } else if (score >= 8) {
      bg = 'bg-amber-200 text-amber-900 font-bold dark:bg-amber-900 dark:text-amber-100';
    }

    return (
      <div
        key={`${prob}-${imp}`}
        className={`flex h-12 flex-col items-center justify-center rounded-lg border text-xs shadow-xs ${bg}`}
      >
        {/* opacity-75 bajaba la celda a 3.75:1; el color ya distingue la severidad. */}
        <span className="text-micro opacity-90">Score {score}</span>
        {count > 0 && <span className="text-meta font-extrabold">{count} {count === 1 ? 'riesgo' : 'riesgos'}</span>}
      </div>
    );
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto p-2">
      {/* Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between rounded-2xl bg-gradient-to-r from-amber-900 via-slate-900 to-rose-950 p-5 text-white shadow-xl">
        <div>
          <div className="flex items-center space-x-2 text-amber-300 text-xs font-bold uppercase tracking-wider">
            <ShieldAlert className="h-4 w-4" />
            <span>Centro de Gobernanza, Riesgos & Control de Cambios</span>
          </div>
          <h1 className="mt-1 text-xl font-extrabold">Riesgos y solicitudes de cambio</h1>
          <p className="mt-1 text-xs text-amber-100/80">
            {risks.length} riesgos identificados • {changeRequests.length} solicitudes de cambio activas
          </p>
        </div>

        <div className="mt-4 md:mt-0 flex space-x-2">
          <button
            onClick={() => openCreateModal('RISK')}
            className="flex items-center space-x-1.5 rounded-xl bg-amber-500 px-3.5 py-2 text-xs font-bold text-slate-950 shadow-md hover:bg-amber-400"
          >
            <Plus className="h-4 w-4" />
            <span>Registrar Riesgo</span>
          </button>
          <button
            onClick={() => openCreateModal('CHANGE_REQUEST')}
            className="flex items-center space-x-1.5 rounded-xl bg-rose-600 px-3.5 py-2 text-xs font-bold text-white shadow-md hover:bg-rose-500"
          >
            <Plus className="h-4 w-4" />
            <span>Solicitud de Cambio (CR)</span>
          </button>
        </div>
      </div>

      {/*
        La auditoría era un módulo aparte etiquetado "Plan maestro" bajo PLANIFICAR,
        pero renderiza TimelineView — un registro cronológico inmutable, no un plan.
        Es control, no planificación, y el mismo componente ya era pestaña dentro de
        cada proyecto; aquí vive la vista global.
      */}
      <div className="flex items-center gap-1 rounded-xl bg-slate-100 p-1 w-fit">
        <button onClick={() => setTab('risks')} className={`rounded-lg px-3 py-2 text-meta font-bold ${tab === 'risks' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'}`}>Riesgos y cambios</button>
        <button onClick={() => setTab('audit')} className={`rounded-lg px-3 py-2 text-meta font-bold ${tab === 'audit' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'}`}>Auditoría</button>
      </div>

      {tab === 'audit' ? <TimelineView /> : (
      <>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 5x5 Heatmap Matrix */}
        <div className="lg:col-span-1 rounded-2xl border border-slate-200 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">
            Matriz Heatmap de Probabilidad vs Impacto (5x5)
          </h3>

          <div className="space-y-2">
            {[5, 4, 3, 2, 1].map((prob) => (
              <div key={prob} className="flex items-center space-x-2">
                <span className="w-6 text-[10px] font-bold text-slate-400">P{prob}</span>
                <div className="grid grid-cols-5 gap-1.5 flex-1">
                  {[1, 2, 3, 4, 5].map((imp) => renderHeatmapCell(prob, imp))}
                </div>
              </div>
            ))}
            <div className="flex justify-between pl-8 text-[10px] font-bold text-slate-400 pt-1">
              <span>I1</span>
              <span>I2</span>
              <span>I3</span>
              <span>I4</span>
              <span>I5 (Impacto)</span>
            </div>
          </div>
        </div>

        {/* Risks List */}
        <div className="lg:col-span-2 rounded-2xl border border-slate-200 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">
            Registro Activo de Riesgos & Planes de Mitigación
          </h3>

          <div className="space-y-3">
            {risks.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-400">No hay riesgos registrados.</div>
            ) : (
              risks.map((risk) => {
                const score = (risk.probability || 1) * (risk.impact || 1);
                return (
                  <div
                    key={risk.id}
                    onClick={() => openObjectDrawer(risk.id)}
                    className="cursor-pointer rounded-xl border border-slate-200 bg-slate-50 p-3.5 transition hover:border-amber-400 hover:bg-white dark:border-slate-800 dark:bg-slate-800/60"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        <AlertTriangle className={`h-4 w-4 ${score >= 15 ? 'text-rose-600' : 'text-amber-500'}`} />
                        <span className="text-xs font-bold text-slate-900 dark:text-slate-100">{risk.title}</span>
                      </div>
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-xs font-extrabold ${
                          score >= 15
                            ? 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300'
                            : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                        }`}
                      >
                        Score: {score} / 25
                      </span>
                    </div>

                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 line-clamp-2">
                      {risk.description || 'Sin descripción especificada'}
                    </p>

                    {risk.mitigationPlan && (
                      <div className="mt-2.5 rounded-lg bg-amber-50/70 p-2 text-[11px] text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                        <strong>Plan de Mitigación:</strong> {risk.mitigationPlan}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Change Requests Section */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">
          Solicitudes de Cambio Afectando Alcance, Presupuesto o Tiempo
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {changeRequests.map((cr) => {
            const app = approvals.find((a) => a.objectId === cr.id);
            return (
              <div
                key={cr.id}
                className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-800/60"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-900 dark:text-slate-100">{cr.title}</span>
                  <span className="rounded bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-800 dark:bg-rose-950 dark:text-rose-300">
                    {cr.status}
                  </span>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded bg-white p-2 border border-slate-100 dark:bg-slate-800 dark:border-slate-700">
                    <span className="text-[10px] text-slate-400 block">Impacto Presupuesto</span>
                    <span className="font-extrabold text-rose-600">+${(cr.costImpact || 0).toLocaleString()} USD</span>
                  </div>
                  <div className="rounded bg-white p-2 border border-slate-100 dark:bg-slate-800 dark:border-slate-700">
                    <span className="text-[10px] text-slate-400 block">Impacto Tiempo</span>
                    <span className="font-extrabold text-amber-700">+{cr.timeImpactDays || 0} Días</span>
                  </div>
                </div>

                {app && app.status === 'PENDING' && (
                  <div className="mt-3 flex justify-end space-x-2">
                    <button
                      onClick={() => decideApproval(app.id, 'APPROVED', 'Aprobado oficialmente')}
                      className="flex items-center space-x-1 rounded bg-emerald-700 px-3 py-1 text-xs font-bold text-white shadow-xs hover:bg-emerald-800"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      <span>Aprobar CR</span>
                    </button>
                    <button
                      onClick={() => decideApproval(app.id, 'REJECTED', 'Rechazado por comité')}
                      className="flex items-center space-x-1 rounded bg-rose-600 px-3 py-1 text-xs font-bold text-white shadow-xs hover:bg-rose-700"
                    >
                      <XCircle className="h-3.5 w-3.5" />
                      <span>Rechazar CR</span>
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
      </>
      )}
    </div>
  );
};
