import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

type Props = {
  children: React.ReactNode;
  resetKey: string;
};

type State = {
  error: Error | null;
};

export class ModuleErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('Bridata module render failed', { error, componentStack: info.componentStack });
  }

  componentDidUpdate(previousProps: Props): void {
    if (this.state.error && previousProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  private retry = () => {
    this.setState({ error: null });
  };

  render(): React.ReactNode {
    if (!this.state.error) return this.props.children;

    return (
      <div className="mx-auto flex min-h-[420px] w-full max-w-3xl items-center justify-center p-6">
        <div className="w-full rounded-2xl border border-rose-200 bg-white p-6 shadow-sm" role="alert">
          <div className="flex items-start gap-3">
            <div className="grid h-10 w-10 flex-none place-items-center rounded-xl bg-rose-50 text-rose-700">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-base font-black text-slate-950">Este módulo no pudo mostrarse</h2>
              <p className="mt-1 text-sm leading-6 text-slate-600">
                La sesión principal continúa activa. Puedes reintentar el módulo sin recargar toda la aplicación.
              </p>
              <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
                {this.state.error.message || 'Error de renderizado no identificado.'}
              </p>
              <button
                onClick={this.retry}
                className="mt-4 inline-flex h-9 items-center gap-2 rounded-lg bg-slate-900 px-3 text-xs font-bold text-white hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
              >
                <RefreshCw className="h-4 w-4" /> Reintentar módulo
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }
}
