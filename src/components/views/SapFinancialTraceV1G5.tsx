import React, { useEffect, useMemo, useState } from 'react';
import {
  BadgeDollarSign,
  ClipboardList,
  Database,
  FileSearch,
  RefreshCw,
  ShieldCheck,
  ShoppingCart,
} from 'lucide-react';
import { BridataApiError } from '../../api/client';
import { getSapFinancialViewV1G5 } from '../../api/sapFinancialV1G5Client';
import type {
  SapFinancialCommitmentV1G5,
  SapFinancialViewV1G5,
} from '../../api/sapFinancialV1G5Contracts';
import { useApiBootstrap } from '../../context/ApiBootstrapContext';

type DetailTab = 'actuals' | 'commitments';

function messageOf(cause: unknown): string {
  if (cause instanceof BridataApiError) {
    return cause.correlationId ? `${cause.message} · Ref: ${cause.correlationId}` : cause.message;
  }
  if (cause instanceof Error) return cause.message;
  return 'No se pudo cargar la trazabilidad financiera SAP.';
}

function shortDate(value?: string | null): string {
  if (!value) return '—';
  const date = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('es-PE', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })
    .format(date)
    .replace('.', '');
}

export const SapFinancialTraceV1G5: React.FC<{ projectId: string }> = ({ projectId }) => {
  const apiBootstrap = useApiBootstrap();
  const [data, setData] = useState<SapFinancialViewV1G5 | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<DetailTab>('actuals');

  useEffect(() => {
    if (apiBootstrap.dataMode !== 'api' || apiBootstrap.status !== 'ready') return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    getSapFinancialViewV1G5(projectId, controller.signal)
      .then(setData)
      .catch((cause) => {
        if (controller.signal.aborted) return;
        setError(messageOf(cause));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [apiBootstrap.dataMode, apiBootstrap.status, projectId]);

  const money = useMemo(() => {
    const defaultCurrency = data?.currency ?? 'USD';
    return (value: number, currency = defaultCurrency) => {
      try {
        return new Intl.NumberFormat('es-PE', {
          style: 'currency',
          currency,
          maximumFractionDigits: 0,
        }).format(value);
      } catch {
        return `${currency} ${value.toLocaleString('es-PE', { maximumFractionDigits: 0 })}`;
      }
    };
  }, [data?.currency]);

  if (apiBootstrap.dataMode !== 'api') return null;

  if (loading && !data) {
    return (
      <section className="flex min-h-[170px] items-center justify-center rounded-2xl border border-slate-200 bg-white shadow-sm">
        <RefreshCw className="h-5 w-5 animate-spin text-green-700" />
      </section>
    );
  }

  if (!data || error) {
    return (
      <section className="rounded-2xl border border-rose-200 bg-white p-5 shadow-sm">
        <p className="text-[11px] font-extrabold text-rose-700">No se pudo cargar Costos SAP V1-G5</p>
        <p className="mt-1 text-[9px] text-slate-500">{error ?? 'Sin datos financieros SAP para este proyecto.'}</p>
      </section>
    );
  }

  const authorityActive = data.actualAuthority === 'SAP_DATA_PEP';

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-3 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <BadgeDollarSign className="h-4 w-4 text-green-700" />
            <h3 className="text-[13px] font-extrabold text-slate-900">Costos SAP · V1-G5</h3>
            <span className={`rounded-full px-2 py-1 text-[8px] font-extrabold ring-1 ${authorityActive ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : 'bg-amber-50 text-amber-700 ring-amber-200'}`}>
              {authorityActive ? 'Autoridad real: DATA PEP' : 'Autoridad mixta'}
            </span>
          </div>
          <p className="mt-1 text-[9px] text-slate-400">Trazabilidad financiera canónica. Excel es transporte; los cálculos operan desde PostgreSQL Bridata.</p>
        </div>
        <div className="flex items-center gap-2 text-[8px] font-bold text-slate-500">
          <Database className="h-3.5 w-3.5 text-green-700" /> BRIDATA_POSTGRESQL
        </div>
      </div>

      <div className="grid grid-cols-2 gap-px bg-slate-100 md:grid-cols-5">
        <SapKpi label="Real DATA PEP" value={money(data.summary.sapActualCost)} detail={`${data.summary.actualCount} registro(s)`} />
        <SapKpi label="Compromiso SAP" value={money(data.summary.sapOpenCommitment)} detail="SolP pre-Pedido + OC pendiente" />
        <SapKpi label="Pre-Pedido" value={money(data.summary.sapPrePoCommitment)} detail={`${data.summary.prePoCommitmentCount} línea(s)`} />
        <SapKpi label="OC pendiente" value={money(data.summary.sapPurchaseOrderCommitment)} detail={`${data.summary.purchaseOrderLineCount} posición(es)`} />
        <SapKpi label="Real + comprometido" value={money(data.summary.sapSpentAndCommitted)} detail={`Moneda ${data.currency}`} />
      </div>

      <div className="border-t border-slate-100 bg-slate-50/70 px-4 py-3">
        <div className="grid gap-2 lg:grid-cols-3">
          <PolicyItem
            ok={data.policies.prePoClosedWhenPurchaseOrderAppears}
            title="Sin doble conteo SolP / Pedido"
            detail="La SolP pre-Pedido se cierra cuando aparece la OC SAP."
          />
          <PolicyItem
            ok={data.policies.materialReceiptActualsSuppressed}
            title="101 no duplica el costo real"
            detail={authorityActive ? 'DATA PEP gobierna el costo real; el ingreso 101 queda como logística.' : 'La autoridad DATA PEP aún no está activa para este proyecto.'}
          />
          <PolicyItem
            ok={!data.excelRuntimeDependency}
            title="Excel fuera del runtime"
            detail="La vista lee únicamente entidades canónicas persistidas en Bridata."
          />
        </div>
      </div>

      {data.summary.currencyIssueCount > 0 && (
        <div className="border-t border-amber-100 bg-amber-50 px-4 py-2 text-[9px] font-bold text-amber-800">
          {data.summary.currencyIssueCount} registro(s) SAP están en otra moneda y se excluyen de estos totales.
        </div>
      )}

      <div className="border-t border-slate-100 px-4 pt-3">
        <div className="flex gap-1 rounded-xl bg-slate-100 p-1">
          <button
            onClick={() => setTab('actuals')}
            className={`flex-1 rounded-lg px-3 py-2 text-[9px] font-extrabold transition ${tab === 'actuals' ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-500'}`}
          >
            Reales DATA PEP
          </button>
          <button
            onClick={() => setTab('commitments')}
            className={`flex-1 rounded-lg px-3 py-2 text-[9px] font-extrabold transition ${tab === 'commitments' ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-500'}`}
          >
            Compromisos SAP
          </button>
        </div>
      </div>

      <div className="overflow-x-auto px-4 pb-4 pt-3">
        {tab === 'actuals' ? (
          <table className="min-w-full text-left">
            <thead>
              <tr className="border-b border-slate-100 text-[8px] font-black uppercase tracking-[0.1em] text-slate-400">
                <th className="px-2 py-2">Fecha</th>
                <th className="px-2 py-2">PEP</th>
                <th className="px-2 py-2">Documento</th>
                <th className="px-2 py-2">Clase costo / material</th>
                <th className="px-2 py-2 text-right">Importe</th>
              </tr>
            </thead>
            <tbody>
              {data.actuals.map((row) => (
                <tr key={row.id} className="border-b border-slate-50 text-[9px] text-slate-600 last:border-0">
                  <td className="whitespace-nowrap px-2 py-2.5 font-semibold">{shortDate(row.occurredAt)}</td>
                  <td className="whitespace-nowrap px-2 py-2.5 font-mono text-[8px] text-slate-500">{row.wbsElement ?? '—'}</td>
                  <td className="px-2 py-2.5">
                    <p className="font-bold text-slate-800">{row.accountingDocument ?? '—'}</p>
                    <p className="mt-0.5 text-[8px] text-slate-400">{[row.companyCode, row.fiscalYear, row.accountingDocumentItem].filter(Boolean).join(' · ') || row.identityMode || 'DATA PEP'}</p>
                  </td>
                  <td className="px-2 py-2.5">
                    <p className="font-semibold text-slate-700">{row.materialCode ? `${row.materialCode} · ${row.materialTitle ?? ''}` : row.costCodeName ?? row.costCode ?? row.description}</p>
                    <p className="mt-0.5 max-w-[380px] truncate text-[8px] text-slate-400">{row.description}</p>
                  </td>
                  <td className={`whitespace-nowrap px-2 py-2.5 text-right font-extrabold ${row.includedInSummary ? 'text-slate-900' : 'text-amber-700'}`}>
                    {money(row.amount, row.currency)}
                  </td>
                </tr>
              ))}
              {data.actuals.length === 0 && <EmptyRow colSpan={5} text="No hay costos reales DATA PEP sincronizados para este proyecto." />}
            </tbody>
          </table>
        ) : (
          <table className="min-w-full text-left">
            <thead>
              <tr className="border-b border-slate-100 text-[8px] font-black uppercase tracking-[0.1em] text-slate-400">
                <th className="px-2 py-2">Tipo</th>
                <th className="px-2 py-2">Documento</th>
                <th className="px-2 py-2">Proveedor / material</th>
                <th className="px-2 py-2">Fecha</th>
                <th className="px-2 py-2 text-right">Pendiente</th>
              </tr>
            </thead>
            <tbody>
              {data.commitments.map((row) => <CommitmentRow key={`${row.kind}-${row.id}`} row={row} money={money} />)}
              {data.commitments.length === 0 && <EmptyRow colSpan={5} text="No hay compromisos SAP abiertos para este proyecto." />}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
};

const SapKpi: React.FC<{ label: string; value: string; detail: string }> = ({ label, value, detail }) => (
  <div className="bg-white px-4 py-3">
    <p className="text-[8px] font-black uppercase tracking-[0.1em] text-slate-400">{label}</p>
    <p className="mt-1 text-[15px] font-extrabold tracking-tight text-slate-950">{value}</p>
    <p className="mt-1 text-[8px] text-slate-400">{detail}</p>
  </div>
);

const PolicyItem: React.FC<{ ok: boolean; title: string; detail: string }> = ({ ok, title, detail }) => (
  <div className="flex gap-2 rounded-xl border border-slate-200 bg-white p-3">
    {ok ? <ShieldCheck className="mt-0.5 h-4 w-4 flex-none text-emerald-600" /> : <FileSearch className="mt-0.5 h-4 w-4 flex-none text-amber-600" />}
    <div>
      <p className="text-[9px] font-extrabold text-slate-800">{title}</p>
      <p className="mt-1 text-[8px] leading-relaxed text-slate-400">{detail}</p>
    </div>
  </div>
);

const EmptyRow: React.FC<{ colSpan: number; text: string }> = ({ colSpan, text }) => (
  <tr><td colSpan={colSpan} className="px-3 py-8 text-center text-[9px] text-slate-400">{text}</td></tr>
);

const CommitmentRow: React.FC<{
  row: SapFinancialCommitmentV1G5;
  money: (value: number, currency?: string) => string;
}> = ({ row, money }) => {
  if (row.kind === 'PRE_PO') {
    return (
      <tr className="border-b border-slate-50 text-[9px] text-slate-600 last:border-0">
        <td className="px-2 py-2.5"><span className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-1 text-[8px] font-extrabold text-sky-700 ring-1 ring-sky-100"><ClipboardList className="h-3 w-3" /> SolP</span></td>
        <td className="px-2 py-2.5"><p className="font-bold text-slate-800">{row.sourceReference ?? row.externalKey}</p><p className="mt-0.5 font-mono text-[8px] text-slate-400">{row.wbsElement ?? '—'}</p></td>
        <td className="px-2 py-2.5">{row.costCodeName ?? row.costCode ?? row.description}</td>
        <td className="whitespace-nowrap px-2 py-2.5">{shortDate(row.committedAt)}</td>
        <td className={`whitespace-nowrap px-2 py-2.5 text-right font-extrabold ${row.includedInSummary ? 'text-slate-900' : 'text-amber-700'}`}>{money(row.amount, row.currency)}</td>
      </tr>
    );
  }

  return (
    <tr className="border-b border-slate-50 text-[9px] text-slate-600 last:border-0">
      <td className="px-2 py-2.5"><span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-1 text-[8px] font-extrabold text-green-700 ring-1 ring-green-100"><ShoppingCart className="h-3 w-3" /> Pedido</span></td>
      <td className="px-2 py-2.5"><p className="font-bold text-slate-800">{row.purchaseOrderNumber} · {row.purchaseOrderPosition ?? '—'}</p><p className="mt-0.5 text-[8px] text-slate-400">{row.outstandingQty.toLocaleString('es-PE')} pendientes</p></td>
      <td className="px-2 py-2.5"><p className="font-semibold text-slate-700">{row.supplierName ?? row.supplierCode ?? 'Sin proveedor'}</p><p className="mt-0.5 text-[8px] text-slate-400">{row.materialCode} · {row.materialTitle}</p></td>
      <td className="whitespace-nowrap px-2 py-2.5">{shortDate(row.expectedDate)}</td>
      <td className={`whitespace-nowrap px-2 py-2.5 text-right font-extrabold ${row.includedInSummary ? 'text-slate-900' : 'text-amber-700'}`}>{money(row.amount, row.currency)}</td>
    </tr>
  );
};