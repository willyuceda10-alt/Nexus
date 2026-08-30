import React from 'react';
import {
  ArrowRight,
  BarChart3,
  Boxes,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  Database,
  FileCheck2,
  FolderKanban,
  Gauge,
  Layers3,
  LockKeyhole,
  Menu,
  Network,
  PackageSearch,
  ShieldCheck,
  Sparkles,
  UsersRound,
  X,
} from 'lucide-react';
import { BRAND } from '../../config/brand';

type LandingPageProps = {
  onNavigate: (path: string) => void;
};

const modules = [
  { icon: Gauge, title: 'Centro de mando', detail: 'Visibilidad ejecutiva de operación, prioridades y decisiones.' },
  { icon: ShieldCheck, title: 'Control PMO', detail: 'Portafolio, línea base, riesgos, forecast y gobernanza.' },
  { icon: Database, title: 'Centro SAP', detail: 'Trazabilidad de SolP, pedido, recepción, stock, consumo y costo real.' },
  { icon: PackageSearch, title: 'Materiales', detail: 'Demanda, disponibilidad, por llegar e inventario operativo.' },
  { icon: CircleDollarSign, title: 'Costos', detail: 'Comprometido, costo real, presupuesto y control financiero.' },
  { icon: BarChart3, title: 'Analítica', detail: 'Indicadores ejecutivos para decidir con contexto y evidencia.' },
];

const benefits = [
  'Una sola fuente operativa para proyectos y ejecución.',
  'Gobernanza PMO con trazabilidad de decisiones y cambios.',
  'Conexión entre materiales, compras, inventario y costos.',
  'Seguridad multi-tenant y permisos por rol.',
];

