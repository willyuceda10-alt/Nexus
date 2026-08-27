import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { authenticate, resolveActor } from '../auth.js';
import { canAccessWorkspace } from '../authorization.js';
import { withTenant } from '../tenant-transaction.js';

const uuid = z.string().uuid();
const querySchema = z.object({
  workspaceId: uuid,
  projectId: uuid.optional(),
  startAt: z.coerce.date(),
  endAt: z.coerce.date(),
}).superRefine((value, ctx) => {
  if (value.endAt <= value.startAt) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['endAt'], message: 'endAt must be after startAt.' });
  }
  if (value.endAt.getTime() - value.startAt.getTime() > 370 * 24 * 60 * 60 * 1000) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['endAt'], message: 'Calendar projection range cannot exceed 370 days.' });
  }
});

type ProjectionRow = {
  item_id: string;
  item_type: 'MEETING' | 'RECURRING_OCCURRENCE';
  meeting_object_id: string;
  series_id: string | null;
  occurrence_id: string | null;
  sequence: number | null;
  title: string;
  start_at: Date;
  end_at: Date;
  lifecycle_status: 'SCHEDULED' | 'CANCEL_PENDING' | 'CANCELLED';
  sync_status: 'LOCAL_ONLY' | 'PENDING' | 'SYNCED' | 'FAILED';
  is_exception: boolean;
  join_url: string | null;
  web_link: string | null;
  location: string | null;
};

export async function meetingCalendarProjectionV1Routes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/meetings-v3/calendar-projection', { preHandler: [authenticate, resolveActor] }, async (request, reply) => {
    const parsed = querySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'validation_error', details: parsed.error.flatten() });
    }
    const actor = request.actor!;
    return withTenant(actor.tenantId, async (tx) => {
      if (!(await canAccessWorkspace(tx, actor, parsed.data.workspaceId))) {
        return reply.code(403).send({ error: 'workspace_access_denied' });
      }

      const rows = await tx.$queryRaw<ProjectionRow[]>(Prisma.sql`
        WITH recurring_master_ids AS (
          SELECT master_meeting_object_id
          FROM meeting_recurrence_series_v1
          WHERE tenant_id = ${actor.tenantId}::uuid
            AND workspace_id = ${parsed.data.workspaceId}::uuid
        ), simple_meetings AS (
          SELECT
            c.id::text AS item_id,
            'MEETING'::text AS item_type,
            c.meeting_object_id,
            NULL::uuid AS series_id,
            NULL::uuid AS occurrence_id,
            NULL::integer AS sequence,
            o.title,
            c.start_at,
            c.end_at,
            c.lifecycle_status,
            c.sync_status,
            false AS is_exception,
            c.join_url,
            c.web_link,
            c.location
          FROM meeting_collaboration_v1 c
          JOIN nexus_objects o
            ON o.id = c.meeting_object_id
           AND o.tenant_id = c.tenant_id
           AND o.deleted_at IS NULL
          WHERE c.tenant_id = ${actor.tenantId}::uuid
            AND c.workspace_id = ${parsed.data.workspaceId}::uuid
            AND (${parsed.data.projectId ?? null}::uuid IS NULL OR c.project_id = ${parsed.data.projectId ?? null}::uuid)
            AND c.meeting_object_id NOT IN (SELECT master_meeting_object_id FROM recurring_master_ids)
            AND c.start_at < ${parsed.data.endAt}
            AND c.end_at > ${parsed.data.startAt}
        ), recurring_occurrences AS (
          SELECT
            occ.id::text AS item_id,
            'RECURRING_OCCURRENCE'::text AS item_type,
            s.master_meeting_object_id AS meeting_object_id,
            s.id AS series_id,
            occ.id AS occurrence_id,
            occ.sequence,
            o.title,
            occ.start_at,
            occ.end_at,
            occ.lifecycle_status,
            c.sync_status,
            occ.is_exception,
            NULL::text AS join_url,
            NULL::text AS web_link,
            c.location
          FROM meeting_recurrence_occurrences_v1 occ
          JOIN meeting_recurrence_series_v1 s
            ON s.id = occ.series_id
           AND s.tenant_id = occ.tenant_id
          JOIN meeting_collaboration_v1 c
            ON c.id = s.meeting_collaboration_id
           AND c.tenant_id = s.tenant_id
          JOIN nexus_objects o
            ON o.id = s.master_meeting_object_id
           AND o.tenant_id = s.tenant_id
           AND o.deleted_at IS NULL
          WHERE occ.tenant_id = ${actor.tenantId}::uuid
            AND s.workspace_id = ${parsed.data.workspaceId}::uuid
            AND (${parsed.data.projectId ?? null}::uuid IS NULL OR c.project_id = ${parsed.data.projectId ?? null}::uuid)
            AND occ.start_at < ${parsed.data.endAt}
            AND occ.end_at > ${parsed.data.startAt}
        )
        SELECT * FROM simple_meetings
        UNION ALL
        SELECT * FROM recurring_occurrences
        ORDER BY start_at, item_id
      `);

      return {
        range: { startAt: parsed.data.startAt.toISOString(), endAt: parsed.data.endAt.toISOString() },
        items: rows.map((row) => ({
          id: `${row.item_type}:${row.item_id}`,
          itemType: row.item_type,
          meetingObjectId: row.meeting_object_id,
          seriesId: row.series_id,
          occurrenceId: row.occurrence_id,
          sequence: row.sequence,
          title: row.title,
          startAt: row.start_at.toISOString(),
          endAt: row.end_at.toISOString(),
          lifecycleStatus: row.lifecycle_status,
          syncStatus: row.sync_status,
          isException: row.is_exception,
          joinUrl: row.join_url,
          webLink: row.web_link,
          location: row.location,
        })),
      };
    });
  });
}
