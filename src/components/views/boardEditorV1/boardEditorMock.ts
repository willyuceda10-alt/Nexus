import type { ApiWorkBoardColumnV1, ApiWorkBoardDataV1, ApiWorkBoardGroupV1, ApiWorkBoardItemV1, ApiWorkViewV1 } from '../../../api/workOsBoardV1Contracts';
import type { NexusObject } from '../../../types/nexus';

export function buildBoardEditorMock(objects: NexusObject[]): ApiWorkBoardDataV1 {
  const groups: ApiWorkBoardGroupV1[] = [
    { id: 'mock-plan', key: 'planificado', name: 'Planificado', color: '#94a3b8', sort_order: 10 },
    { id: 'mock-run', key: 'ejecucion', name: 'En ejecución', color: '#16a34a', sort_order: 20 },
    { id: 'mock-close', key: 'cerrado', name: 'Cerrado', color: '#059669', sort_order: 30 },
  ];
  const columns: ApiWorkBoardColumnV1[] = [
    { id: 'mock-title', key: 'titulo', label: 'Elemento', source: 'CORE', data_type: 'TEXT', field_key: 'title', width: 320, sort_order: 10, is_visible: true, is_editable: true, config: null },
    { id: 'mock-status', key: 'estado', label: 'Estado', source: 'CORE', data_type: 'STATUS', field_key: 'status', width: 150, sort_order: 20, is_visible: true, is_editable: true, config: null },
    { id: 'mock-priority', key: 'prioridad', label: 'Prioridad', source: 'CORE', data_type: 'PRIORITY', field_key: 'priority', width: 130, sort_order: 30, is_visible: true, is_editable: true, config: null },
    { id: 'mock-assignee', key: 'responsable', label: 'Responsable', source: 'CORE', data_type: 'PERSON', field_key: 'assigneeId', width: 180, sort_order: 40, is_visible: true, is_editable: false, config: null },
    { id: 'mock-date', key: 'fecha_fin', label: 'Fecha objetivo', source: 'CORE', data_type: 'DATE', field_key: 'dueDate', width: 150, sort_order: 50, is_visible: true, is_editable: true, config: null },
    { id: 'mock-progress', key: 'avance', label: 'Avance', source: 'CORE', data_type: 'PROGRESS', field_key: 'progress', width: 140, sort_order: 60, is_visible: true, is_editable: true, config: null },
  ];
  const views: ApiWorkViewV1[] = [
    { id: 'mock-table', name: 'Tabla principal', view_type: 'TABLE', is_default: true, sort_order: 10, config: { density: 'comfortable', hiddenColumnKeys: [], columnOrder: columns.map((column) => column.key) } },
    { id: 'mock-kanban', name: 'Kanban', view_type: 'KANBAN', is_default: false, sort_order: 20, config: { kanbanColumnKey: 'status' } },
  ];
  const tasks = objects.filter((object) => object.type === 'TASK').slice(0, 24);
  const items: ApiWorkBoardItemV1[] = tasks.map((object, index) => ({
    object: {
      id: object.id,
      objectTypeKey: object.type,
      title: object.title,
      description: object.description || null,
      status: object.status,
      priority: object.priority,
      progress: object.progress,
      ownerId: object.ownerId,
      assigneeId: object.assigneeId ?? null,
      startDate: object.startDate ?? null,
      dueDate: object.endDate ?? null,
      createdAt: object.createdAt,
      updatedAt: object.updatedAt,
      version: object.version ?? 1,
      owner: { id: object.ownerId, fullName: object.ownerName || 'Responsable', email: '', avatarUrl: object.ownerAvatar || null },
      assignee: object.assigneeId ? { id: object.assigneeId, fullName: object.assigneeName || 'Equipo asignado', email: '', avatarUrl: object.assigneeAvatar || null } : null,
    },
    customFields: { ...(object.customFields ?? {}) },
    placement: {
      groupId: ['COMPLETED', 'APPROVED'].includes(object.status) ? 'mock-close' : object.status === 'IN_PROGRESS' ? 'mock-run' : 'mock-plan',
      sortOrder: index * 10,
    },
  }));
  return {
    board: { id: 'mock-board', workspaceId: 'mock', objectDefinitionId: 'mock-task-definition', name: 'Ejecución operativa', description: 'Board configurable del workspace.', icon: 'layout-grid', isArchived: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    groups,
    columns,
    views,
    selectedView: views[0],
    items,
  };
}
