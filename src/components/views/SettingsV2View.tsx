import React, { useEffect, useMemo, useState } from 'react';
import {
  Bell,
  Building2,
  CheckCircle2,
  Clock3,
  LockKeyhole,
  Mail,
  RefreshCw,
  Save,
  ShieldCheck,
  Sparkles,
  UsersRound,
} from 'lucide-react';
import { bridataApi, BridataApiError } from '../../api/client';
import type {
  ApiExternalNotificationPreferenceV1,
  ApiNotificationCapabilitiesV1,
  ApiNotificationPreferencesV1,
} from '../../api/notificationPreferencesV1Contracts';
import { useApiBootstrap } from '../../context/ApiBootstrapContext';
import { useNexus } from '../../context/NexusContext';

const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;

function browserTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

function defaultPreference(channel: 'OUTLOOK_EMAIL' | 'TEAMS_ACTIVITY'): ApiExternalNotificationPreferenceV1 {
  return {
    enabled: false,
    minimumPriority: 'HIGH',
    onlyRequiresAction: channel === 'TEAMS_ACTIVITY',
    quietHoursStart: '22:00',
    quietHoursEnd: '07:00',
    timezone: browserTimezone(),
  };
}

function mockPreferences(): ApiNotificationPreferencesV1 {
  return {
    version: 1,
    internal: { enabled: true, canonical: true },
    outlookEmail: defaultPreference('OUTLOOK_EMAIL'),
    teamsActivity: defaultPreference('TEAMS_ACTIVITY'),
  };
}

function errorText(error: unknown): string {
  if (error instanceof BridataApiError) {
    return error.correlationId ? `${error.message} · Ref: ${error.correlationId}` : error.message;
  }
  return error instanceof Error ? error.message : 'No se pudo completar la operación.';
}

function Toggle({ checked, onChange, disabled = false }: { checked: boolean; onChange: (value: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 rounded-full transition ${checked ? 'bg-green-700' : 'bg-slate-200'} disabled:cursor-not-allowed disabled:opacity-50`}
      aria-pressed={checked}
    >
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-all ${checked ? 'left-[22px]' : 'left-0.5'}`} />
    </button>
  );
}

function ChannelCard({
  title,
  description,
  icon,
  preference,
  configured,
  onChange,
}: {
  title: string;
  description: string;
  icon: React.ReactNode;
  preference: ApiExternalNotificationPreferenceV1;
  configured: boolean;
  onChange: (next: ApiExternalNotificationPreferenceV1) => void;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="flex gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-green-50 text-green-700 ring-1 ring-green-100">{icon}</div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-extrabold text-slate-900">{title}</h3>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ${configured ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : 'bg-slate-100 text-slate-500 ring-slate-200'}`}>
                {configured ? 'CONFIGURADO' : 'PENDIENTE AZURE'}
              </span>
            </div>
            <p className="mt-1 text-xs leading-5 text-slate-500">{description}</p>
          </div>
        </div>
        <Toggle checked={preference.enabled} onChange={(enabled) => onChange({ ...preference, enabled })} />
      </div>

      <div className="mt-5 grid gap-4 border-t border-slate-100 pt-4 md:grid-cols-2">
        <label className="space-y-1.5 text-xs font-semibold text-slate-600">
          Prioridad mínima
          <select
            value={preference.minimumPriority}
            onChange={(event) => onChange({ ...preference, minimumPriority: event.target.value as ApiExternalNotificationPreferenceV1['minimumPriority'] })}
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-800 outline-none focus:border-green-500"
          >
            {PRIORITIES.map((priority) => <option key={priority} value={priority}>{priority}</option>)}
          </select>
        </label>

        <label className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3.5 py-3 ring-1 ring-slate-100">
          <span>
            <span className="block text-xs font-bold text-slate-700">Solo si requiere acción</span>
            <span className="mt-0.5 block text-[10px] text-slate-400">Reduce avisos informativos.</span>
          </span>
          <Toggle checked={preference.onlyRequiresAction} onChange={(onlyRequiresAction) => onChange({ ...preference, onlyRequiresAction })} />
        </label>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-[1fr_1fr_1.4fr]">
        <label className="space-y-1.5 text-xs font-semibold text-slate-600">
          Silencio desde
          <input type="time" value={preference.quietHoursStart ?? ''} onChange={(event) => onChange({ ...preference, quietHoursStart: event.target.value || null })} className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm" />
        </label>
        <label className="space-y-1.5 text-xs font-semibold text-slate-600">
          Hasta
          <input type="time" value={preference.quietHoursEnd ?? ''} onChange={(event) => onChange({ ...preference, quietHoursEnd: event.target.value || null })} className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm" />
        </label>
        <label className="space-y-1.5 text-xs font-semibold text-slate-600">
          Zona horaria
          <input value={preference.timezone} onChange={(event) => onChange({ ...preference, timezone: event.target.value })} className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm" />
        </label>
      </div>
    </div>
  );
}

