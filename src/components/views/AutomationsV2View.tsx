import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertCircle,
  BellRing,
  CheckCircle2,
  Clock3,
  GitBranch,
  Pause,
  Play,
  Plus,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  XCircle,
  Zap,
} from 'lucide-react';
import { bridataApi, BridataApiError } from '../../api/client';
import type {
  ApiAutomationActionV1,
  ApiAutomationApprovalV1,
  ApiAutomationConditionV1,
  ApiAutomationDefinitionV1,
  ApiAutomationRunV1,
  ApiAutomationStatusV1,
} from '../../api/automationV1Contracts';
import type { ApiNotificationPriorityV2 } from '../../api/automationActionsV2Contracts';
import { useApiBootstrap } from '../../context/ApiBootstrapContext';
import { useNexus } from '../../context/NexusContext';

const EVENT_PRESETS = [
  'bridata.object.created',
  'bridata.work-item.schedule.updated',
  'bridata.project.schedule-profile.updated',
  'bridata.authorization.policy.changed',
  'bridata.automation.approval.resolved',
  'bridata.automation.version.published',
];

const CONDITION_OPERATORS = [
  { value: 'EQ', label: 'es igual a' },
  { value: 'NEQ', label: 'es distinto de' },
  { value: 'GT', label: 'es mayor que' },
  { value: 'GTE', label: 'es mayor o igual que' },
  { value: 'LT', label: 'es menor que' },
  { value: 'LTE', label: 'es menor o igual que' },
  { value: 'CONTAINS', label: 'contiene' },
  { value: 'EXISTS', label: 'existe' },
] as const;

type ActionKind = 'CREATE_TASK' | 'REQUEST_APPROVAL' | 'INTERNAL_NOTIFICATION' | 'EMIT_EVENT';

type FormState = {
  name: string;
  description: string;
  projectId: string;
  triggerEventType: string;
  conditionEnabled: boolean;
  conditionPath: string;
  conditionOperator: (typeof CONDITION_OPERATORS)[number]['value'];
  conditionValue: string;
  actionType: ActionKind;
  actionTitle: string;
  actionBody: string;
  actionEventType: string;
  targetUserId: string;
  priority: ApiNotificationPriorityV2;
  requiresAction: boolean;
};

function emptyForm(currentUserId: string): FormState {
  return {
    name: '',
    description: '',
    projectId: '',
    triggerEventType: 'bridata.object.created',
    conditionEnabled: false,
    conditionPath: 'payload.status',
    conditionOperator: 'EQ',
    conditionValue: '',
    actionType: 'CREATE_TASK',
    actionTitle: '',
    actionBody: '',
    actionEventType: 'bridata.automation.custom-event',
    targetUserId: currentUserId,
    priority: 'MEDIUM',
    requiresAction: false,
  };
}

function parseLiteral(value: string): string | number | boolean | null {
  const trimmed = value.trim();
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (trimmed === 'null') return null;
  if (trimmed !== '' && Number.isFinite(Number(trimmed))) return Number(trimmed);
  return value;
}

function errorText(error: unknown): string {
  if (error instanceof BridataApiError) {
    return error.correlationId ? `${error.message} · Ref: ${error.correlationId}` : error.message;
  }
  return error instanceof Error ? error.message : 'No se pudo completar la operación.';
}

function statusClass(status: ApiAutomationStatusV1): string {
  if (status === 'ACTIVE') return 'bg-emerald-50 text-emerald-700 ring-emerald-200';
  if (status === 'PAUSED') return 'bg-amber-50 text-amber-700 ring-amber-200';
  if (status === 'ARCHIVED') return 'bg-slate-100 text-slate-500 ring-slate-200';
  return 'bg-blue-50 text-blue-700 ring-blue-200';
}

