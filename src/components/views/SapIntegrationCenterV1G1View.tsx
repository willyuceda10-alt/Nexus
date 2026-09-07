import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock3,
  CloudCog,
  Database,
  FileSpreadsheet,
  PlugZap,
  RefreshCw,
  ServerCog,
  ShieldCheck,
  Workflow,
  XCircle,
} from 'lucide-react';
import { BridataApiError } from '../../api/client';
import { sapIntegrationV1Api } from '../../api/sapIntegrationV1Client';
import type {
  ApiSapConnectionHealthV1,
  ApiSapConnectionV1,
  ApiSapFreshnessStateV1,
  ApiSapIntegrationCenterV1G1,
  ApiSapQualityStateV1,
  ApiSapSourceHealthV1,
} from '../../api/sapIntegrationV1Contracts';
import { useApiBootstrap } from '../../context/ApiBootstrapContext';

function messageOf(cause: unknown): string {
  if (cause instanceof BridataApiError) {
    return cause.correlationId ? `${cause.message} · Ref: ${cause.correlationId}` : cause.message;
  }
  if (cause instanceof Error) return cause.message;
  return 'No se pudo consultar el estado de la integración SAP.';
}

function dateTime(value?: string | null): string {
  if (!value) return 'Sin registro';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Fecha no disponible';
  return new Intl.DateTimeFormat('es-PE', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(date).replace('.', '');
}

function duration(minutes: number | null): string {
  if (minutes === null) return '—';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  if (hours < 24) return remaining ? `${hours} h ${remaining} min` : `${hours} h`;
  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return restHours ? `${days} d ${restHours} h` : `${days} d`;
}

function connectionLabel(state: ApiSapConnectionHealthV1): string {
  const labels: Record<ApiSapConnectionHealthV1, string> = {
    HEALTHY: 'Saludable',
    DEGRADED: 'Requiere atención',
    PROCESSING: 'Procesando',
    ERROR: 'Con error',
    DISCONNECTED: 'Desconectado',
  };
  return labels[state];
}

function freshnessLabel(state: ApiSapFreshnessStateV1): string {
  const labels: Record<ApiSapFreshnessStateV1, string> = {
    FRESH: 'Actualizado',
    STALE: 'Desactualizado',
    PROCESSING: 'Procesando',
    ERROR: 'Error',
    NEVER: 'Sin carga',
    DISABLED: 'Deshabilitado',
  };
  return labels[state];
}

function qualityLabel(state: ApiSapQualityStateV1): string {
  const labels: Record<ApiSapQualityStateV1, string> = {
    CLEAN: 'Limpia',
    WARNING: 'Con advertencias',
    REJECTED: 'Con rechazos',
    NO_DATA: 'Sin datos',
  };
  return labels[state];
}

function healthTone(state: ApiSapConnectionHealthV1): string {
  if (state === 'HEALTHY') return 'bg-emerald-50 text-emerald-800 ring-emerald-200';
  if (state === 'PROCESSING') return 'bg-sky-50 text-sky-800 ring-sky-200';
  if (state === 'DEGRADED') return 'bg-amber-50 text-amber-800 ring-amber-200';
  return 'bg-rose-50 text-rose-800 ring-rose-200';
}

function freshnessTone(state: ApiSapFreshnessStateV1): string {
  if (state === 'FRESH') return 'bg-emerald-50 text-emerald-800 ring-emerald-200';
  if (state === 'PROCESSING') return 'bg-sky-50 text-sky-800 ring-sky-200';
  if (state === 'STALE') return 'bg-amber-50 text-amber-800 ring-amber-200';
  if (state === 'NEVER' || state === 'DISABLED') return 'bg-slate-100 text-slate-600 ring-slate-200';
  return 'bg-rose-50 text-rose-800 ring-rose-200';
}

function sourceIcon(sourceKey: string) {
  if (sourceKey === 'SAP_MATERIAL_MOVEMENTS') return Activity;
  if (sourceKey === 'SAP_PROJECT_ACTUAL_COSTS') return Database;
  if (sourceKey === 'SAP_OPEN_PURCHASE_ORDERS') return CloudCog;
  if (sourceKey === 'SAP_PROJECT_PROCUREMENT') return Workflow;
  return FileSpreadsheet;
}

const Kpi: React.FC<{
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  detail: string;
  attention?: boolean;
}> = ({ icon: Icon, label, value, detail, attention }) => (
  <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
    <div className="flex items-start justify-between gap-3">
      <div>
        <p className="text-[9px] font-black uppercase tracking-[0.14em] text-slate-400">{label}</p>
        <p className={`mt-2 text-2xl font-black tracking-tight ${attention ? 'text-amber-700' : 'text-slate-950'}`}>{value}</p>
      </div>
      <span className={`grid h-9 w-9 place-items-center rounded-xl ${attention ? 'bg-amber-50 text-amber-700' : 'bg-green-50 text-green-700'}`}>
        <Icon className="h-4 w-4" />
      </span>
    </div>
    <p className="mt-3 text-[10px] font-medium text-slate-500">{detail}</p>
  </div>
);

const SourceCard: React.FC<{ source: ApiSapSourceHealthV1 }> = ({ source }) => {
  const Icon = sourceIcon(source.sourceKey);
  const batch = source.latestBatch;
  const rejected = batch?.counts.rejected ?? 0;
  const warnings = batch?.counts.warnings ?? 0;

  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-10 w-10 flex-none place-items-center rounded-[14px] bg-green-50 text-green-700 ring-1 ring-green-100">
            <Icon className="h-4.5 w-4.5" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-[12px] font-extrabold text-slate-900">{source.displayName}</p>
            <p className="mt-1 truncate text-[8px] font-black uppercase tracking-[0.1em] text-slate-400">{source.sourceKey}</p>
          </div>
        </div>
        <span className={`flex-none rounded-full px-2 py-1 text-[8px] font-black ring-1 ${freshnessTone(source.freshnessState)}`}>
          {freshnessLabel(source.freshnessState)}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <div className="rounded-xl bg-slate-50 px-3 py-2.5">
          <p className="text-[8px] font-black uppercase tracking-[0.1em] text-slate-400">Registros</p>
          <p className="mt-1 text-[16px] font-black text-slate-900">{batch?.counts.total.toLocaleString('es-PE') ?? '—'}</p>
        </div>
        <div className="rounded-xl bg-slate-50 px-3 py-2.5">
          <p className="text-[8px] font-black uppercase tracking-[0.1em] text-slate-400">Edad del dato</p>
          <p className="mt-1 text-[13px] font-extrabold text-slate-800">{duration(source.dataAgeMinutes)}</p>
        </div>
      </div>

      <div className="mt-4 space-y-2 border-t border-slate-100 pt-3 text-[9px]">
        <div className="flex items-center justify-between gap-3"><span className="text-slate-400">Calidad</span><span className="font-bold text-slate-700">{qualityLabel(source.qualityState)}</span></div>
        <div className="flex items-center justify-between gap-3"><span className="text-slate-400">Generado en SAP</span><span className="text-right font-semibold text-slate-600">{dateTime(source.lastGeneratedAt)}</span></div>
        <div className="flex items-center justify-between gap-3"><span className="text-slate-400">Retraso transporte</span><span className="font-semibold text-slate-600">{duration(source.transportLagMinutes)}</span></div>
      </div>

      {(warnings > 0 || rejected > 0 || batch?.errorSummary) && (
        <div className={`mt-3 rounded-xl px-3 py-2 text-[9px] font-semibold ${rejected > 0 || batch?.errorSummary ? 'bg-rose-50 text-rose-700' : 'bg-amber-50 text-amber-700'}`}>
          {batch?.errorSummary || `${warnings} advertencias · ${rejected} rechazos`}
        </div>
      )}
    </article>
  );
};

