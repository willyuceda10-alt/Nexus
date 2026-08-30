import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, RefreshCw, ShieldCheck, UsersRound } from 'lucide-react';
import {
  authorizationV2Api,
  type WorkspaceMemberV1,
  type WorkspaceRoleV2,
} from '../../api/authorizationV2Client';
import { BridataApiError } from '../../api/client';
import { useApiBootstrap } from '../../context/ApiBootstrapContext';
import { useNexus } from '../../context/NexusContext';

const ROLE_LABELS: Record<WorkspaceRoleV2, string> = {
  OWNER: 'Owner',
  ADMIN: 'Administrador',
  PMO_SENIOR: 'PMO Senior',
  MANAGER: 'Manager',
  MEMBER: 'Miembro',
  VIEWER: 'Solo lectura',
};

const MOCK_ROLES: WorkspaceRoleV2[] = ['OWNER', 'ADMIN', 'PMO_SENIOR', 'MANAGER', 'MEMBER', 'VIEWER'];

function errorText(error: unknown): string {
  if (error instanceof BridataApiError) {
    return error.correlationId ? `${error.message} · Ref: ${error.correlationId}` : error.message;
  }
  return error instanceof Error ? error.message : 'No se pudo completar la operación de roles.';
}

function mockRole(roleKey: string): WorkspaceRoleV2 {
  if (roleKey === 'OWNER') return 'OWNER';
  if (roleKey === 'SUPER_ADMIN' || roleKey === 'ADMIN') return 'ADMIN';
  if (roleKey === 'PROJECT_MANAGER') return 'MANAGER';
  if (roleKey === 'CLIENT') return 'VIEWER';
  return 'MEMBER';
}

function initials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase() || 'BR';
}

