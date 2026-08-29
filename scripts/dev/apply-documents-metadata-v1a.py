from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    if old not in text:
        raise SystemExit(f'PATCH_MISSING {path}: {old[:100]!r}')
    p.write_text(text.replace(old, new, 1), encoding='utf-8')
    print(f'PATCH_OK {path}')


# Prisma schema: persist version lineage/uploader metadata on existing attachment table.
replace_once(
    'prisma/schema.prisma',
    '''  checksumSha256 String?  @map("checksum_sha256") @db.VarChar(64)\n  createdAt      DateTime @default(now()) @map("created_at") @db.Timestamptz(6)''',
    '''  checksumSha256      String?  @map("checksum_sha256") @db.VarChar(64)\n  versionNumber       Int      @default(1) @map("version_number")\n  uploadedByUserId    String?  @map("uploaded_by_user_id") @db.Uuid\n  previousAttachmentId String? @map("previous_attachment_id") @db.Uuid\n  createdAt           DateTime @default(now()) @map("created_at") @db.Timestamptz(6)''',
)

# Register backend read model.
replace_once(
    'apps/api/src/app.ts',
    "import { collaborationV1Routes } from './routes/collaboration-v1.js';",
    "import { collaborationV1Routes } from './routes/collaboration-v1.js';\nimport { documentMetadataV1Routes } from './routes/document-metadata-v1.js';",
)
replace_once(
    'apps/api/src/app.ts',
    '  await app.register(collaborationV1Routes);',
    '  await app.register(collaborationV1Routes);\n  await app.register(documentMetadataV1Routes);',
)

# CI definition is prepared for when Actions quota returns; this does not run Actions now.
replace_once(
    '.github/workflows/ci.yml',
    '''      - name: Verify per-field object history and governed persistent relations\n        env:\n          AUTH_MODE: dev\n          DEV_AUTH_ENABLED: "true"\n          DEV_USER_ID: 00000000-0000-4000-8000-000000000001\n          DEV_TENANT_ID: 00000000-0000-4000-8000-000000000002\n        run: npx tsx apps/api/test/object-history-relations-v1-smoke.ts''',
    '''      - name: Verify per-field object history and governed persistent relations\n        env:\n          AUTH_MODE: dev\n          DEV_AUTH_ENABLED: "true"\n          DEV_USER_ID: 00000000-0000-4000-8000-000000000001\n          DEV_TENANT_ID: 00000000-0000-4000-8000-000000000002\n        run: npx tsx apps/api/test/object-history-relations-v1-smoke.ts\n\n      - name: Verify persistent document version metadata\n        env:\n          AUTH_MODE: dev\n          DEV_AUTH_ENABLED: "true"\n          DEV_USER_ID: 00000000-0000-4000-8000-000000000001\n          DEV_TENANT_ID: 00000000-0000-4000-8000-000000000002\n        run: npx tsx apps/api/test/document-metadata-v1-smoke.ts''',
)

# Root test now covers truthful document metadata projection too.
replace_once(
    'package.json',
    'tsx src/domain/myWork.smoke.ts && tsx src/domain/collaborationV1.smoke.ts && tsx src/domain/objectApprovalsV1.smoke.ts && npm run test --workspace @nexus/api',
    'tsx src/domain/myWork.smoke.ts && tsx src/domain/collaborationV1.smoke.ts && tsx src/domain/objectApprovalsV1.smoke.ts && tsx src/domain/documentMetadataV1.smoke.ts && npm run test --workspace @nexus/api',
)

# Azure foundation: dedicated private container + API Managed Identity data-plane RBAC.
replace_once(
    'infra/azure/main.bicep',
    "var keyVaultSecretsUserRoleId = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4633458b-17de-408a-b874-0445c86b69e6')",
    "var keyVaultSecretsUserRoleId = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4633458b-17de-408a-b874-0445c86b69e6')\nvar storageBlobDataContributorRoleId = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'ba92f5b4-2d11-453d-a403-e96b0029c9fe')",
)
replace_once(
    'infra/azure/main.bicep',
    '''resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {\n  parent: storage\n  name: 'default'\n  properties: {\n    deleteRetentionPolicy: { enabled: true, days: environment == 'prod' ? 30 : 7, allowPermanentDelete: false }\n    containerDeleteRetentionPolicy: { enabled: true, days: environment == 'prod' ? 30 : 7 }\n  }\n}''',
    '''resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {\n  parent: storage\n  name: 'default'\n  properties: {\n    deleteRetentionPolicy: { enabled: true, days: environment == 'prod' ? 30 : 7, allowPermanentDelete: false }\n    containerDeleteRetentionPolicy: { enabled: true, days: environment == 'prod' ? 30 : 7 }\n  }\n}\n\nresource documentsContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {\n  parent: blobService\n  name: 'bridata-documents'\n  properties: {\n    publicAccess: 'None'\n  }\n}''',
)
replace_once(
    'infra/azure/main.bicep',
    '''resource apiIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {\n  name: '${baseName}-api-mi'\n  location: location\n  tags: tags\n}''',
    '''resource apiIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {\n  name: '${baseName}-api-mi'\n  location: location\n  tags: tags\n}\n\nresource apiDocumentsBlobContributorRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {\n  scope: storage\n  name: guid(storage.id, apiIdentity.id, storageBlobDataContributorRoleId)\n  properties: {\n    principalId: apiIdentity.properties.principalId\n    principalType: 'ServicePrincipal'\n    roleDefinitionId: storageBlobDataContributorRoleId\n  }\n}''',
)
replace_once(
    'infra/azure/main.bicep',
    '''  dependsOn: [\n    automationAcrPullRole''',
    '''  dependsOn: [\n    documentsContainer\n    apiDocumentsBlobContributorRole\n    automationAcrPullRole''',
)
replace_once(
    'infra/azure/main.bicep',
    'output storageAccountName string = storage.name',
    "output storageAccountName string = storage.name\noutput documentsContainerName string = documentsContainer.name",
)

# Replace misleading hardcoded vault/version/hash UI with persisted metadata projection.
documents_view = r'''import React, { useEffect, useMemo, useState } from 'react';
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
'''
Path('src/components/views/DocumentsApprovalsView.tsx').write_text(documents_view, encoding='utf-8')
print('PATCH_OK src/components/views/DocumentsApprovalsView.tsx')

Path(__file__).unlink()
print('DOCUMENTS_METADATA_V1A_PATCH_OK')