export const SettingsV2View: React.FC = () => {
  const { tenant, currentWorkspace, currentUser } = useNexus();
  const apiBootstrap = useApiBootstrap();
  const apiReady = apiBootstrap.dataMode === 'api' && apiBootstrap.status === 'ready';
  const [preferences, setPreferences] = useState<ApiNotificationPreferencesV1>(mockPreferences());
  const [capabilities, setCapabilities] = useState<ApiNotificationCapabilitiesV1>({
    graphDeliveryEnabled: false,
    outlookConfigured: false,
    teamsConfigured: false,
    notificationWorkerEnabled: false,
  });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!apiReady) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void Promise.all([
      bridataApi.notificationPreferencesV1(controller.signal),
      bridataApi.notificationCapabilitiesV1(controller.signal),
    ])
      .then(([prefs, caps]) => {
        setPreferences(prefs);
        setCapabilities(caps);
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setError(errorText(cause));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [apiReady]);

  const save = async () => {
    setMessage(null);
    setError(null);
    if (!apiReady) {
      setMessage('Vista previa actualizada localmente. En modo API estas preferencias se guardan por usuario.');
      return;
    }
    setSaving(true);
    try {
      await bridataApi.updateNotificationPreferencesV1({
        outlookEmail: preferences.outlookEmail,
        teamsActivity: preferences.teamsActivity,
      });
      setMessage('Preferencias de notificación guardadas.');
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setSaving(false);
    }
  };

  const graphSummary = useMemo(() => {
    if (!apiReady) return 'Preview visual · Microsoft 365 no se ejecuta en mock';
    if (!capabilities.graphDeliveryEnabled) return 'Microsoft Graph está deshabilitado por configuración';
    if (capabilities.outlookConfigured && capabilities.teamsConfigured) return 'Outlook y Teams listos para el worker';
    return 'Graph habilitado con canales todavía incompletos';
  }, [apiReady, capabilities]);

  return (
    <div className="mx-auto max-w-[1320px] space-y-5 p-5 lg:p-7">
      <header className="rounded-3xl border border-slate-200 bg-white px-6 py-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex gap-4">
            <div className="grid h-12 w-12 place-items-center rounded-2xl bg-green-50 ring-1 ring-green-100">
              <ShieldCheck className="h-6 w-6 text-green-700" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-extrabold tracking-tight text-slate-950">Configuración y gobernanza</h1>
                <span className="rounded-full bg-green-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-green-700 ring-1 ring-green-200">Enterprise</span>
              </div>
              <p className="mt-1 max-w-3xl text-sm text-slate-500">Identidad, aislamiento de tenant y preferencias personales de entrega para el Work OS.</p>
            </div>
          </div>
          <button disabled={saving || loading} onClick={() => void save()} className="inline-flex items-center gap-2 rounded-xl bg-green-700 px-4 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-green-800 disabled:opacity-50">
            {saving ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Guardar preferencias
          </button>
        </div>
      </header>

      {(error || message) && (
        <div className={`rounded-2xl border px-4 py-3 text-sm ${error ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>
          {error ?? message}
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[0.8fr_1.2fr]">
        <div className="space-y-5">
          <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-xl bg-slate-50 ring-1 ring-slate-100"><Building2 className="h-5 w-5 text-green-700" /></div>
              <div><h2 className="text-sm font-extrabold text-slate-950">Organización</h2><p className="text-xs text-slate-500">Contexto activo del tenant.</p></div>
            </div>
            <dl className="mt-5 space-y-4 text-sm">
              <div className="flex justify-between gap-4"><dt className="text-slate-400">Empresa</dt><dd className="font-bold text-slate-800">{tenant.name}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-slate-400">Workspace</dt><dd className="font-semibold text-slate-700">{currentWorkspace?.name ?? '—'}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-slate-400">Usuario</dt><dd className="font-semibold text-slate-700">{currentUser.name}</dd></div>
            </dl>
          </section>

          <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-3"><LockKeyhole className="h-5 w-5 text-green-700" /><h2 className="text-sm font-extrabold text-slate-950">Seguridad de plataforma</h2></div>
            <div className="mt-4 space-y-3">
              {[
                ['Aislamiento PostgreSQL RLS', 'Tenant context transaccional y FORCE RLS en dominios tipados.'],
                ['Authorization V2', 'Permisos efectivos con políticas scoped y DENY explícito.'],
                ['Managed Identity', 'Workers Azure sin secretos de Service Bus ni Graph en código.'],
              ].map(([title, text]) => (
                <div key={title} className="flex gap-3 rounded-2xl bg-slate-50 p-3.5 ring-1 ring-slate-100">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 flex-none text-emerald-600" />
                  <div><p className="text-xs font-bold text-slate-700">{title}</p><p className="mt-1 text-[11px] leading-5 text-slate-500">{text}</p></div>
                </div>
              ))}
            </div>
          </section>
        </div>

        <section className="rounded-3xl border border-slate-200 bg-slate-50/60 p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-xl bg-green-50 ring-1 ring-green-100"><Bell className="h-5 w-5 text-green-700" /></div>
              <div><h2 className="text-sm font-extrabold text-slate-950">Canales de notificación</h2><p className="text-xs text-slate-500">Mi trabajo es la fuente canónica; Microsoft 365 es entrega secundaria.</p></div>
            </div>
            <span className="rounded-full bg-white px-3 py-1.5 text-[10px] font-bold text-slate-500 ring-1 ring-slate-200">{graphSummary}</span>
          </div>

          <div className="mt-5 space-y-4">
            <div className="rounded-2xl border border-green-200 bg-green-50/70 p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex gap-3"><div className="grid h-10 w-10 place-items-center rounded-xl bg-white text-green-700 ring-1 ring-green-100"><Sparkles className="h-5 w-5" /></div><div><h3 className="text-sm font-extrabold text-green-950">Mi trabajo · Inbox interno</h3><p className="mt-1 text-xs leading-5 text-green-800/70">Siempre activo. Las automatizaciones y dominios proyectan aquí el trabajo que requiere atención, aunque Outlook o Teams no estén disponibles.</p></div></div>
                <span className="rounded-full bg-white px-2.5 py-1 text-[10px] font-black text-green-700 ring-1 ring-green-200">CANÓNICO</span>
              </div>
            </div>

            <ChannelCard title="Outlook Email" description="Entrega secundaria por Microsoft Graph. La bandeja de Outlook no reemplaza el Inbox de Bridata." icon={<Mail className="h-5 w-5" />} preference={preferences.outlookEmail} configured={!apiReady || capabilities.outlookConfigured} onChange={(outlookEmail) => setPreferences((current) => ({ ...current, outlookEmail }))} />
            <ChannelCard title="Microsoft Teams" description="Actividad de Teams para alertas seleccionadas. Requiere configuración de la app de Teams y permisos Graph/RSC." icon={<UsersRound className="h-5 w-5" />} preference={preferences.teamsActivity} configured={!apiReady || capabilities.teamsConfigured} onChange={(teamsActivity) => setPreferences((current) => ({ ...current, teamsActivity }))} />
          </div>

          <div className="mt-4 flex gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-[11px] leading-5 text-slate-500">
            <Clock3 className="mt-0.5 h-4 w-4 flex-none text-slate-400" />
            <span>Los horarios silenciosos afectan solo entregas externas. Los elementos siguen llegando a <strong className="text-slate-700">Mi trabajo</strong> para no perder trazabilidad.</span>
          </div>
        </section>
      </div>
    </div>
  );
};
