/**
 * Etiquetas legibles para los enums del dominio.
 *
 * Los valores de `type` y `status` son constantes de base de datos
 * (`IN_PROGRESS`, `PENDING_APPROVAL`...) y se estaban pintando tal cual en la
 * interfaz, guion bajo incluido. Este módulo es la única traducción: cualquier
 * vista que muestre un tipo o estado debe pasar por aquí.
 */

const TYPE_LABELS: Record<string, string> = {
  PROJECT: 'Proyecto',
  TASK: 'Tarea',
  DELIVERABLE: 'Entregable',
  MILESTONE: 'Hito',
  RISK: 'Riesgo',
  DECISION: 'Decisión',
  CHANGE_REQUEST: 'Solicitud de cambio',
  DOCUMENT: 'Documento',
  MEETING: 'Reunión',
};

const STATUS_LABELS: Record<string, string> = {
  PLANNING: 'En planificación',
  IN_PROGRESS: 'En progreso',
  IN_REVIEW: 'En revisión',
  PENDING: 'Pendiente',
  PENDING_APPROVAL: 'Esperando aprobación',
  APPROVED: 'Aprobado',
  COMPLETED: 'Completado',
  CANCELLED: 'Cancelado',
  BLOCKED: 'Bloqueado',
  IDENTIFIED: 'Identificado',
  REALIZED: 'Materializado',
  MITIGATED: 'Mitigado',
  DRAFT: 'Borrador',
  REJECTED: 'Rechazado',
};

/** Convierte un enum desconocido en algo presentable en vez de mostrarlo crudo. */
function humanizeFallback(value: string): string {
  const words = value.toLowerCase().replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function objectTypeLabel(type: string): string {
  return TYPE_LABELS[type] ?? humanizeFallback(type);
}

export function objectStatusLabel(status: string): string {
  return STATUS_LABELS[status] ?? humanizeFallback(status);
}