export const WorkspaceRoleManagementV1H4: React.FC = () => {
  const apiBootstrap = useApiBootstrap();
  const { currentWorkspace, currentUser } = useNexus();
  const apiReady = apiBootstrap.dataMode === 'api' && apiBootstrap.status === 'ready';
  const [members, setMembers] = useState<WorkspaceMemberV1[]>([]);
  const [roles, setRoles] = useState<WorkspaceRoleV2[]>(MOCK_ROLES);
  const [canManageRoles, setCanManageRoles] = useState(false);
  const [loading, setLoading] = useState(false);
  const [savingUserId, setSavingUserId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const tenantRole = apiBootstrap.bootstrap?.actor.role ?? currentUser.roleKey;
  const canManageOwner = ['OWNER', 'TENANT_ADMIN'].includes(tenantRole);

  const previewMember = useMemo<WorkspaceMemberV1>(() => ({
    membershipId: 'preview-membership',
    userId: currentUser.id,
    fullName: currentUser.name,
    email: currentUser.email,
    avatarUrl: currentUser.avatar || null,
    isActive: true,
    role: mockRole(currentUser.roleKey),
    joinedAt: new Date(0).toISOString(),
  }), [currentUser]);

  useEffect(() => {
    setError(null);
    setMessage(null);

    if (!currentWorkspace) {
      setMembers([]);
      setCanManageRoles(false);
      return;
    }

    if (apiBootstrap.dataMode !== 'api') {
      setMembers([previewMember]);
      setRoles(MOCK_ROLES);
      setCanManageRoles(false);
      setLoading(false);
      return;
    }

    if (!apiReady) {
      setMembers([]);
      setCanManageRoles(false);
      setLoading(apiBootstrap.status === 'loading');
      return;
    }

    const controller = new AbortController();
    setLoading(true);

    void authorizationV2Api.effectiveWorkspacePermissions(currentWorkspace.id, controller.signal)
      .then(async (effective) => {
        if (controller.signal.aborted) return;
        const allowed = effective.decisions.some(
          (decision) => decision.permission === 'workspace.manage_permissions' && decision.allowed,
        );
        setCanManageRoles(allowed);
        if (!allowed) {
          setMembers([]);
          return;
        }

        const roster = await authorizationV2Api.listWorkspaceMembers(currentWorkspace.id, controller.signal);
        if (controller.signal.aborted) return;
        setMembers(roster.items);
        setRoles(roster.roles);
      })
      .catch((cause) => {
        if (!controller.signal.aborted) {
          setMembers([]);
          setCanManageRoles(false);
          setError(errorText(cause));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [
    apiBootstrap.dataMode,
    apiBootstrap.status,
    apiReady,
    currentWorkspace,
    previewMember,
  ]);

  const changeRole = async (member: WorkspaceMemberV1, role: WorkspaceRoleV2) => {
    if (!apiReady || !currentWorkspace || !canManageRoles || member.role === role) return;
    setSavingUserId(member.userId);
    setError(null);
    setMessage(null);
    try {
      const updated = await authorizationV2Api.updateWorkspaceRole(currentWorkspace.id, member.userId, role);
      setMembers((current) => current.map((item) => (
        item.userId === updated.userId ? { ...item, role: updated.role } : item
      )));
      setMessage(`${member.fullName}: rol actualizado a ${ROLE_LABELS[updated.role]}.`);

      // If the operator changed their own role, refresh bootstrap so the sidebar and
      // all effective navigation permissions immediately reflect the new authority.
      if (member.userId === currentUser.id) {
        await apiBootstrap.retry();
      }
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setSavingUserId(null);
    }
  };

  const modeLabel = apiBootstrap.dataMode !== 'api'
    ? 'PREVIEW'
    : canManageRoles
      ? 'GESTIÓN HABILITADA'
      : 'SIN PERMISO DE ADMINISTRACIÓN';

  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100">
            <UsersRound className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-sm font-extrabold text-slate-950">Roles del workspace</h2>
            <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-500">
              Asigna responsabilidades operativas. PMO Senior gobierna portafolio, cronograma, forecast, baselines, cambios y riesgos sin obtener administración técnica ni escritura de costo real SAP.
            </p>
          </div>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-[10px] font-black tracking-wide ring-1 ${canManageRoles ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : 'bg-slate-100 text-slate-500 ring-slate-200'}`}>
          {modeLabel}
        </span>
      </div>

      <div className="mt-4 flex gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-[11px] leading-5 text-slate-600">
        <ShieldCheck className="mt-0.5 h-4 w-4 flex-none text-emerald-700" />
        <span>
          El rol <strong className="text-slate-800">Owner</strong> está protegido: solo Owner o Tenant Admin puede asignarlo o retirarlo. Los cambios reales generan auditoría y evento de dominio.
        </span>
      </div>

      {message && (
        <div className="mt-4 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-xs font-semibold text-emerald-700">
          <CheckCircle2 className="h-4 w-4" /> {message}
        </div>
      )}
      {error && (
        <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs font-semibold text-rose-700">{error}</div>
      )}

      {loading ? (
        <div className="mt-5 flex items-center justify-center gap-2 rounded-2xl border border-dashed border-slate-200 py-8 text-xs font-semibold text-slate-500" role="status">
          <RefreshCw className="h-4 w-4 animate-spin" /> Cargando permisos y miembros…
        </div>
      ) : apiBootstrap.dataMode === 'api' && !canManageRoles ? (
        <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate-600">
          Tu sesión puede usar el workspace, pero no administra roles. La lista de miembros permanece protegida por Authorization V2.
        </div>
      ) : (
        <div className="mt-5 overflow-hidden rounded-2xl border border-slate-200">
          <div className="hidden grid-cols-[minmax(240px,1fr)_150px_110px] gap-3 border-b border-slate-200 bg-slate-50 px-4 py-2.5 text-[10px] font-bold uppercase tracking-wide text-slate-500 sm:grid">
            <span>Persona</span><span>Rol</span><span>Estado</span>
          </div>
          <div className="divide-y divide-slate-100">
            {members.map((member) => {
              const ownerProtected = member.role === 'OWNER' && !canManageOwner;
              const saving = savingUserId === member.userId;
              return (
                <div key={member.membershipId} className="grid gap-3 px-4 py-3 sm:grid-cols-[minmax(240px,1fr)_150px_110px] sm:items-center">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="grid h-9 w-9 flex-none place-items-center rounded-full bg-slate-900 text-[10px] font-black text-white">
                      {initials(member.fullName)}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-xs font-bold text-slate-900">{member.fullName}</p>
                      <p className="mt-0.5 truncate text-[11px] text-slate-500">{member.email}</p>
                    </div>
                  </div>

                  <label className="text-[10px] font-bold uppercase tracking-wide text-slate-400 sm:text-transparent">
                    <span className="sm:hidden">Rol</span>
                    <select
                      value={member.role}
                      disabled={!apiReady || !canManageRoles || saving || ownerProtected}
                      onChange={(event) => void changeRole(member, event.target.value as WorkspaceRoleV2)}
                      className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs font-semibold normal-case tracking-normal text-slate-700 outline-none focus:border-emerald-400 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500 sm:mt-0"
                      aria-label={`Rol de ${member.fullName}`}
                    >
                      {roles.map((role) => (
                        <option key={role} value={role} disabled={role === 'OWNER' && !canManageOwner && member.role !== 'OWNER'}>
                          {ROLE_LABELS[role]}
                        </option>
                      ))}
                    </select>
                  </label>

                  <div className="flex items-center justify-between gap-2 sm:justify-start">
                    <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400 sm:hidden">Estado</span>
                    {saving ? (
                      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700"><RefreshCw className="h-3.5 w-3.5 animate-spin" /> Guardando</span>
                    ) : (
                      <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${member.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                        {member.isActive ? 'ACTIVO' : 'INACTIVO'}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          {members.length === 0 && (
            <div className="px-4 py-8 text-center text-xs text-slate-500">No hay miembros disponibles para administrar.</div>
          )}
        </div>
      )}

      {apiBootstrap.dataMode !== 'api' && (
        <p className="mt-3 text-[11px] text-slate-400">La vista mock solo demuestra la interfaz; los cambios de rol están deshabilitados hasta usar el backend autenticado.</p>
      )}
    </section>
  );
};
