import React, { useEffect, useMemo, useState } from 'react';
import { FileCheck2, Plus, ShieldCheck, Clock, FileText, AlertCircle } from 'lucide-react';
import { useNexus } from '../../context/NexusContext';
import { documentMetadataV1Api } from '../../api/documentMetadataV1Client';
import { mapDocumentCardV1, type DocumentCardV1 } from '../../domain/documentMetadataV1';

export const DocumentsApprovalsView: React.FC<{ projectId?: string }> = ({ projectId }) => {
  const {
    objects,
    currentWorkspace,
    objectDataStatus,
    openObjectDrawer,
    openCreateModal,
  } = useNexus();
  const [apiDocuments, setApiDocuments] = useState<DocumentCardV1[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const logicalDocuments = useMemo(
    () => objects.filter((object) => object.type === 'DOCUMENT' && (!projectId || object.projectId === projectId)),
    [objects, projectId],
  );
  const apiMode = objectDataStatus !== 'mock';

  useEffect(() => {
    if (!apiMode || objectDataStatus !== 'ready' || !currentWorkspace) {
      setApiDocuments([]);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    void documentMetadataV1Api.listWorkspace(currentWorkspace.id)
      .then((response) => {
        if (cancelled) return;
        const visibleIds = new Set(logicalDocuments.map((document) => document.id));
        setApiDocuments(response.items.filter((item) => visibleIds.has(item.id)).map(mapDocumentCardV1));
      })
      .catch((cause) => {
        if (cancelled) return;
        setApiDocuments([]);
        setError(cause instanceof Error ? cause.message : 'No se pudo cargar el versionado documental.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [apiMode, objectDataStatus, currentWorkspace, logicalDocuments]);

  const cards = apiMode
    ? apiDocuments
    : logicalDocuments.map((document) => ({
        id: document.id,
        title: document.title,
        description: document.description,
        status: document.status,
        versionCount: document.fileVersion ? 1 : 0,
        latestVersion: document.fileVersion
          ? {
              id: `${document.id}-mock-version`,
              versionLabel: document.fileVersion,
              fileName: document.title,
              mimeType: document.fileCategory ?? 'Archivo',
              sizeLabel: document.fileSizeMb !== undefined ? `${document.fileSizeMb.toFixed(1)} MB` : 'Tamaño no informado',
              checksumLabel: 'SHA-256 no disponible',
              checksumVerified: false,
              uploaderName: document.ownerName,
              createdAt: document.updatedAt,
            }
          : null,
      }));

  const storedVersionCount = cards.reduce((sum, document) => sum + document.versionCount, 0);

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-2">
      <div className="flex flex-col justify-between rounded-2xl bg-gradient-to-r from-emerald-900 via-teal-950 to-slate-900 p-5 text-white shadow-xl md:flex-row md:items-center">
        <div>
          <div className="flex items-center space-x-2 text-xs font-bold uppercase tracking-wider text-emerald-300">
            <FileCheck2 className="h-4 w-4" />
            <span>Documentos & Control de Versiones</span>
          </div>
          <h1 className="mt-1 text-xl font-extrabold">Repositorio documental gobernado</h1>
          <p className="mt-1 text-xs text-emerald-100/80">
            {logicalDocuments.length} documentos • {storedVersionCount} versiones de archivo registradas
          </p>
        </div>

        <button
          onClick={() => openCreateModal('DOCUMENT')}
          className="mt-4 flex items-center space-x-1.5 rounded-xl bg-emerald-500 px-3.5 py-2 text-xs font-bold text-slate-950 shadow-md hover:bg-emerald-400 md:mt-0"
        >
          <Plus className="h-4 w-4" />
          <span>Crear documento</span>
        </button>
      </div>

      {error && (
        <div role="alert" className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-700">
          <AlertCircle className="h-4 w-4" />
          <span>{error}</span>
        </div>
      )}

      {loading && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-900">
          Cargando versionado documental persistente…
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {!loading && cards.length === 0 ? (
          <div className="col-span-3 p-12 text-center text-xs text-slate-400">Sin documentos registrados.</div>
        ) : (
          cards.map((document) => {
            const version = document.latestVersion;
            return (
              <div
                key={document.id}
                onClick={() => openObjectDrawer(document.id)}
                className="group cursor-pointer rounded-2xl border border-slate-200 bg-white p-4 shadow-xs transition hover:border-emerald-400 hover:shadow-md dark:border-slate-800 dark:bg-slate-900"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="rounded bg-emerald-100 px-2 py-0.5 text-[10px] font-extrabold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                    {version ? version.mimeType : 'DOCUMENTO'}
                  </span>
                  <span className="font-mono text-[11px] text-slate-400">
                    {version?.versionLabel ?? 'Sin archivo'}
                  </span>
                </div>

                <h4 className="mt-3 text-xs font-bold text-slate-900 group-hover:text-emerald-600 dark:text-slate-100">
                  {document.title}
                </h4>
                <p className="mt-1 line-clamp-2 text-[11px] text-slate-500 dark:text-slate-400">
                  {document.description || 'Sin descripción documental.'}
                </p>

                {version ? (
                  <div className="mt-4 space-y-2 border-t border-slate-100 pt-2.5 text-[11px] dark:border-slate-800">
                    <div className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
                      <FileText className="h-3.5 w-3.5" />
                      <span className="truncate">{version.fileName}</span>
                      <span className="ml-auto whitespace-nowrap text-slate-400">{version.sizeLabel}</span>
                    </div>
                    <div className={`flex items-center gap-1.5 ${version.checksumVerified ? 'text-emerald-600' : 'text-slate-400'}`}>
                      <ShieldCheck className="h-3.5 w-3.5" />
                      <span>{version.checksumLabel}</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-slate-400">
                      <Clock className="h-3.5 w-3.5" />
                      <span>{version.uploaderName ? `Registrado por ${version.uploaderName}` : 'Uploader no disponible'}</span>
                    </div>
                  </div>
                ) : (
                  <div className="mt-4 rounded-lg border border-dashed border-slate-200 bg-slate-50 p-3 text-[11px] text-slate-500 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-400">
                    El documento lógico existe, pero todavía no tiene una versión de archivo registrada.
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
