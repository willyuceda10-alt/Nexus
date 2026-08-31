import React from 'react';
import { LandingPage } from './components/public/LandingPage';
import { LoginPage } from './components/public/LoginPage';
import { hasBridataMicrosoftAccount } from './auth/msalBridata';
import { runtimeConfig } from './config/runtime';

const InternalWorkOs = React.lazy(() => import('./components/app/InternalWorkOs'));

function normalizePath(pathname: string): string {
  if (!pathname || pathname === '/') return '/';
  return pathname.endsWith('/') && pathname !== '/' ? pathname.slice(0, -1) : pathname;
}

function requiresEntraSession(path: string): boolean {
  if (!(path === '/app' || path.startsWith('/app/'))) return false;
  if (runtimeConfig.dataMode !== 'api' || runtimeConfig.authMode !== 'entra') return false;
  return !hasBridataMicrosoftAccount();
}

const AppFallback: React.FC = () => (
  <main className="grid min-h-dvh place-items-center bg-[#0D2533] px-5 text-white" role="status" aria-live="polite">
    <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-5 py-4 shadow-2xl">
      <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-emerald-400" />
      <div>
        <p className="text-xs font-black uppercase tracking-[0.12em] text-emerald-300">Bridata Project</p>
        <p className="mt-0.5 text-xs font-semibold text-slate-300">Preparando plataforma…</p>
      </div>
    </div>
  </main>
);

export function App() {
  const [path, setPath] = React.useState(() => normalizePath(window.location.pathname));

  React.useEffect(() => {
    const onPopState = () => setPath(normalizePath(window.location.pathname));
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const navigate = React.useCallback((nextPath: string) => {
    const normalized = normalizePath(nextPath);
    if (normalizePath(window.location.pathname) !== normalized) {
      window.history.pushState({}, '', normalized);
    }
    setPath(normalized);
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, []);

  if (path === '/login') return <LoginPage onNavigate={navigate} />;

  if (path === '/app' || path.startsWith('/app/')) {
    if (requiresEntraSession(path)) {
      // Keep the requested /app URL so MSAL can return the user to the protected
      // destination after the interactive sign-in completes. Crucially, the
      // internal Work OS never mounts before an Entra account is available.
      return <LoginPage onNavigate={navigate} />;
    }

    return (
      <React.Suspense fallback={<AppFallback />}>
        <InternalWorkOs />
      </React.Suspense>
    );
  }

  return <LandingPage onNavigate={navigate} />;
}

export default App;