function runIcon(status: ApiAutomationRunV1['status']) {
  if (status === 'SUCCEEDED') return <CheckCircle2 className="h-4 w-4 text-emerald-600" />;
  if (status === 'FAILED') return <XCircle className="h-4 w-4 text-rose-600" />;
  if (status === 'WAITING_APPROVAL') return <Clock3 className="h-4 w-4 text-amber-600" />;
  if (status === 'RUNNING') return <RefreshCw className="h-4 w-4 animate-spin text-blue-600" />;
  return <Activity className="h-4 w-4 text-slate-400" />;
}

export const AutomationsV2View: React.FC = () => {
  const apiBootstrap = useApiBootstrap();
  const { currentWorkspace, objects, currentUser } = useNexus();
  const apiReady = apiBootstrap.dataMode === 'api' && apiBootstrap.status === 'ready';
  const projects = useMemo(() => objects.filter((item) => item.type === 'PROJECT'), [objects]);

  const [scopeProjectId, setScopeProjectId] = useState('');
  const [items, setItems] = useState<ApiAutomationDefinitionV1[]>([]);
  const [approvals, setApprovals] = useState<ApiAutomationApprovalV1[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [runs, setRuns] = useState<ApiAutomationRunV1[]>([]);
  const [form, setForm] = useState<FormState>(() => emptyForm(currentUser.id));
  const [showComposer, setShowComposer] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setForm((previous) => previous.targetUserId ? previous : { ...previous, targetUserId: currentUser.id });
  }, [currentUser.id]);

  const load = useCallback(async () => {
    if (!apiReady || !currentWorkspace) return;
    setLoading(true);
    setError(null);
    try {
      const [automationResult, approvalResult] = await Promise.all([
        bridataApi.listAutomationsV1(scopeProjectId
          ? { workspaceId: currentWorkspace.id, projectId: scopeProjectId }
          : { workspaceId: currentWorkspace.id }),
        bridataApi.automationApprovalsV1('PENDING'),
      ]);
      setItems(automationResult.items);
      setApprovals(approvalResult.items);
      if (selectedId && !automationResult.items.some((item) => item.id === selectedId)) {
        setSelectedId(null);
        setRuns([]);
      }
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setLoading(false);
    }
  }, [apiReady, currentWorkspace, scopeProjectId, selectedId]);

  useEffect(() => { void load(); }, [load]);

  const loadRuns = useCallback(async (id: string) => {
    setSelectedId(id);
    try {
      const result = await bridataApi.automationRunsV1(id, 30);
      setRuns(result.items);
    } catch (cause) {
      setError(errorText(cause));
    }
  }, []);

  const conditionV1 = (): ApiAutomationConditionV1 | null => {
    if (!form.conditionEnabled) return null;
    return {
      kind: 'PREDICATE',
      left: { kind: 'EVENT_PATH', path: form.conditionPath.trim() },
      operator: form.conditionOperator,
      ...(form.conditionOperator === 'EXISTS'
        ? {}
        : { right: { kind: 'LITERAL' as const, value: parseLiteral(form.conditionValue) } }),
    };
  };

  const conditionV2 = () => {
    if (!form.conditionEnabled) return undefined;
    return {
      path: form.conditionPath.trim(),
      operator: form.conditionOperator,
      ...(form.conditionOperator === 'EXISTS' ? {} : { value: parseLiteral(form.conditionValue) }),
    };
  };

  const actionV1 = (): ApiAutomationActionV1 => {
    if (form.actionType === 'CREATE_TASK') {
      return {
        type: 'CREATE_TASK',
        title: { kind: 'LITERAL', value: form.actionTitle.trim() },
        ...(form.projectId ? { projectId: { kind: 'LITERAL' as const, value: form.projectId } } : {}),
        priority: 'HIGH',
      };
    }
    if (form.actionType === 'REQUEST_APPROVAL') {
      return {
        type: 'REQUEST_APPROVAL',
        title: { kind: 'LITERAL', value: form.actionTitle.trim() },
        ...(form.targetUserId ? { approverUserId: { kind: 'LITERAL' as const, value: form.targetUserId } } : {}),
      };
    }
    return {
      type: 'EMIT_EVENT',
      eventType: form.actionEventType.trim(),
      aggregateId: { kind: 'EVENT_PATH', path: 'aggregateId' },
      payload: {
        sourceEventId: { kind: 'EVENT_PATH', path: 'eventId' },
        automationLabel: { kind: 'LITERAL', value: form.actionTitle.trim() || form.name.trim() },
      },
    };
  };

  const createAutomation = async () => {
    if (!currentWorkspace || !form.name.trim()) return;
    if (!form.triggerEventType.trim()) {
      setError('Define el evento disparador.');
      return;
    }
    if (!form.actionTitle.trim()) {
      setError('Define el título de la acción.');
      return;
    }
    if ((form.actionType === 'REQUEST_APPROVAL' || form.actionType === 'INTERNAL_NOTIFICATION') && !form.targetUserId.trim()) {
      setError('Define el usuario destinatario.');
      return;
    }

    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const definition = await bridataApi.createAutomationV1({
        workspaceId: currentWorkspace.id,
        projectId: form.projectId || null,
        name: form.name.trim(),
        description: form.description.trim() || null,
        maxRunsPerHour: 100,
        maxDepth: 5,
      });

      if (form.actionType === 'INTERNAL_NOTIFICATION') {
        await bridataApi.publishInternalNotificationAutomationV2(definition.id, {
          triggerEventType: form.triggerEventType.trim(),
          condition: conditionV2(),
          targetUserId: form.targetUserId.trim(),
          notificationTitle: form.actionTitle.trim(),
          notificationBody: form.actionBody.trim() || null,
          priority: form.priority,
          requiresAction: form.requiresAction,
          activate: true,
          changeNote: 'Versión inicial · notificación interna segura V2',
        });
      } else {
        await bridataApi.publishAutomationVersionV1(definition.id, {
          triggerEventType: form.triggerEventType.trim(),
          condition: conditionV1(),
          actions: [actionV1()],
          changeNote: 'Versión inicial creada desde Automation Center',
          activate: true,
        });
      }

      setMessage(`Automatización “${form.name.trim()}” publicada y activa.`);
      setForm(emptyForm(currentUser.id));
      setShowComposer(false);
      await load();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setSaving(false);
    }
  };

  const toggleStatus = async (item: ApiAutomationDefinitionV1) => {
    setError(null);
    try {
      const next: ApiAutomationStatusV1 = item.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';
      await bridataApi.setAutomationStatusV1(item.id, next);
      await load();
    } catch (cause) {
      setError(errorText(cause));
    }
  };

  const decideApproval = async (approval: ApiAutomationApprovalV1, decision: 'APPROVED' | 'REJECTED') => {
    setError(null);
    try {
      await bridataApi.decideAutomationApprovalV1(approval.id, decision);
      setMessage(decision === 'APPROVED' ? 'Aprobación confirmada.' : 'Solicitud rechazada.');
      await load();
      if (selectedId) await loadRuns(selectedId);
    } catch (cause) {
      setError(errorText(cause));
    }
  };

  if (!apiReady) {
    return (
      <div className="p-8">
        <div className="mx-auto max-w-3xl rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
          <Zap className="h-9 w-9 text-green-700" />
          <h1 className="mt-4 text-2xl font-extrabold text-slate-950">Automation Center</h1>
          <p className="mt-2 text-sm leading-6 text-slate-500">El motor de automatización real se habilita en modo API.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1500px] space-y-5 p-5 lg:p-7">
      <header className="rounded-3xl border border-slate-200 bg-white px-6 py-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="grid h-12 w-12 place-items-center rounded-2xl bg-green-50 ring-1 ring-green-100"><Zap className="h-6 w-6 text-green-700" /></div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-extrabold tracking-tight text-slate-950">Automation Center</h1>
                <span className="rounded-full bg-green-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.13em] text-green-700 ring-1 ring-green-200">Actions V2</span>
              </div>
              <p className="mt-1 max-w-2xl text-sm text-slate-500">WHEN / IF / THEN con versionado, aprobaciones, tareas, eventos y notificaciones hacia Mi trabajo.</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => void load()} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Actualizar
            </button>
            <button type="button" onClick={() => setShowComposer((value) => !value)} className="inline-flex items-center gap-2 rounded-xl bg-green-700 px-4 py-2.5 text-xs font-bold text-white hover:bg-green-800">
              <Plus className="h-4 w-4" /> Nueva automatización
            </button>
          </div>
        </div>
      </header>

      {(error || message) && (
        <div className={`flex items-start gap-3 rounded-2xl border px-4 py-3 text-sm ${error ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>
          {error ? <AlertCircle className="mt-0.5 h-4 w-4 flex-none" /> : <CheckCircle2 className="mt-0.5 h-4 w-4 flex-none" />}
          <span>{error ?? message}</span>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-4">
        {[
          ['Activas', items.filter((item) => item.status === 'ACTIVE').length, Play],
          ['Pausadas', items.filter((item) => item.status === 'PAUSED').length, Pause],
          ['Aprobaciones', approvals.length, ShieldCheck],
          ['Scope', scopeProjectId ? 'Proyecto' : 'Workspace', GitBranch],
        ].map(([label, value, Icon]) => {
          const MetricIcon = Icon as React.ComponentType<{ className?: string }>;
          return (
            <div key={String(label)} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between"><span className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">{String(label)}</span><MetricIcon className="h-4 w-4 text-green-700" /></div>
              <div className="mt-2 text-2xl font-extrabold text-slate-950">{String(value)}</div>
            </div>
          );
        })}
      </div>

      {showComposer && (
        <section className="rounded-3xl border border-green-200 bg-white p-5 shadow-sm ring-1 ring-green-50">
          <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-green-50"><Sparkles className="h-4 w-4 text-green-700" /></div>
            <div><h2 className="text-sm font-extrabold text-slate-950">Constructor de regla</h2><p className="text-xs text-slate-500">Las acciones de producto se compilan sobre primitivas seguras del motor.</p></div>
          </div>

          <div className="mt-5 grid gap-4 lg:grid-cols-3">
            <div className="space-y-3 rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-100">
              <p className="text-[10px] font-black uppercase tracking-[0.14em] text-green-700">1 · WHEN</p>
              <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Nombre de la automatización" className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-green-500" />
              <textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="Descripción" rows={2} className="w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-green-500" />
              <select value={form.projectId} onChange={(event) => setForm({ ...form, projectId: event.target.value })} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm">
                <option value="">Todo el workspace</option>
                {projects.map((project) => <option key={project.id} value={project.id}>{project.title}</option>)}
              </select>
              <input list="automation-v2-event-presets" value={form.triggerEventType} onChange={(event) => setForm({ ...form, triggerEventType: event.target.value })} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 font-mono text-xs" />
              <datalist id="automation-v2-event-presets">{EVENT_PRESETS.map((item) => <option key={item} value={item} />)}</datalist>
            </div>

            <div className="space-y-3 rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-100">
              <div className="flex items-center justify-between"><p className="text-[10px] font-black uppercase tracking-[0.14em] text-green-700">2 · IF</p><label className="flex items-center gap-2 text-[11px] font-semibold text-slate-500"><input type="checkbox" checked={form.conditionEnabled} onChange={(event) => setForm({ ...form, conditionEnabled: event.target.checked })} /> Usar condición</label></div>
              <input disabled={!form.conditionEnabled} value={form.conditionPath} onChange={(event) => setForm({ ...form, conditionPath: event.target.value })} placeholder="payload.status" className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 font-mono text-xs disabled:opacity-50" />
              <select disabled={!form.conditionEnabled} value={form.conditionOperator} onChange={(event) => setForm({ ...form, conditionOperator: event.target.value as FormState['conditionOperator'] })} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm disabled:opacity-50">
                {CONDITION_OPERATORS.map((operator) => <option key={operator.value} value={operator.value}>{operator.label}</option>)}
              </select>
              {form.conditionOperator !== 'EXISTS' && <input disabled={!form.conditionEnabled} value={form.conditionValue} onChange={(event) => setForm({ ...form, conditionValue: event.target.value })} placeholder="Valor esperado" className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm disabled:opacity-50" />}
              <div className="rounded-xl border border-dashed border-slate-200 bg-white px-3 py-3 text-[11px] leading-5 text-slate-500">Usa rutas como <code>payload.status</code>, <code>payload.projectId</code> o <code>aggregateId</code>.</div>
            </div>

            <div className="space-y-3 rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-100">
              <p className="text-[10px] font-black uppercase tracking-[0.14em] text-green-700">3 · THEN</p>
              <select value={form.actionType} onChange={(event) => setForm({ ...form, actionType: event.target.value as ActionKind })} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm">
                <option value="CREATE_TASK">Crear tarea</option>
                <option value="REQUEST_APPROVAL">Solicitar aprobación</option>
                <option value="INTERNAL_NOTIFICATION">Enviar notificación interna</option>
                <option value="EMIT_EVENT">Emitir evento</option>
              </select>
              <input value={form.actionTitle} onChange={(event) => setForm({ ...form, actionTitle: event.target.value })} placeholder={form.actionType === 'INTERNAL_NOTIFICATION' ? 'Título de la notificación' : 'Título de la acción'} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm" />
              {form.actionType === 'INTERNAL_NOTIFICATION' && (
                <>
                  <textarea value={form.actionBody} onChange={(event) => setForm({ ...form, actionBody: event.target.value })} placeholder="Mensaje" rows={2} className="w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm" />
                  <select value={form.priority} onChange={(event) => setForm({ ...form, priority: event.target.value as ApiNotificationPriorityV2 })} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm">
                    <option value="LOW">Prioridad baja</option><option value="MEDIUM">Prioridad media</option><option value="HIGH">Prioridad alta</option><option value="CRITICAL">Prioridad crítica</option>
                  </select>
                  <label className="flex items-center gap-2 text-xs font-semibold text-slate-600"><input type="checkbox" checked={form.requiresAction} onChange={(event) => setForm({ ...form, requiresAction: event.target.checked })} /> Requiere acción</label>
                </>
              )}
              {(form.actionType === 'REQUEST_APPROVAL' || form.actionType === 'INTERNAL_NOTIFICATION') && (
                <input value={form.targetUserId} onChange={(event) => setForm({ ...form, targetUserId: event.target.value })} placeholder={`Usuario · actual ${currentUser.name}`} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 font-mono text-xs" />
              )}
              {form.actionType === 'EMIT_EVENT' && <input value={form.actionEventType} onChange={(event) => setForm({ ...form, actionEventType: event.target.value })} placeholder="bridata.mi.evento" className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 font-mono text-xs" />}
              <button type="button" disabled={saving} onClick={() => void createAutomation()} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-green-700 px-4 py-3 text-xs font-bold text-white hover:bg-green-800 disabled:opacity-50">
                {saving ? <RefreshCw className="h-4 w-4 animate-spin" /> : form.actionType === 'INTERNAL_NOTIFICATION' ? <BellRing className="h-4 w-4" /> : <Play className="h-4 w-4" />} Publicar y activar
              </button>
            </div>
          </div>
        </section>
      )}

      <div className="grid gap-5 xl:grid-cols-[1.25fr_0.75fr]">
        <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
            <div><h2 className="text-sm font-extrabold text-slate-950">Reglas publicadas</h2><p className="mt-0.5 text-xs text-slate-500">Selecciona una regla para ver sus runs.</p></div>
            <select value={scopeProjectId} onChange={(event) => setScopeProjectId(event.target.value)} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600">
              <option value="">Workspace completo</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.title}</option>)}
            </select>
          </div>
          <div className="divide-y divide-slate-100">
            {items.map((item) => (
              <div key={item.id} className={`flex items-center gap-3 px-4 py-3 ${selectedId === item.id ? 'bg-green-50/50' : 'hover:bg-slate-50'}`}>
                <button type="button" onClick={() => void loadRuns(item.id)} className="flex min-w-0 flex-1 items-center gap-4 text-left">
                  <div className="grid h-10 w-10 flex-none place-items-center rounded-xl bg-slate-50 ring-1 ring-slate-100"><Zap className="h-4 w-4 text-green-700" /></div>
                  <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="truncate text-sm font-bold text-slate-900">{item.name}</span><span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ${statusClass(item.status)}`}>{item.status}</span><span className="text-[10px] font-semibold text-slate-400">v{item.activeVersion ?? '—'}</span></div><p className="mt-1 truncate text-xs text-slate-500">{item.description || 'Sin descripción'} · {item.maxRunsPerHour}/h · profundidad {item.maxDepth}</p></div>
                </button>
                <button type="button" onClick={() => void toggleStatus(item)} disabled={item.status === 'DRAFT' || item.status === 'ARCHIVED'} className="rounded-xl border border-slate-200 bg-white p-2 text-slate-500 hover:bg-slate-50 disabled:opacity-30" title={item.status === 'ACTIVE' ? 'Pausar' : 'Activar'}>
                  {item.status === 'ACTIVE' ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                </button>
              </div>
            ))}
            {!loading && items.length === 0 && <div className="px-6 py-12 text-center text-sm font-semibold text-slate-500">No hay automatizaciones en este scope.</div>}
          </div>
        </section>

        <div className="space-y-5">
          <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-5 py-4"><h2 className="text-sm font-extrabold text-slate-950">Aprobaciones pendientes</h2><p className="mt-0.5 text-xs text-slate-500">Pausan el run hasta una decisión humana.</p></div>
            <div className="divide-y divide-slate-100">
              {approvals.slice(0, 6).map((approval) => (
                <div key={approval.id} className="px-5 py-4"><p className="text-sm font-semibold text-slate-800">{approval.title}</p>{approval.description && <p className="mt-1 text-xs text-slate-500">{approval.description}</p>}<div className="mt-3 flex gap-2"><button type="button" onClick={() => void decideApproval(approval, 'APPROVED')} className="rounded-lg bg-green-700 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-green-800">Aprobar</button><button type="button" onClick={() => void decideApproval(approval, 'REJECTED')} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-bold text-slate-600 hover:bg-slate-50">Rechazar</button></div></div>
              ))}
              {approvals.length === 0 && <div className="px-5 py-8 text-center text-xs text-slate-400">Sin aprobaciones pendientes.</div>}
            </div>
          </section>

          <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-5 py-4"><h2 className="text-sm font-extrabold text-slate-950">Historial de ejecución</h2><p className="mt-0.5 text-xs text-slate-500">Últimos runs de la regla seleccionada.</p></div>
            <div className="divide-y divide-slate-100">
              {runs.slice(0, 10).map((run) => <div key={run.id} className="flex gap-3 px-5 py-3.5">{runIcon(run.status)}<div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-3"><p className="truncate text-xs font-bold text-slate-700">{run.status}</p><span className="text-[10px] text-slate-400">intento {run.attempts}</span></div><p className="mt-1 truncate font-mono text-[10px] text-slate-400">{run.sourceEventType}</p>{run.lastError && <p className="mt-1 line-clamp-2 text-[10px] text-rose-600">{run.lastError}</p>}</div></div>)}
              {selectedId && runs.length === 0 && <div className="px-5 py-8 text-center text-xs text-slate-400">Esta regla todavía no tiene ejecuciones.</div>}
              {!selectedId && <div className="px-5 py-8 text-center text-xs text-slate-400">Selecciona una automatización.</div>}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};
