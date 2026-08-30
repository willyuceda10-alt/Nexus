import { CheckCircle2, Cloud, CloudOff, LoaderCircle } from 'lucide-react';
import { useApiBootstrap } from '../../context/ApiBootstrapContext';

export function ApiStatusBadge() {
  const { status, bootstrap, error, retry, authMode } = useApiBootstrap();
  const authLabel = authMode === 'entra' ? 'Entra' : 'DEV';

  if (status === 'mock') {
    return (
      <span
        className="hidden xl:inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[10px] font-semibold text-slate-500"
        title="La interfaz usa datos mock; no representa una sesión API autenticada."
      >
        <Cloud className="h-3 w-3" />
        Demo
      </span>
    );
  }

  if (status === 'loading') {
    return (
      <span
        className="hidden xl:inline-flex items-center gap-1.5 rounded-full border border-indigo-100 bg-indigo-50 px-2.5 py-1 text-[10px] font-semibold text-indigo-600"
        title={`Conectando con autenticación ${authLabel}`}
      >
        <LoaderCircle className="h-3 w-3 animate-spin" />
        Conectando · {authLabel}
      </span>
    );
  }

  if (status === 'error') {
    return (
      <button
        type="button"
        onClick={() => void retry()}
        className="hidden xl:inline-flex items-center gap-1.5 rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-[10px] font-semibold text-rose-600 hover:bg-rose-100"
        title={error || `No se pudo iniciar la sesión API ${authLabel}. Haz clic para reintentar.`}
      >
        <CloudOff className="h-3 w-3" />
        API · {authLabel} sin conexión
      </button>
    );
  }

  return (
    <span
      className="hidden xl:inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[10px] font-semibold text-emerald-700"
      title={bootstrap ? `${bootstrap.tenant.name} · ${bootstrap.actor.email} · ${authLabel}` : `API conectada · ${authLabel}`}
    >
      <CheckCircle2 className="h-3 w-3" />
      API · {authLabel}
    </span>
  );
}