export const LandingPage: React.FC<LandingPageProps> = ({ onNavigate }) => {
  const [mobileOpen, setMobileOpen] = React.useState(false);

  const go = (path: string) => {
    setMobileOpen(false);
    onNavigate(path);
  };

  return (
    <div className="min-h-dvh bg-[#E9EEF3] text-slate-950">
      <header className="sticky top-0 z-50 border-b border-white/10 bg-[#0D2533]/95 text-white shadow-[0_10px_30px_rgba(7,22,31,0.16)] backdrop-blur-xl">
        <div className="mx-auto flex h-[72px] max-w-[1500px] items-center justify-between px-5 sm:px-8 lg:px-10">
          <button onClick={() => go('/')} className="flex items-center gap-3 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#0E8A50] shadow-lg shadow-emerald-950/20">
              <span className="text-[11px] font-black tracking-[0.08em]">{BRAND.initials}</span>
            </span>
            <span className="text-left">
              <span className="block text-[15px] font-black tracking-tight">{BRAND.name}</span>
              <span className="block text-[9px] font-extrabold uppercase tracking-[0.2em] text-emerald-300">Enterprise Work OS</span>
            </span>
          </button>

          <nav className="hidden items-center gap-1 lg:flex" aria-label="Navegación pública">
            {[
              ['#producto', 'Producto'],
              ['#soluciones', 'Soluciones'],
              ['#modulos', 'Módulos'],
              ['#seguridad', 'Seguridad'],
            ].map(([href, label]) => (
              <a key={href} href={href} className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-300 transition hover:bg-white/8 hover:text-white">{label}</a>
            ))}
          </nav>

          <div className="hidden items-center gap-2 lg:flex">
            <button onClick={() => go('/login')} className="h-10 rounded-xl border border-white/15 px-4 text-sm font-bold text-white transition hover:bg-white/8">Iniciar sesión</button>
            <button onClick={() => go('/login')} className="flex h-10 items-center gap-2 rounded-xl bg-[#0E8A50] px-4 text-sm font-bold text-white shadow-lg shadow-emerald-950/20 transition hover:bg-[#0C7746]">
              Solicitar demo <ArrowRight className="h-4 w-4" />
            </button>
          </div>

          <button onClick={() => setMobileOpen((value) => !value)} className="grid h-10 w-10 place-items-center rounded-xl border border-white/15 text-slate-200 lg:hidden" aria-label="Abrir menú">
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>

        {mobileOpen && (
          <div className="border-t border-white/10 px-5 pb-5 pt-3 lg:hidden">
            <div className="mx-auto max-w-[1500px] space-y-1">
              {[
                ['#producto', 'Producto'],
                ['#soluciones', 'Soluciones'],
                ['#modulos', 'Módulos'],
                ['#seguridad', 'Seguridad'],
              ].map(([href, label]) => (
                <a key={href} href={href} onClick={() => setMobileOpen(false)} className="block rounded-xl px-3 py-3 text-sm font-semibold text-slate-200 hover:bg-white/8">{label}</a>
              ))}
              <button onClick={() => go('/login')} className="mt-3 w-full rounded-xl bg-[#0E8A50] px-4 py-3 text-sm font-bold text-white">Iniciar sesión</button>
            </div>
          </div>
        )}
      </header>

      <main>
        <section id="producto" className="relative overflow-hidden bg-[#0D2533] text-white">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_82%_18%,rgba(21,128,91,0.34),transparent_31%),radial-gradient(circle_at_15%_75%,rgba(36,86,115,0.34),transparent_32%)]" />
          <div className="relative mx-auto grid max-w-[1500px] gap-14 px-5 py-20 sm:px-8 sm:py-24 lg:grid-cols-[0.9fr_1.1fr] lg:items-center lg:px-10 lg:py-28">
            <div className="max-w-2xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-emerald-300/20 bg-emerald-300/8 px-3 py-1.5 text-xs font-bold text-emerald-200">
                <Sparkles className="h-3.5 w-3.5" /> Gestión empresarial conectada
              </div>
              <h1 className="mt-6 text-4xl font-black leading-[1.04] tracking-[-0.045em] sm:text-5xl lg:text-[64px]">
                Controla proyectos, materiales, costos y operación SAP en una sola plataforma.
              </h1>
              <p className="mt-6 max-w-xl text-base leading-7 text-slate-300 sm:text-lg sm:leading-8">
                Bridata Project conecta ejecución, PMO, abastecimiento, inventario, costos y gobernanza para que cada decisión tenga contexto operativo real.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <button onClick={() => go('/login')} className="flex h-12 items-center justify-center gap-2 rounded-xl bg-[#0E8A50] px-5 text-sm font-extrabold text-white shadow-xl shadow-emerald-950/30 transition hover:-translate-y-0.5 hover:bg-[#0C7746]">
                  Iniciar sesión <ArrowRight className="h-4 w-4" />
                </button>
                <a href="#modulos" className="flex h-12 items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/5 px-5 text-sm font-bold text-white transition hover:bg-white/10">
                  Explorar plataforma <ChevronRight className="h-4 w-4" />
                </a>
              </div>
              <div className="mt-9 grid gap-3 sm:grid-cols-3">
                {[
                  ['PMO', 'Gobernanza'],
                  ['SAP', 'Trazabilidad'],
                  ['Work OS', 'Ejecución'],
                ].map(([value, label]) => (
                  <div key={value} className="rounded-xl border border-white/10 bg-white/[0.045] px-4 py-3">
                    <p className="text-sm font-black text-white">{value}</p>
                    <p className="mt-0.5 text-xs text-slate-400">{label}</p>
                  </div>
                ))}
              </div>
            </div>

            <ProductPreview />
          </div>
        </section>

        <section id="soluciones" className="border-b border-slate-300/70 bg-[#E9EEF3]">
          <div className="mx-auto max-w-[1500px] px-5 py-20 sm:px-8 lg:px-10">
            <div className="grid gap-12 lg:grid-cols-[0.78fr_1.22fr] lg:items-start">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.16em] text-[#0B6B4A]">Una operación, una lectura</p>
                <h2 className="mt-3 text-3xl font-black tracking-[-0.035em] text-[#102A3A] sm:text-4xl">Menos silos. Más control ejecutivo.</h2>
                <p className="mt-4 max-w-lg text-sm leading-7 text-slate-600 sm:text-base">
                  Proyectos, compras, inventario y costos dejan de vivir separados. Bridata organiza la ejecución alrededor de una misma estructura de trabajo y una trazabilidad común.
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {benefits.map((benefit) => (
                  <div key={benefit} className="flex gap-3 rounded-2xl border border-slate-300/70 bg-[#F7F9FB] p-5 shadow-[0_8px_24px_rgba(15,42,58,0.05)]">
                    <span className="mt-0.5 grid h-7 w-7 flex-none place-items-center rounded-lg bg-emerald-100 text-emerald-700"><CheckCircle2 className="h-4 w-4" /></span>
                    <p className="text-sm font-semibold leading-6 text-slate-700">{benefit}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section id="modulos" className="bg-[#DDE5EC]">
          <div className="mx-auto max-w-[1500px] px-5 py-20 sm:px-8 lg:px-10">
            <div className="mx-auto max-w-3xl text-center">
              <p className="text-xs font-black uppercase tracking-[0.16em] text-[#0B6B4A]">Módulos conectados</p>
              <h2 className="mt-3 text-3xl font-black tracking-[-0.035em] text-[#102A3A] sm:text-4xl">Un Work OS diseñado para operación compleja.</h2>
              <p className="mt-4 text-sm leading-7 text-slate-600 sm:text-base">Cada módulo comparte contexto de workspace, proyecto, responsables, fechas, riesgos y trazabilidad.</p>
            </div>
            <div className="mt-10 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {modules.map((module) => {
                const Icon = module.icon;
                return (
                  <article key={module.title} className="group rounded-2xl border border-slate-300/70 bg-[#F7F9FB] p-6 shadow-[0_8px_28px_rgba(15,42,58,0.05)] transition hover:-translate-y-1 hover:border-emerald-300 hover:shadow-[0_16px_40px_rgba(15,42,58,0.09)]">
                    <div className="grid h-11 w-11 place-items-center rounded-xl bg-[#102A3A] text-emerald-300 transition group-hover:bg-[#0B6B4A] group-hover:text-white"><Icon className="h-5 w-5" /></div>
                    <h3 className="mt-5 text-lg font-black text-[#102A3A]">{module.title}</h3>
                    <p className="mt-2 text-sm leading-6 text-slate-600">{module.detail}</p>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        <section id="seguridad" className="bg-[#102A3A] text-white">
          <div className="mx-auto grid max-w-[1500px] gap-10 px-5 py-20 sm:px-8 lg:grid-cols-[1fr_1fr] lg:items-center lg:px-10">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-bold text-emerald-200"><LockKeyhole className="h-3.5 w-3.5" /> Seguridad enterprise</div>
              <h2 className="mt-5 text-3xl font-black tracking-[-0.035em] sm:text-4xl">Gobernanza y seguridad desde la arquitectura.</h2>
              <p className="mt-4 max-w-xl text-sm leading-7 text-slate-300 sm:text-base">Identidad corporativa, separación por tenant y workspace, autorización por roles y auditoría para que la interfaz nunca sea la fuente de permiso.</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {[
                [UsersRound, 'Roles y segregación', 'PMO, administración y operación con responsabilidades separadas.'],
                [Network, 'Multi-tenant', 'Contexto de organización y workspace validado del lado servidor.'],
                [FileCheck2, 'Auditoría', 'Trazabilidad de cambios y decisiones relevantes.'],
                [LockKeyhole, 'Microsoft Entra ID', 'Preparado para autenticación corporativa en el entorno configurado.'],
              ].map(([Icon, title, detail]) => (
                <div key={String(title)} className="rounded-2xl border border-white/10 bg-white/[0.045] p-5">
                  {React.createElement(Icon as React.ComponentType<{ className?: string }>, { className: 'h-5 w-5 text-emerald-300' })}
                  <p className="mt-4 text-sm font-black">{String(title)}</p>
                  <p className="mt-1.5 text-xs leading-5 text-slate-400">{String(detail)}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-[#0B6B4A] text-white">
          <div className="mx-auto flex max-w-[1500px] flex-col gap-6 px-5 py-14 sm:px-8 lg:flex-row lg:items-center lg:justify-between lg:px-10">
            <div>
              <p className="text-xs font-extrabold uppercase tracking-[0.16em] text-emerald-100">Bridata Project</p>
              <h2 className="mt-2 text-2xl font-black tracking-tight sm:text-3xl">Centraliza la ejecución sin perder control gerencial.</h2>
            </div>
            <button onClick={() => go('/login')} className="flex h-12 items-center justify-center gap-2 rounded-xl bg-white px-5 text-sm font-extrabold text-[#0B6B4A] shadow-lg transition hover:-translate-y-0.5 hover:bg-emerald-50">Entrar a la plataforma <ArrowRight className="h-4 w-4" /></button>
          </div>
        </section>
      </main>

      <footer className="bg-[#081A24] text-slate-400">
        <div className="mx-auto flex max-w-[1500px] flex-col gap-5 px-5 py-8 text-xs sm:px-8 md:flex-row md:items-center md:justify-between lg:px-10">
          <div className="flex items-center gap-2.5"><span className="grid h-8 w-8 place-items-center rounded-lg bg-[#0E8A50] text-[9px] font-black text-white">{BRAND.initials}</span><span><strong className="block text-white">{BRAND.name}</strong><span>Enterprise Work OS</span></span></div>
          <div className="flex flex-wrap gap-x-5 gap-y-2"><span>Seguridad</span><span>Privacidad</span><span>Soporte</span><span>© 2026 Bridata Project</span></div>
        </div>
      </footer>
    </div>
  );
};

const ProductPreview: React.FC = () => (
  <div className="relative mx-auto w-full max-w-[760px]">
    <div className="absolute -inset-10 rounded-full bg-emerald-400/10 blur-3xl" />
    <div className="relative overflow-hidden rounded-[24px] border border-white/15 bg-[#F4F7F9] shadow-[0_30px_90px_rgba(0,0,0,0.34)]">
      <div className="flex h-11 items-center gap-2 border-b border-slate-300 bg-[#17394B] px-4">
        <span className="h-2.5 w-2.5 rounded-full bg-rose-400/90" /><span className="h-2.5 w-2.5 rounded-full bg-amber-300/90" /><span className="h-2.5 w-2.5 rounded-full bg-emerald-400/90" />
        <div className="ml-3 h-6 flex-1 rounded-md bg-white/8" />
      </div>
      <div className="grid min-h-[430px] grid-cols-[118px_1fr] sm:grid-cols-[150px_1fr]">
        <div className="bg-[#102A3A] p-3 text-slate-300">
          <div className="mb-5 flex items-center gap-2"><span className="grid h-7 w-7 place-items-center rounded-lg bg-[#0E8A50] text-[8px] font-black text-white">BP</span><span className="hidden text-[10px] font-bold text-white sm:inline">Bridata</span></div>
          {['Inicio', 'Proyectos', 'Control PMO', 'Materiales', 'Centro SAP', 'Costos'].map((label, index) => (
            <div key={label} className={`mb-1 rounded-md px-2 py-2 text-[9px] font-semibold ${index === 0 ? 'bg-emerald-400/12 text-emerald-200' : 'text-slate-400'}`}>{label}</div>
          ))}
        </div>
        <div className="p-4 sm:p-5">
          <div className="flex items-center justify-between"><div><p className="text-[8px] font-bold uppercase tracking-wider text-slate-400">Workspace ejecutivo</p><p className="mt-1 text-xs font-black text-[#102A3A] sm:text-sm">Operaciones e Infraestructura</p></div><span className="rounded-md bg-emerald-100 px-2 py-1 text-[8px] font-bold text-emerald-700">PMO</span></div>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              ['12', 'Proyectos'],
              ['68%', 'Avance'],
              ['3', 'Alertas'],
              ['2', 'Decisiones'],
            ].map(([value, label]) => (
              <div key={label} className="rounded-lg border border-slate-200 bg-white p-2.5 shadow-sm"><p className="text-sm font-black text-[#102A3A]">{value}</p><p className="mt-1 text-[7px] font-bold uppercase tracking-wide text-slate-400">{label}</p></div>
            ))}
          </div>
          <div className="mt-3 overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="grid grid-cols-[1.4fr_.7fr_.7fr] bg-[#E9EEF3] px-3 py-2 text-[7px] font-bold uppercase tracking-wide text-slate-500"><span>Proyecto</span><span>Estado</span><span>Avance</span></div>
            {[
              ['Datacenter Nexus Delta', 'Atención', 68],
              ['Fibra Óptica Norte', 'En control', 42],
              ['Core Multi-Tenant', 'En control', 74],
            ].map(([name, status, progress]) => (
              <div key={String(name)} className="grid grid-cols-[1.4fr_.7fr_.7fr] items-center border-t border-slate-100 px-3 py-3 text-[8px]"><span className="truncate font-bold text-slate-700">{String(name)}</span><span className={`w-fit rounded px-1.5 py-1 font-bold ${status === 'Atención' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>{String(status)}</span><span className="flex items-center gap-2"><span className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100"><span className="block h-full rounded-full bg-[#0E8A50]" style={{ width: `${Number(progress)}%` }} /></span><span className="font-bold text-slate-500">{Number(progress)}%</span></span></div>
            ))}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2"><div className="rounded-xl bg-[#102A3A] p-3 text-white"><Boxes className="h-4 w-4 text-emerald-300" /><p className="mt-3 text-[9px] font-bold">Materiales & inventario</p><p className="mt-1 text-[7px] text-slate-400">Disponibilidad conectada al proyecto</p></div><div className="rounded-xl bg-[#204A63] p-3 text-white"><Layers3 className="h-4 w-4 text-sky-200" /><p className="mt-3 text-[9px] font-bold">Portafolio PMO</p><p className="mt-1 text-[7px] text-slate-300">Riesgos, hitos y forecast</p></div></div>
        </div>
      </div>
    </div>
  </div>
);
