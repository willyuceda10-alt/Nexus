import React from 'react';
import { Settings, Building, ShieldCheck, Database, Key, Globe } from 'lucide-react';
import { useNexus } from '../../context/NexusContext';

export const SettingsView: React.FC = () => {
  const { tenant } = useNexus();

  return (
    <div className="space-y-6 max-w-5xl mx-auto p-2">
      <div className="flex items-center justify-between border-b border-slate-200 pb-3 dark:border-slate-800">
        <div>
          <h1 className="text-xl font-extrabold text-slate-900 dark:text-slate-100 flex items-center space-x-2">
            <Settings className="h-5 w-5 text-indigo-600" />
            <span>Configuración Multitenant & Gobernanza SaaS</span>
          </h1>
          <p className="text-xs text-slate-500">Ajustes de la organización {tenant.name} y reglas RLS.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Organization Information */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center space-x-2 text-indigo-600 font-bold text-xs uppercase tracking-wider">
            <Building className="h-4 w-4" />
            <span>Organización Tenant</span>
          </div>

          <div className="mt-4 space-y-3 text-xs">
            <div>
              <label className="text-slate-400 font-medium">Nombre de la Empresa</label>
              <input
                type="text"
                readOnly
                value={tenant.name}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 p-2 font-bold text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
              />
            </div>
            <div>
              <label className="text-slate-400 font-medium">Dominio asignado</label>
              <input
                type="text"
                readOnly
                value={`${tenant.slug}.nexus-os.io`}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 p-2 font-mono text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
              />
            </div>
            <div>
              <label className="text-slate-400 font-medium">Tenant ID Inmutable (RLS Token)</label>
              <input
                type="text"
                readOnly
                value={tenant.id}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 p-2 font-mono text-indigo-600 font-bold dark:border-slate-700 dark:bg-slate-800"
              />
            </div>
          </div>
        </div>

        {/* RLS & Security Policies */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center space-x-2 text-emerald-600 font-bold text-xs uppercase tracking-wider">
            <ShieldCheck className="h-4 w-4" />
            <span>Políticas de Aislamiento RLS</span>
          </div>

          <div className="mt-4 space-y-2.5 text-xs">
            <div className="flex items-center justify-between rounded-xl bg-slate-50 p-3 dark:bg-slate-800/50">
              <div>
                <div className="font-bold text-slate-800 dark:text-slate-200">PostgreSQL Row Level Security</div>
                <div className="text-[11px] text-slate-400">Filtrado automático por `tenant_id`</div>
              </div>
              <span className="rounded bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                ACTIVO
              </span>
            </div>

            <div className="flex items-center justify-between rounded-xl bg-slate-50 p-3 dark:bg-slate-800/50">
              <div>
                <div className="font-bold text-slate-800 dark:text-slate-200">Rotación de JWT & Session Tokens</div>
                <div className="text-[11px] text-slate-400">Expiración a 15 minutos + Refresh token</div>
              </div>
              <span className="rounded bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                ACTIVO
              </span>
            </div>

            <div className="flex items-center justify-between rounded-xl bg-slate-50 p-3 dark:bg-slate-800/50">
              <div>
                <div className="font-bold text-slate-800 dark:text-slate-200">Auditoría Inmutable (Soft Delete)</div>
                <div className="text-[11px] text-slate-400">Log de operaciones CRUD con `deleted_at`</div>
              </div>
              <span className="rounded bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                ACTIVO
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
