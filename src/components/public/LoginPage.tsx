import React from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  CheckCircle2,
  LockKeyhole,
  ShieldCheck,
} from 'lucide-react';
import { BRAND } from '../../config/brand';
import { runtimeConfig } from '../../config/runtime';
import { hasBridataEntraAccessTokenProvider } from '../../auth/accessTokenProvider';
import {
  hasBridataMicrosoftAccount,
  signInBridataWithMicrosoft,
} from '../../auth/msalBridata';

type LoginPageProps = {
  onNavigate: (path: string) => void;
};

export const LoginPage: React.FC<LoginPageProps> = ({ onNavigate }) => {
  const isEntra = runtimeConfig.dataMode === 'api' && runtimeConfig.authMode === 'entra';
  const isApiDev = runtimeConfig.dataMode === 'api' && runtimeConfig.authMode === 'dev';
  const entraProviderReady = !isEntra || hasBridataEntraAccessTokenProvider();
  const entraBlocked = isEntra && !entraProviderReady;

  React.useEffect(() => {
    if (
      isEntra &&
      entraProviderReady &&
      hasBridataMicrosoftAccount()
    ) {
      onNavigate('/app');
    }
  }, [isEntra, entraProviderReady, onNavigate]);

  const enterPlatform = async () => {
    if (entraBlocked) return;

    if (isEntra) {
      await signInBridataWithMicrosoft();

      if (hasBridataMicrosoftAccount()) {
        onNavigate('/app');
      }

      return;
    }

    onNavigate('/app');
  };

  return (
    <main className="grid min-h-dvh bg-[#E9EEF3] lg:grid-cols-[0.95fr_1.05fr]">
      <section className="relative hidden overflow-hidden bg-[#0D2533] px-10 py-12 text-white lg:flex lg:flex-col lg:justify-between xl:px-16">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_18%,rgba(14,138,80,0.28),transparent_30%),radial-gradient(circle_at_80%_80%,rgba(43,89,119,0.4),transparent_34%)]" />
        <div className="relative">
          <button onClick={() => onNavigate('/')} className="flex items-center gap-3 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#0E8A50] text-[11px] font-black tracking-[0.08em]">{BRAND.initials}</span>
            <span className="text-left"><span className="block text-sm font-black">{BRAND.name}</span><span className="block text-[9px] font-extrabold uppercase tracking-[0.18em] text-emerald-300">Enterprise Work OS</span></span>
          </button>
        </div>

        <div className="relative max-w-xl">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-emerald-300">Acceso empresarial</p>
          <h1 className="mt-4 text-4xl font-black leading-tight tracking-[-0.04em] xl:text-5xl">Tu operación, tus proyectos y tus decisiones en un mismo entorno.</h1>
          <p className="mt-5 text-base leading-7 text-slate-300">Bridata organiza ejecución, PMO, materiales, compras, inventario, costos y trazabilidad SAP con una experiencia de trabajo unificada.</p>
          <div className="mt-8 grid gap-3 sm:grid-cols-2">
            {[
              ['Gobernanza PMO', 'Roles, riesgos, cambios y decisiones.'],
              ['Trazabilidad SAP', 'Comprometido, recepción, consumo y costo real.'],
            ].map(([title, detail]) => (
              <div key={title} className="rounded-2xl border border-white/10 bg-white/[0.045] p-4">
                <CheckCircle2 className="h-4 w-4 text-emerald-300" />
                <p className="mt-3 text-sm font-black">{title}</p>
                <p className="mt-1 text-xs leading-5 text-slate-400">{detail}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="relative text-xs text-slate-500">© 2026 Bridata Project · Enterprise Work OS</div>
      </section>

      <section className="flex min-h-dvh items-center justify-center px-5 py-10 sm:px-8">
        <div className="w-full max-w-md">
          <button onClick={() => onNavigate('/')} className="mb-6 inline-flex items-center gap-2 rounded-lg px-1 py-2 text-sm font-bold text-slate-600 transition hover:text-[#0B6B4A] lg:hidden"><ArrowLeft className="h-4 w-4" /> Volver</button>

          <div className="rounded-[24px] border border-slate-300/80 bg-[#F8FAFC] p-6 shadow-[0_24px_70px_rgba(15,42,58,0.14)] sm:p-8">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.14em] text-[#0B6B4A]">Bridata Project</p>
                <h2 className="mt-2 text-3xl font-black tracking-[-0.035em] text-[#102A3A]">Iniciar sesión</h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">Accede al workspace de tu organización con el método configurado para este entorno.</p>
              </div>
              <span className="grid h-11 w-11 flex-none place-items-center rounded-xl bg-[#102A3A] text-emerald-300"><LockKeyhole className="h-5 w-5" /></span>
            </div>

            <div className="mt-6 rounded-2xl border border-slate-300/70 bg-[#E9EEF3] p-4">
              <div className="flex items-center gap-3">
                <span className="grid h-9 w-9 place-items-center rounded-xl bg-white text-[#102A3A] shadow-sm"><Building2 className="h-4 w-4" /></span>
                <div className="min-w-0">
                  <p className="text-sm font-black text-[#102A3A]">Acceso corporativo</p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {isEntra ? 'Microsoft Entra ID' : isApiDev ? 'API · entorno DEV' : 'Entorno de demostración'}
                  </p>
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={enterPlatform}
              disabled={entraBlocked}
              aria-disabled={entraBlocked}
              className={`mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-xl px-4 text-sm font-extrabold text-white shadow-lg transition ${
                entraBlocked
                  ? 'cursor-not-allowed bg-slate-400 shadow-none'
                  : 'bg-[#0B6B4A] shadow-emerald-950/15 hover:-translate-y-0.5 hover:bg-[#095A3E]'
              }`}
            >
              {entraBlocked
                ? 'SSO pendiente de configuración'
                : isEntra
                  ? 'Continuar con Microsoft'
                  : isApiDev
                    ? 'Entrar al entorno DEV'
                    : 'Entrar a la demo'}
              {!entraBlocked && <ArrowRight className="h-4 w-4" />}
            </button>

            {entraBlocked ? (
              <div className="mt-5 flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3 text-xs leading-5 text-amber-900" role="status">
                <LockKeyhole className="mt-0.5 h-4 w-4 flex-none text-amber-700" />
                <span>Este entorno está configurado para Microsoft Entra ID, pero el frontend todavía no tiene un proveedor MSAL/SSO registrado. El acceso queda bloqueado para evitar una sesión aparente o un token simulado.</span>
              </div>
            ) : (
              <div className="mt-5 flex items-start gap-2.5 rounded-xl border border-emerald-200/80 bg-emerald-50 px-3.5 py-3 text-xs leading-5 text-emerald-900">
                <ShieldCheck className="mt-0.5 h-4 w-4 flex-none text-emerald-700" />
                <span>Los permisos reales se validan en el backend. La interfaz solo representa el acceso autorizado para la sesión.</span>
              </div>
            )}

            <p className="mt-5 text-center text-[11px] leading-5 text-slate-500">
              {entraBlocked
                ? 'Registra el proveedor MSAL y el scope delegado de Bridata API antes de habilitar el acceso Entra.'
                : isEntra
                  ? 'Al continuar se inicia el bootstrap seguro del entorno Entra configurado.'
                  : 'Este entorno no representa una sesión productiva de Microsoft Entra ID.'}
            </p>
          </div>

          <button onClick={() => onNavigate('/')} className="mx-auto mt-6 hidden items-center gap-2 text-xs font-bold text-slate-500 transition hover:text-[#0B6B4A] lg:flex"><ArrowLeft className="h-3.5 w-3.5" /> Volver a Bridata Project</button>
        </div>
      </section>
    </main>
  );
};
