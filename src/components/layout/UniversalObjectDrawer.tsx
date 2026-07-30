import React, { useState } from 'react';
import {
  X,
  Calendar,
  User,
  ShieldAlert,
  FileText,
  MessageSquare,
  History,
  Link2,
  CheckCircle2,
  AlertTriangle,
  Clock,
  ArrowRight,
  Send,
  Plus,
  Trash2,
  DollarSign,
  FileCheck2,
  Lock,
  GitBranch,
  Layers,
  Sparkles,
} from 'lucide-react';
import { useNexus } from '../../context/NexusContext';
import { ObjectStatus, Priority, ObjectType } from '../../types/nexus';

export const UniversalObjectDrawer: React.FC = () => {
  const {
    selectedObject,
    isDrawerOpen,
    closeObjectDrawer,
    updateNexusObject,
    deleteNexusObject,
    addRelation,
    addComment,
    comments,
    activityLogs,
    getLinkedObjects,
    objects,
    currentUser,
    decideApproval,
    approvals,
  } = useNexus();

  const [activeDrawerTab, setActiveDrawerTab] = useState<'overview' | 'relations' | 'comments' | 'history'>('overview');
  const [newCommentText, setNewCommentText] = useState('');
  const [isLinkingOpen, setIsLinkingOpen] = useState(false);
  const [targetLinkObjectId, setTargetLinkObjectId] = useState('');
  const [linkRelationType, setLinkRelationType] = useState<'BLOCKS' | 'DEPENDS_ON' | 'DERIVED_FROM' | 'RELATES_TO' | 'MITIGATES' | 'REQUIRES_APPROVAL'>('RELATES_TO');

  if (!isDrawerOpen || !selectedObject) return null;

  const objComments = comments.filter((c) => c.objectId === selectedObject.id);
  const objLogs = activityLogs.filter((l) => l.objectId === selectedObject.id);
  const linked = getLinkedObjects(selectedObject.id);
  const pendingApproval = approvals.find((a) => a.objectId === selectedObject.id && a.status === 'PENDING');

  const getTypeBadgeColor = (type: ObjectType) => {
    switch (type) {
      case 'PROJECT':
        return 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300';
      case 'RISK':
        return 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300';
      case 'MEETING':
        return 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300';
      case 'DECISION':
        return 'bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300';
      case 'CHANGE_REQUEST':
        return 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300';
      case 'DOCUMENT':
        return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300';
      default:
        return 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-300';
    }
  };

  const handleCommentSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCommentText.trim()) return;
    addComment(selectedObject.id, newCommentText);
    setNewCommentText('');
  };

  const handleAddLink = () => {
    if (!targetLinkObjectId) return;
    addRelation(selectedObject.id, targetLinkObjectId, linkRelationType);
    setIsLinkingOpen(false);
    setTargetLinkObjectId('');
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/40 backdrop-blur-xs transition-opacity animate-fade-in">
      {/* Click outside to close */}
      <div className="flex-1" onClick={closeObjectDrawer} />

      {/* Slide-Over Drawer Container */}
      <div className="relative flex h-full w-full max-w-2xl flex-col border-l border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900">
        {/* Drawer Header */}
        <div className="flex items-center justify-between border-b border-slate-200 p-4 dark:border-slate-800">
          <div className="flex items-center space-x-2">
            <span className={`rounded-md px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider ${getTypeBadgeColor(selectedObject.type)}`}>
              {selectedObject.type}
            </span>
            <span className="text-xs font-mono font-bold text-slate-400">#{selectedObject.id}</span>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={() => {
                if (confirm('¿Eliminar este objeto permanentemente?')) {
                  deleteNexusObject(selectedObject.id);
                }
              }}
              className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/50"
              title="Eliminar objeto"
            >
              <Trash2 className="h-4 w-4" />
            </button>
            <button
              onClick={closeObjectDrawer}
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Title & Editable Status Bar */}
        <div className="p-4 border-b border-slate-100 dark:border-slate-800/60">
          <input
            type="text"
            value={selectedObject.title}
            onChange={(e) => updateNexusObject(selectedObject.id, { title: e.target.value })}
            className="w-full text-lg font-bold text-slate-900 bg-transparent border-none outline-none focus:ring-1 focus:ring-indigo-500 rounded px-1 dark:text-slate-100"
          />

          <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
            {/* Status Selector */}
            <div className="flex items-center space-x-1.5">
              <span className="text-slate-400 font-medium">Estado:</span>
              <select
                value={selectedObject.status}
                onChange={(e) => updateNexusObject(selectedObject.id, { status: e.target.value as ObjectStatus })}
                className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 font-semibold text-slate-800 outline-none focus:border-indigo-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
              >
                <option value="DRAFT">Borrador</option>
                <option value="PLANNING">Planificación</option>
                <option value="IN_PROGRESS">En Progreso</option>
                <option value="IN_REVIEW">En Revisión</option>
                <option value="BLOCKED">Bloqueado</option>
                <option value="COMPLETED">Completado</option>
                <option value="IDENTIFIED">Identificado (Riesgo)</option>
                <option value="CRITICAL">Crítico</option>
                <option value="PENDING_APPROVAL">Pendiente Aprobación</option>
                <option value="APPROVED">Aprobado</option>
                <option value="REJECTED">Rechazado</option>
              </select>
            </div>

            {/* Priority Selector */}
            <div className="flex items-center space-x-1.5">
              <span className="text-slate-400 font-medium">Prioridad:</span>
              <select
                value={selectedObject.priority}
                onChange={(e) => updateNexusObject(selectedObject.id, { priority: e.target.value as Priority })}
                className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 font-semibold text-slate-800 outline-none focus:border-indigo-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
              >
                <option value="LOW">Baja</option>
                <option value="MEDIUM">Media</option>
                <option value="HIGH">Alta</option>
                <option value="CRITICAL">Crítica</option>
              </select>
            </div>

            {/* Owner Avatar */}
            <div className="flex items-center space-x-1.5 border-l border-slate-200 pl-3 dark:border-slate-800">
              <span className="text-slate-400 font-medium">Responsable:</span>
              <div className="flex items-center space-x-1.5 bg-slate-100 rounded-full px-2 py-0.5 dark:bg-slate-800">
                <img src={selectedObject.ownerAvatar} alt="" className="h-4 w-4 rounded-full" />
                <span className="text-xs font-medium text-slate-700 dark:text-slate-300">{selectedObject.ownerName}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Approval Banner if pending */}
        {pendingApproval && (
          <div className="bg-amber-50 border-b border-amber-200 p-3 flex items-center justify-between dark:bg-amber-950/40 dark:border-amber-900/60">
            <div className="flex items-center space-x-2 text-xs text-amber-900 dark:text-amber-200">
              <ShieldAlert className="h-4 w-4 text-amber-600" />
              <span><strong>Aprobación requerida:</strong> {pendingApproval.comment || 'Firma ejecutiva pendiente'}</span>
            </div>
            <div className="flex items-center space-x-2">
              <button
                onClick={() => decideApproval(pendingApproval.id, 'APPROVED', 'Aprobado desde Peek View')}
                className="rounded bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white shadow-xs hover:bg-emerald-700"
              >
                Aprobar
              </button>
              <button
                onClick={() => decideApproval(pendingApproval.id, 'REJECTED', 'Rechazado desde Peek View')}
                className="rounded bg-rose-600 px-2.5 py-1 text-xs font-semibold text-white shadow-xs hover:bg-rose-700"
              >
                Rechazar
              </button>
            </div>
          </div>
        )}

        {/* Navigation Tabs */}
        <div className="flex border-b border-slate-200 px-4 dark:border-slate-800">
          {[
            { id: 'overview', label: 'Resumen & Propiedades', icon: FileText },
            { id: 'relations', label: `Relaciones (${linked.length})`, icon: GitBranch },
            { id: 'comments', label: `Comentarios (${objComments.length})`, icon: MessageSquare },
            { id: 'history', label: `Auditoría (${objLogs.length})`, icon: History },
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = activeDrawerTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveDrawerTab(tab.id as any)}
                className={`flex items-center space-x-1.5 border-b-2 px-3 py-2.5 text-xs font-semibold transition ${
                  isActive
                    ? 'border-indigo-600 text-indigo-600 dark:border-indigo-400 dark:text-indigo-400'
                    : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Tab Content Area */}
        <div className="flex-1 overflow-y-auto p-4">
          {/* TAB 1: OVERVIEW */}
          {activeDrawerTab === 'overview' && (
            <div className="space-y-5">
              {/* Description */}
              <div>
                <label className="text-xs font-bold uppercase tracking-wider text-slate-400">Descripción del Objeto</label>
                <textarea
                  rows={3}
                  value={selectedObject.description}
                  onChange={(e) => updateNexusObject(selectedObject.id, { description: e.target.value })}
                  placeholder="Escribe la descripción o notas..."
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-xs text-slate-800 outline-none focus:border-indigo-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                />
              </div>

              {/* Specific Extensions according to Object Type */}
              {selectedObject.type === 'RISK' && (
                <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-3.5 dark:border-amber-900/50 dark:bg-amber-950/20">
                  <div className="flex items-center justify-between text-xs font-bold text-amber-900 dark:text-amber-200">
                    <span className="flex items-center space-x-1.5">
                      <AlertTriangle className="h-4 w-4 text-amber-600" />
                      <span>Matriz de Riesgo Calculada</span>
                    </span>
                    <span className="rounded bg-amber-200 px-2 py-0.5 text-[11px] font-extrabold text-amber-900 dark:bg-amber-900 dark:text-amber-100">
                      Score: {(selectedObject.probability || 1) * (selectedObject.impact || 1)} / 25
                    </span>
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <label className="text-[11px] font-semibold text-slate-500">Probabilidad (1-5)</label>
                      <input
                        type="number"
                        min={1}
                        max={5}
                        value={selectedObject.probability || 1}
                        onChange={(e) => {
                          const prob = parseInt(e.target.value) || 1;
                          const imp = selectedObject.impact || 1;
                          updateNexusObject(selectedObject.id, { probability: prob, riskScore: prob * imp });
                        }}
                        className="mt-1 w-full rounded border border-slate-200 bg-white p-1.5 font-bold text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] font-semibold text-slate-500">Impacto (1-5)</label>
                      <input
                        type="number"
                        min={1}
                        max={5}
                        value={selectedObject.impact || 1}
                        onChange={(e) => {
                          const imp = parseInt(e.target.value) || 1;
                          const prob = selectedObject.probability || 1;
                          updateNexusObject(selectedObject.id, { impact: imp, riskScore: prob * imp });
                        }}
                        className="mt-1 w-full rounded border border-slate-200 bg-white p-1.5 font-bold text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                      />
                    </div>
                  </div>

                  <div className="mt-3">
                    <label className="text-[11px] font-semibold text-slate-500">Plan de Mitigación</label>
                    <textarea
                      rows={2}
                      value={selectedObject.mitigationPlan || ''}
                      onChange={(e) => updateNexusObject(selectedObject.id, { mitigationPlan: e.target.value })}
                      placeholder="Estrategia para mitigar el riesgo..."
                      className="mt-1 w-full rounded border border-slate-200 bg-white p-2 text-xs text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                    />
                  </div>
                </div>
              )}

              {selectedObject.type === 'CHANGE_REQUEST' && (
                <div className="rounded-xl border border-rose-200 bg-rose-50/50 p-3.5 dark:border-rose-900/50 dark:bg-rose-950/20">
                  <div className="text-xs font-bold text-rose-900 dark:text-rose-200">
                    Impacto Estimado de la Solicitud de Cambio
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-3 text-xs">
                    <div className="rounded-lg bg-white p-2.5 border border-rose-100 dark:bg-slate-800 dark:border-slate-700">
                      <div className="text-[10px] uppercase font-bold text-slate-400">Impacto en Costo</div>
                      <div className="text-base font-extrabold text-rose-600">
                        +${(selectedObject.costImpact || 0).toLocaleString()} USD
                      </div>
                    </div>
                    <div className="rounded-lg bg-white p-2.5 border border-rose-100 dark:bg-slate-800 dark:border-slate-700">
                      <div className="text-[10px] uppercase font-bold text-slate-400">Impacto en Tiempo</div>
                      <div className="text-base font-extrabold text-amber-600">
                        +{selectedObject.timeImpactDays || 0} Días calendario
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Progress Slider */}
              <div>
                <div className="flex items-center justify-between text-xs font-medium text-slate-500">
                  <span>Porcentaje de Avance</span>
                  <span className="font-bold text-indigo-600">{selectedObject.progress}%</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={selectedObject.progress}
                  onChange={(e) => updateNexusObject(selectedObject.id, { progress: parseInt(e.target.value) })}
                  className="mt-1.5 h-2 w-full cursor-pointer rounded-lg bg-slate-200 accent-indigo-600 dark:bg-slate-700"
                />
              </div>

              {/* Date Metadata */}
              <div className="grid grid-cols-2 gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs dark:border-slate-800 dark:bg-slate-800/40">
                <div>
                  <span className="text-slate-400 font-medium">Fecha Inicio:</span>
                  <input
                    type="date"
                    value={selectedObject.startDate || ''}
                    onChange={(e) => updateNexusObject(selectedObject.id, { startDate: e.target.value })}
                    className="mt-1 w-full bg-transparent font-bold text-slate-800 outline-none dark:text-slate-200"
                  />
                </div>
                <div>
                  <span className="text-slate-400 font-medium">Fecha Objetivo / Fin:</span>
                  <input
                    type="date"
                    value={selectedObject.endDate || ''}
                    onChange={(e) => updateNexusObject(selectedObject.id, { endDate: e.target.value })}
                    className="mt-1 w-full bg-transparent font-bold text-slate-800 outline-none dark:text-slate-200"
                  />
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: RELATIONS GRAPH */}
          {activeDrawerTab === 'relations' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
                  Grafo de Objetos Vinculados
                </span>
                <button
                  onClick={() => setIsLinkingOpen(!isLinkingOpen)}
                  className="flex items-center space-x-1 rounded bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-600 hover:bg-indigo-100 dark:bg-indigo-950 dark:text-indigo-300"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>Vincular Objeto</span>
                </button>
              </div>

              {/* Link Creator inline box */}
              {isLinkingOpen && (
                <div className="rounded-xl border border-indigo-200 bg-indigo-50/50 p-3 text-xs dark:border-indigo-900/50 dark:bg-indigo-950/30">
                  <div className="font-semibold text-indigo-900 dark:text-indigo-200">Crear Nueva Relación</div>
                  <div className="mt-2 space-y-2">
                    <select
                      value={linkRelationType}
                      onChange={(e) => setLinkRelationType(e.target.value as any)}
                      className="w-full rounded border border-slate-200 p-1.5 font-medium text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                    >
                      <option value="RELATES_TO">RELATES_TO (Se Relaciona con)</option>
                      <option value="BLOCKS">BLOCKS (Bloquea a)</option>
                      <option value="DEPENDS_ON">DEPENDS_ON (Depende de)</option>
                      <option value="MITIGATES">MITIGATES (Mitiga a)</option>
                      <option value="DERIVED_FROM">DERIVED_FROM (Deriva de)</option>
                      <option value="REQUIRES_APPROVAL">REQUIRES_APPROVAL (Requiere Aprobación de)</option>
                    </select>

                    <select
                      value={targetLinkObjectId}
                      onChange={(e) => setTargetLinkObjectId(e.target.value)}
                      className="w-full rounded border border-slate-200 p-1.5 font-medium text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                    >
                      <option value="">-- Seleccionar Objeto Destino --</option>
                      {objects
                        .filter((o) => o.id !== selectedObject.id)
                        .map((o) => (
                          <option key={o.id} value={o.id}>
                            [{o.type}] {o.title}
                          </option>
                        ))}
                    </select>

                    <div className="flex justify-end space-x-2 pt-1">
                      <button
                        onClick={() => setIsLinkingOpen(false)}
                        className="rounded px-2.5 py-1 text-slate-500 hover:bg-slate-200"
                      >
                        Cancelar
                      </button>
                      <button
                        onClick={handleAddLink}
                        className="rounded bg-indigo-600 px-3 py-1 font-semibold text-white hover:bg-indigo-700"
                      >
                        Guardar Relación
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {linked.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-400">
                  No hay relaciones configuradas aún para este objeto.
                </div>
              ) : (
                <div className="space-y-2">
                  {linked.map((item, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 p-3 transition hover:border-indigo-300 dark:border-slate-800 dark:bg-slate-800/60"
                    >
                      <div className="flex items-center space-x-3">
                        <span className="rounded bg-indigo-100 px-2 py-0.5 text-[10px] font-bold text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300">
                          {item.relationType}
                        </span>
                        <div>
                          <div className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                            {item.object.title}
                          </div>
                          <div className="text-[11px] text-slate-400">
                            Tipo: {item.object.type} | Estado: {item.object.status}
                          </div>
                        </div>
                      </div>
                      <ArrowRight className="h-4 w-4 text-slate-400" />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 3: COMMENTS & COLLABORATION */}
          {activeDrawerTab === 'comments' && (
            <div className="flex h-full flex-col justify-between space-y-4">
              <div className="space-y-3">
                {objComments.length === 0 ? (
                  <div className="p-8 text-center text-xs text-slate-400">
                    Sin comentarios aún. Escribe el primero abajo.
                  </div>
                ) : (
                  objComments.map((cmt) => (
                    <div key={cmt.id} className="flex space-x-3 rounded-xl border border-slate-100 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-800/40">
                      <img src={cmt.userAvatar} alt="" className="h-7 w-7 rounded-full object-cover" />
                      <div className="flex-1">
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="font-bold text-slate-800 dark:text-slate-200">{cmt.userName}</span>
                          <span className="text-slate-400">{new Date(cmt.createdAt).toLocaleTimeString()}</span>
                        </div>
                        <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">{cmt.content}</p>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Comment Input */}
              <form onSubmit={handleCommentSubmit} className="flex items-center space-x-2 pt-2 border-t border-slate-200 dark:border-slate-800">
                <input
                  type="text"
                  value={newCommentText}
                  onChange={(e) => setNewCommentText(e.target.value)}
                  placeholder="Escribe un comentario..."
                  className="flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs outline-none focus:border-indigo-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                />
                <button
                  type="submit"
                  className="rounded-lg bg-indigo-600 p-2 text-white hover:bg-indigo-700"
                >
                  <Send className="h-4 w-4" />
                </button>
              </form>
            </div>
          )}

          {/* TAB 4: AUDIT LOG */}
          {activeDrawerTab === 'history' && (
            <div className="space-y-3">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
                Historial de Modificaciones Inmutables
              </span>

              {objLogs.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-400">
                  Sin registros de auditoría aún.
                </div>
              ) : (
                <div className="space-y-2 border-l-2 border-slate-200 pl-3 dark:border-slate-800">
                  {objLogs.map((log) => (
                    <div key={log.id} className="relative text-xs">
                      <div className="font-semibold text-slate-800 dark:text-slate-200">{log.action}</div>
                      <div className="flex items-center space-x-2 text-[11px] text-slate-400">
                        <span>{log.userName}</span>
                        <span>•</span>
                        <span>{new Date(log.timestamp).toLocaleString()}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
