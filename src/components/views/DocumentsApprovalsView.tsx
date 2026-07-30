import React from 'react';
import { FileCheck2, Plus, Download, ShieldCheck, CheckCircle2, Clock, FileText } from 'lucide-react';
import { useNexus } from '../../context/NexusContext';

export const DocumentsApprovalsView: React.FC<{ projectId?: string }> = ({ projectId }) => {
  const { objects, openObjectDrawer, openCreateModal, decideApproval, approvals } = useNexus();

  const docs = objects.filter((o) => o.type === 'DOCUMENT' && (!projectId || o.projectId === projectId));

  return (
    <div className="space-y-6 max-w-7xl mx-auto p-2">
      {/* Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between rounded-2xl bg-gradient-to-r from-emerald-900 via-teal-950 to-slate-900 p-5 text-white shadow-xl">
        <div>
          <div className="flex items-center space-x-2 text-emerald-300 text-xs font-bold uppercase tracking-wider">
            <FileCheck2 className="h-4 w-4" />
            <span>Bóveda de Documentos & Firma Electrónica</span>
          </div>
          <h1 className="mt-1 text-xl font-extrabold">Gestión Documental & Control de Versiones</h1>
          <p className="mt-1 text-xs text-emerald-100/80">
            {docs.length} Documentos en Bóveda • Trazabilidad Hash SHA-256
          </p>
        </div>

        <button
          onClick={() => openCreateModal('DOCUMENT')}
          className="mt-4 md:mt-0 flex items-center space-x-1.5 rounded-xl bg-emerald-500 px-3.5 py-2 text-xs font-bold text-slate-950 shadow-md hover:bg-emerald-400"
        >
          <Plus className="h-4 w-4" />
          <span>Subir / Vincular Documento</span>
        </button>
      </div>

      {/* Documents Vault Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {docs.length === 0 ? (
          <div className="col-span-3 p-12 text-center text-xs text-slate-400">
            Sin documentos en la bóveda.
          </div>
        ) : (
          docs.map((doc) => {
            const app = approvals.find((a) => a.objectId === doc.id);

            return (
              <div
                key={doc.id}
                onClick={() => openObjectDrawer(doc.id)}
                className="group cursor-pointer rounded-2xl border border-slate-200 bg-white p-4 shadow-xs transition hover:border-emerald-400 hover:shadow-md dark:border-slate-800 dark:bg-slate-900"
              >
                <div className="flex items-center justify-between">
                  <span className="rounded bg-emerald-100 px-2 py-0.5 text-[10px] font-extrabold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                    PDF / CAD
                  </span>
                  <span className="text-[11px] font-mono text-slate-400">v1.2</span>
                </div>

                <h4 className="mt-3 text-xs font-bold text-slate-900 group-hover:text-emerald-600 dark:text-slate-100">
                  {doc.title}
                </h4>

                <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 line-clamp-2">
                  {doc.description || 'Especificaciones técnicas y contrato adjunto.'}
                </p>

                <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-2.5 text-xs text-slate-400 dark:border-slate-800">
                  <div className="flex items-center space-x-1">
                    <img src={doc.ownerAvatar} alt="" className="h-4 w-4 rounded-full" />
                    <span>{doc.ownerName.split(' ')[0]}</span>
                  </div>
                  <span className="font-mono text-[10px] text-emerald-600 font-bold">SHA-256 Verified</span>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