interface SapIntegrationCenterV1G1ViewProps {
  /** Se renderiza dentro de Configuración: sin cabecera ni lienzo propios. */
  embedded?: boolean;
}

export const SapIntegrationCenterV1G1View: React.FC<SapIntegrationCenterV1G1ViewProps> = ({ embedded = false }) => {
  const apiBootstrap = useApiBootstrap();
  const isApiMode = apiBootstrap.dataMode === 'api';
  const apiReady = isApiMode && apiBootstrap.status === 'ready';
  const [data, setData] = useState<ApiSapIntegrationCenterV1G1 | null>(null);
  const [selectedConnectionId, setSelectedConnectionId] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!apiReady) return;
    setLoading(true);
    setError(null);
    try {
      const next = await sapIntegrationV1Api.center();
      setData(next);
      setSelectedConnectionId((current) => {
        if (current && next.connections.some((connection) => connection.id === current)) return current;
        return next.connections[0]?.id ?? '';
      });
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setLoading(false);
    }
  }, [apiReady]);

  useEffect(() => { void reload(); }, [reload]);

  const connection = useMemo<ApiSapConnectionV1 | null>(
    () => data?.connections.find((item) => item.id === selectedConnectionId) ?? data?.connections[0] ?? null,
    [data, selectedConnectionId],
  );

  const latestLoads = useMemo(() => {
    if (!connection) return [];
    return connection.sources
      .filter((source) => source.latestBatch)
      .map((source) => ({ source, batch: source.latestBatch! }))
      .sort((a, b) => new Date(b.batch.receivedAt).getTime() - new Date(a.batch.receivedAt).getTime());
  }, [connection]);

  if (!isApiMode) {
    return (
      <div className="min-h-full bg-[#F8FAFC] px-6 py-8 lg:px-8">
        <div className="mx-auto max-w-[1500px]">
          <div className="rounded-3xl border border-slate-200 bg-white p-10 text-center shadow-sm">
            <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-green-50 text-green-700"><PlugZap className="h-6 w-6" /></span>
            <h1 className="mt-5 text-2xl font-black tracking-tight text-slate-950">Centro de integración SAP</h1>
            <p className="mx-auto mt-2 max-w-xl text-[12px] leading-5 text-slate-500">Esta pantalla muestra únicamente información real del API de Bridata. Activa el modo API para consultar conexiones, fuentes, cargas y frescura SAP.</p>
          </div>
        </div>
      </div>
    );
  }

  if (!apiReady || (loading && !data)) {
    return (
      <div className="flex min-h-[560px] items-center justify-center bg-[#F8FAFC]">
        <div className="text-center">
          <RefreshCw className="mx-auto h-6 w-6 animate-spin text-green-700" />
          <p className="mt-3 text-sm font-bold text-slate-800">Consultando integración SAP</p>
          <p className="mt-1 text-[10px] text-slate-400">PostgreSQL Bridata · Health V1-E · Orchestration V1-F2</p>
        </div>
      </div>
    );
  }

  return (
    <div className={embedded ? '' : 'min-h-full bg-[#F8FAFC] px-6 py-6 lg:px-8'}>
      <div className={embedded ? 'space-y-4' : 'mx-auto max-w-[1660px] space-y-4'}>
        <header className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            {!embedded && (
              <>
                <div className="flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-[0.16em] text-green-700">
                  <PlugZap className="h-4 w-4" /> Integration Center · SAP
                </div>
                <h1 className="mt-2 text-2xl font-extrabold tracking-tight text-slate-950">Salud, frescura y cargas de SAP</h1>
              </>
            )}
            <p className={`max-w-3xl text-[12px] leading-5 text-slate-500 ${embedded ? '' : 'mt-1'}`}>Visibilidad operacional de las cinco fuentes que alimentan compras, inventario, compromisos y costos reales de Bridata.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {(data?.connections.length ?? 0) > 1 && (
              <select value={connection?.id ?? ''} onChange={(event) => setSelectedConnectionId(event.target.value)} className="h-10 max-w-[280px] rounded-xl border border-slate-200 bg-white px-3 text-[10px] font-bold text-slate-700 outline-none">
                {data?.connections.map((item) => <option key={item.id} value={item.id}>{item.displayName}</option>)}
              </select>
            )}
            <button disabled={loading} onClick={() => void reload()} className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-[10px] font-bold text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50">
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Actualizar estado
            </button>
          </div>
        </header>

        {error && <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[10px] font-semibold text-rose-700">{error}</div>}

        {!connection ? (
          <section className="rounded-3xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center">
            <ServerCog className="mx-auto h-9 w-9 text-slate-300" />
            <h2 className="mt-4 text-lg font-extrabold text-slate-900">Aún no existe una conexión SAP</h2>
            <p className="mx-auto mt-2 max-w-xl text-[11px] leading-5 text-slate-500">Cuando se configure la conexión SAP del tenant, aquí aparecerán automáticamente sus cinco fuentes, últimas cargas y estado de frescura.</p>
          </section>
        ) : (
          <>
            <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
              <div className="grid gap-0 xl:grid-cols-[1.2fr_0.8fr]">
                <div className="p-5 lg:p-6">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-4">
                      <span className="grid h-12 w-12 place-items-center rounded-2xl bg-green-700 text-white shadow-[0_8px_22px_rgba(21,128,61,0.2)]"><Database className="h-5 w-5" /></span>
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className="text-[17px] font-black tracking-tight text-slate-950">{connection.displayName}</h2>
                          <span className={`rounded-full px-2.5 py-1 text-[8px] font-black ring-1 ${healthTone(connection.overallStatus)}`}>{connectionLabel(connection.overallStatus)}</span>
                        </div>
                        <p className="mt-1 text-[10px] text-slate-400">Último dato exitoso: {dateTime(connection.latestSuccessAt)}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 rounded-2xl bg-slate-50 px-4 py-3 ring-1 ring-slate-100">
                      <Workflow className={`h-4 w-4 ${connection.automation.enabled ? 'text-green-700' : 'text-slate-400'}`} />
                      <div><p className="text-[8px] font-black uppercase tracking-[0.1em] text-slate-400">Orquestación</p><p className="mt-0.5 text-[10px] font-bold text-slate-700">{connection.automation.enabled ? 'Automática activa' : connection.automation.configured ? 'Configurada, pausada' : 'No configurada'}</p></div>
                    </div>
                  </div>
                  <div className="mt-5 h-2 overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full bg-green-600 transition-all" style={{ width: `${Math.round((connection.summary.fresh / Math.max(1, connection.summary.expectedSources)) * 100)}%` }} />
                  </div>
                  <div className="mt-2 flex items-center justify-between text-[9px]"><span className="font-semibold text-slate-500">{connection.summary.fresh} de {connection.summary.expectedSources} fuentes actualizadas</span><span className="font-black text-green-700">{Math.round((connection.summary.fresh / Math.max(1, connection.summary.expectedSources)) * 100)}%</span></div>
                </div>
                <div className="border-t border-slate-100 bg-slate-50/60 p-5 xl:border-l xl:border-t-0">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-xl bg-white p-3 ring-1 ring-slate-200"><p className="text-[8px] font-black uppercase tracking-[0.1em] text-slate-400">Conexión</p><p className="mt-1 text-[11px] font-extrabold text-slate-800">{connection.status}</p></div>
                    <div className="rounded-xl bg-white p-3 ring-1 ring-slate-200"><p className="text-[8px] font-black uppercase tracking-[0.1em] text-slate-400">BD operacional</p><p className="mt-1 text-[11px] font-extrabold text-slate-800">PostgreSQL</p></div>
                    <div className="rounded-xl bg-white p-3 ring-1 ring-slate-200"><p className="text-[8px] font-black uppercase tracking-[0.1em] text-slate-400">Fuentes configuradas</p><p className="mt-1 text-[11px] font-extrabold text-slate-800">{connection.summary.configuredSources}/{connection.summary.expectedSources}</p></div>
                    <div className="rounded-xl bg-white p-3 ring-1 ring-slate-200"><p className="text-[8px] font-black uppercase tracking-[0.1em] text-slate-400">Evaluado</p><p className="mt-1 text-[10px] font-bold text-slate-700">{dateTime(data?.evaluatedAt)}</p></div>
                  </div>
                </div>
              </div>
            </section>

            <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Kpi icon={CheckCircle2} label="Actualizadas" value={String(connection.summary.fresh)} detail="Fuentes dentro de su ventana de frescura" />
              <Kpi icon={Clock3} label="Desactualizadas" value={String(connection.summary.stale)} detail="Datos SAP fuera de la política definida" attention={connection.summary.stale > 0} />
              <Kpi icon={AlertTriangle} label="Advertencias" value={String(connection.summary.warnings)} detail="Cargas aceptadas que requieren revisión" attention={connection.summary.warnings > 0} />
              <Kpi icon={XCircle} label="Errores / rechazos" value={String(connection.summary.errors + connection.summary.rejected)} detail="Fuentes fallidas o registros rechazados" attention={connection.summary.errors + connection.summary.rejected > 0} />
            </section>

            <section>
              <div className="mb-3 flex items-end justify-between gap-3">
                <div><p className="text-[9px] font-black uppercase tracking-[0.14em] text-slate-400">Fuentes semánticas</p><h2 className="mt-1 text-[15px] font-extrabold text-slate-900">Pipeline SAP → Bridata</h2></div>
                <span className="hidden text-[9px] font-semibold text-slate-400 sm:inline">Frescura calculada desde la fecha generada en SAP</span>
              </div>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                {connection.sources.map((source) => <SourceCard key={source.sourceKey} source={source} />)}
              </div>
            </section>

            <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
                <div><p className="text-[9px] font-black uppercase tracking-[0.12em] text-slate-400">Últimas cargas</p><p className="mt-1 text-[11px] font-bold text-slate-800">Evidencia de transporte y procesamiento</p></div>
                <FileSpreadsheet className="h-4 w-4 text-green-700" />
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1050px] text-left text-[10px]">
                  <thead className="bg-slate-50 text-[8px] font-extrabold uppercase tracking-[0.1em] text-slate-400">
                    <tr><th className="px-4 py-3">Fuente</th><th className="px-3 py-3">Archivo recibido</th><th className="px-3 py-3">Generado SAP</th><th className="px-3 py-3">Recibido Bridata</th><th className="px-3 py-3 text-right">Registros</th><th className="px-3 py-3 text-right">Aceptados</th><th className="px-3 py-3 text-right">Advert.</th><th className="px-4 py-3">Estado</th></tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {latestLoads.map(({ source, batch }) => (
                      <tr key={source.sourceKey} className="hover:bg-slate-50/60">
                        <td className="px-4 py-3"><div className="font-extrabold text-slate-900">{source.displayName}</div><div className="mt-1 text-[8px] text-slate-400">{source.sourceKey}</div></td>
                        <td className="px-3 py-3 font-semibold text-slate-600">{batch.originalFilename}</td>
                        <td className="px-3 py-3 text-slate-500">{dateTime(batch.sourceGeneratedAt)}</td>
                        <td className="px-3 py-3 text-slate-500">{dateTime(batch.receivedAt)}</td>
                        <td className="px-3 py-3 text-right font-bold text-slate-700">{batch.counts.total.toLocaleString('es-PE')}</td>
                        <td className="px-3 py-3 text-right text-slate-600">{batch.counts.accepted.toLocaleString('es-PE')}</td>
                        <td className="px-3 py-3 text-right text-slate-600">{batch.counts.warnings.toLocaleString('es-PE')}</td>
                        <td className="px-4 py-3"><span className={`rounded-full px-2 py-1 text-[8px] font-black ring-1 ${freshnessTone(source.freshnessState)}`}>{batch.status}</span></td>
                      </tr>
                    ))}
                    {latestLoads.length === 0 && <tr><td colSpan={8} className="px-4 py-10 text-center text-[10px] font-semibold text-slate-400">Aún no existen cargas SAP para esta conexión.</td></tr>}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="grid gap-3 lg:grid-cols-3">
              <div className="rounded-2xl border border-green-100 bg-green-50/70 p-4"><div className="flex items-center gap-2 text-green-800"><ShieldCheck className="h-4 w-4" /><p className="text-[10px] font-black uppercase tracking-[0.1em]">Gobernanza</p></div><p className="mt-2 text-[10px] leading-5 text-green-900/70">Excel es transporte y evidencia. La operación diaria consulta PostgreSQL Bridata.</p></div>
              <div className="rounded-2xl border border-slate-200 bg-white p-4"><div className="flex items-center gap-2 text-slate-700"><ServerCog className="h-4 w-4" /><p className="text-[10px] font-black uppercase tracking-[0.1em]">Automatización</p></div><p className="mt-2 text-[10px] leading-5 text-slate-500">F1 autentica el proceso de servicio y F2 orquesta compras, inventario, compromisos y costos.</p></div>
              <div className="rounded-2xl border border-slate-200 bg-white p-4"><div className="flex items-center gap-2 text-slate-700"><Database className="h-4 w-4" /><p className="text-[10px] font-black uppercase tracking-[0.1em]">Fuente de verdad</p></div><p className="mt-2 text-[10px] leading-5 text-slate-500">Los estados mostrados aquí provienen de batches y fuentes persistidos en la base propia de Bridata.</p></div>
            </section>
          </>
        )}
      </div>
    </div>
  );
};
