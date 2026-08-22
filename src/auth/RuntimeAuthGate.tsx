import React from 'react';
import { Building2, LogIn, RefreshCw, ShieldCheck } from 'lucide-react';
import { BRAND } from '../config/brand';
import { useRuntimeAuth } from './RuntimeAuthContext';

export const RuntimeAuthGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const auth = useRuntimeAuth();

  if (auth.status === 'ready') return <>{children}</>;

  if (auth.status === 'initializing') {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-xl shadow-slate-200/50">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
            <RefreshCw className="h-5 w-5 animate-spin" />
          </div>
          <h1 className="mt-5 text-xl font-bold tracking-tight text-slate-900">{BRAND.name}</h1>
          <p className="mt-2 text-sm text-slate-500">Preparando tu sesión segura…</p>
        </div>
      </div>
    );
  }

  if (auth.status === 'signed_out') {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 shadow-xl shadow-slate-200/50">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-indigo-600 text-white shadow-sm shadow-indigo-200">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-slate-900">{BRAND.name}</h1>
              <p className="text-xs font-medium text-slate-500">Project & Portfolio Management</p>
            </div>
          </div>

          <div className="mt-8 rounded-2xl border border-slate-100 bg-slate-50 p-5">
            <h2 className="text-sm font-bold text-slate-900">Acceso corporativo</h2>
            <p className="mt-2 text-xs leading-5 text-slate-500">
              Inicia sesión con tu cuenta autorizada de Microsoft. Bridata Project utiliza OAuth 2.0 / OpenID Connect con PKCE; el navegador no necesita un client secret.
            </p>
          </div>

          <button
            onClick={() => void auth.signIn()}
            className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white shadow-sm shadow-indigo-200 transition hover:bg-indigo-700"
          >
            <LogIn className="h-4 w-4" />
            Continuar con Microsoft
          </button>
        </div>
      </div>
    );
  }

  if (auth.status === 'tenant_selection') {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="w-full max-w-xl rounded-3xl border border-slate-200 bg-white p-8 shadow-xl shadow-slate-200/50">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
              <Building2 className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-slate-900">Selecciona una empresa</h1>
              <p className="text-xs text-slate-500">Tu identidad tiene acceso a más de un tenant de {BRAND.name}.</p>
            </div>
          </div>

          <div className="mt-6 space-y-2">
            {auth.session?.tenants.map((tenant) => (
              <button
                key={tenant.id}
                onClick={() => auth.selectTenant(tenant.id)}
                className="flex w-full items-center justify-between rounded-2xl border border-slate-200 px-4 py-3 text-left transition hover:border-indigo-300 hover:bg-indigo-50/50"
              >
                <div>
                  <div className="text-sm font-semibold text-slate-900">{tenant.name}</div>
                  <div className="mt-0.5 text-[11px] text-slate-500">{tenant.role} · {tenant.plan}</div>
                </div>
                <span className="text-xs font-semibold text-indigo-600">Entrar</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-3xl border border-rose-200 bg-white p-8 shadow-xl shadow-slate-200/50">
        <h1 className="text-lg font-bold text-slate-900">No se pudo iniciar Bridata Project</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          {auth.error || 'Se produjo un error al validar la sesión.'}
        </p>
        <div className="mt-6 flex gap-2">
          <button
            onClick={() => void auth.retry()}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700"
          >
            <RefreshCw className="h-4 w-4" />
            Reintentar
          </button>
          {auth.mode === 'entra' && (
            <button
              onClick={() => void auth.signIn()}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              <LogIn className="h-4 w-4" />
              Iniciar sesión
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
