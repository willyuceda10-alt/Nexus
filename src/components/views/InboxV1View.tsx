import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArchiveX,
  BellRing,
  CheckCircle2,
  CheckSquare2,
  Clock3,
  Eye,
  Inbox,
  RefreshCw,
  ShieldAlert,
  Sparkles,
} from 'lucide-react';
import { bridataApi, BridataApiError } from '../../api/client';
import type { ApiInboxItemV1, ApiInboxStatusV1 } from '../../api/inboxV1Contracts';
import { useApiBootstrap } from '../../context/ApiBootstrapContext';

function errorText(error: unknown): string {
  if (error instanceof BridataApiError) {
    return error.correlationId ? `${error.message} · Ref: ${error.correlationId}` : error.message;
  }
  return error instanceof Error ? error.message : 'No se pudo completar la operación.';
}

function priorityClass(priority: ApiInboxItemV1['priority']): string {
  if (priority === 'CRITICAL') return 'bg-rose-50 text-rose-700 ring-rose-200';
  if (priority === 'HIGH') return 'bg-amber-50 text-amber-700 ring-amber-200';
  if (priority === 'LOW') return 'bg-slate-100 text-slate-500 ring-slate-200';
  return 'bg-blue-50 text-blue-700 ring-blue-200';
}

function relativeDate(value: string): string {
  const date = new Date(value);
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.max(0, Math.floor(diffMs / 60_000));
  if (minutes < 1) return 'Ahora';
  if (minutes < 60) return `Hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Hace ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `Hace ${days} d`;
  return date.toLocaleDateString('es-PE', { day: '2-digit', month: 'short', year: 'numeric' });
}

function tomorrowMorningIso(): string {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(8, 0, 0, 0);
  return date.toISOString();
}

export const InboxV1View: React.FC = () => {
  const bootstrap = useApiBootstrap();
  const apiReady = bootstrap.dataMode === 'api' && bootstrap.status === 'ready';
  const [status, setStatus] = useState<ApiInboxStatusV1>('OPEN');
  const [items, setItems] = useState<ApiInboxItemV1[]>([]);
  const [summary, setSummary] = useState({ unread: 0, requiresAction: 0, snoozed: 0 });
  const [includeSnoozed, setIncludeSnoozed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!apiReady) return;
    setLoading(true);
    setError(null);
    try {
      const result = await bridataApi.inboxV1({ status, includeSnoozed, limit: 100 });
      setItems(result.items);
      setSummary(result.summary);
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setLoading(false);
    }
  }, [apiReady, status, includeSnoozed]);

  useEffect(() => { void load(); }, [load]);

  const mutate = async (id: string, action: 'read' | 'resolve' | 'dismiss' | 'snooze') => {
    setPendingId(id);
    setError(null);
    try {
      if (action === 'read') await bridataApi.readInboxItemV1(id);
      if (action === 'resolve') await bridataApi.resolveInboxItemV1(id);
      if (action === 'dismiss') await bridataApi.dismissInboxItemV1(id);
      if (action === 'snooze') await bridataApi.snoozeInboxItemV1(id, tomorrowMorningIso());
      await load();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setPendingId(null);
    }
  };

  const visibleActionCount = useMemo(
    () => items.filter((item) => item.requiresAction && item.status === 'OPEN').length,
    [items],
  );

  if (!apiReady) {
    return (
      <div className="p-8">
        <div className="mx-auto max-w-3xl rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
          <Inbox className="h-9 w-9 text-green-700" />
          <h1 className="mt-4 text-2xl font-extrabold text-slate-950">Mi trabajo</h1>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            El Inbox personal se alimenta de notificaciones y proyecciones reales cuando Bridata está conectado al API.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1450px] space-y-5 p-5 lg:p-7">
      <header className="rounded-3xl border border-slate-200 bg-white px-6 py-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="grid h-12 w-12 place-items-center rounded-2xl bg-green-50 ring-1 ring-green-100">
              <CheckSquare2 className="h-6 w-6 text-green-700" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-extrabold tracking-tight text-slate-950">Mi trabajo</h1>
                <span className="rounded-full bg-green-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.13em] text-green-700 ring-1 ring-green-200">
                  Inbox V1
                </span>
              </div>
              <p className="mt-1 max-w-2xl text-sm text-slate-500">
                Una sola bandeja para alertas, acciones requeridas y notificaciones generadas por Bridata.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Actualizar
          </button>
        </div>
      </header>

      {error && (
        <div className="flex items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <ShieldAlert className="mt-0.5 h-4 w-4 flex-none" />
          <span>{error}</span>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ['No leídos', summary.unread, BellRing],
          ['Requieren acción', summary.requiresAction, Sparkles],
          ['Pospuestos', summary.snoozed, Clock3],
          ['Visibles ahora', items.length, Inbox],
        ].map(([label, value, Icon]) => {
          const MetricIcon = Icon as React.ComponentType<{ className?: string }>;
          return (
            <div key={String(label)} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">{String(label)}</span>
                <MetricIcon className="h-4 w-4 text-green-700" />
              </div>
              <div className="mt-2 text-2xl font-extrabold text-slate-950">{String(value)}</div>
            </div>
          );
        })}
      </div>

      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div className="flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1">
            {([
              ['OPEN', 'Pendientes'],
              ['RESOLVED', 'Resueltos'],
              ['DISMISSED', 'Descartados'],
            ] as Array<[ApiInboxStatusV1, string]>).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setStatus(value)}
                className={`rounded-lg px-3 py-2 text-xs font-bold transition-colors ${status === value ? 'bg-white text-green-800 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
              >
                {label}
              </button>
            ))}
          </div>
          {status === 'OPEN' && (
            <label className="flex items-center gap-2 text-xs font-semibold text-slate-500">
              <input
                type="checkbox"
                checked={includeSnoozed}
                onChange={(event) => setIncludeSnoozed(event.target.checked)}
              />
              Mostrar pospuestos
            </label>
          )}
        </div>

        <div className="divide-y divide-slate-100">
          {items.map((item) => (
            <article key={item.id} className={`px-5 py-4 transition-colors ${item.unread ? 'bg-green-50/35' : 'bg-white'}`}>
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {item.unread && <span className="h-2 w-2 rounded-full bg-green-600" aria-label="No leído" />}
                    <h2 className="text-sm font-extrabold text-slate-900">{item.title}</h2>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ${priorityClass(item.priority)}`}>{item.priority}</span>
                    {item.requiresAction && (
                      <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700 ring-1 ring-amber-200">
                        Acción requerida
                      </span>
                    )}
                  </div>
                  {item.body && <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-600">{item.body}</p>}
                  <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] font-medium text-slate-400">
                    <span>{relativeDate(item.createdAt)}</span>
                    <span>{item.sourceType.replaceAll('_', ' ')}</span>
                    {item.projectId && <span className="font-mono">Proyecto · {item.projectId.slice(0, 8)}</span>}
                    {item.snoozedUntil && <span>Pospuesto hasta {new Date(item.snoozedUntil).toLocaleString('es-PE')}</span>}
                  </div>
                </div>

                {status === 'OPEN' && (
                  <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                    {item.unread && (
                      <button
                        type="button"
                        disabled={pendingId === item.id}
                        onClick={() => void mutate(item.id, 'read')}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-[11px] font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                      >
                        <Eye className="h-3.5 w-3.5" /> Leído
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={pendingId === item.id}
                      onClick={() => void mutate(item.id, 'snooze')}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-[11px] font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                    >
                      <Clock3 className="h-3.5 w-3.5" /> Mañana 8:00
                    </button>
                    <button
                      type="button"
                      disabled={pendingId === item.id}
                      onClick={() => void mutate(item.id, 'dismiss')}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-[11px] font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                    >
                      <ArchiveX className="h-3.5 w-3.5" /> Descartar
                    </button>
                    <button
                      type="button"
                      disabled={pendingId === item.id}
                      onClick={() => void mutate(item.id, 'resolve')}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-green-700 px-3 py-2 text-[11px] font-bold text-white hover:bg-green-800 disabled:opacity-40"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" /> Resolver
                    </button>
                  </div>
                )}
              </div>
            </article>
          ))}

          {!loading && items.length === 0 && (
            <div className="px-6 py-16 text-center">
              <CheckCircle2 className="mx-auto h-9 w-9 text-green-300" />
              <p className="mt-4 text-sm font-extrabold text-slate-700">
                {status === 'OPEN' ? 'No tienes trabajo pendiente en esta bandeja.' : 'No hay elementos en este estado.'}
              </p>
              {status === 'OPEN' && visibleActionCount === 0 && (
                <p className="mt-1 text-xs text-slate-400">Las automatizaciones y demás módulos irán agregando aquí lo que necesite tu atención.</p>
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  );
};
