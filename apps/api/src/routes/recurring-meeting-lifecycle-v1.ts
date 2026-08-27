import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { authenticate, resolveActor } from '../auth.js';
import { canManageWorkspace } from '../authorization.js';
import { config } from '../config.js';
import {
  MicrosoftGraphAvailabilityClient,
  MicrosoftGraphAvailabilityConfigurationError,
  MicrosoftGraphAvailabilityError,
} from '../microsoft-graph-availability-client.js';
import { withTenant } from '../tenant-transaction.js';

const uuid = z.string().uuid();
const seriesParams = z.object({ seriesId: uuid });
const occurrenceParams = z.object({ seriesId: uuid, occurrenceId: uuid });
const rescheduleSchema = z.object({
  version: z.number().int().min(1),
  startAt: z.coerce.date(),
  endAt: z.coerce.date(),
  location: z.string().trim().max(500).nullable().optional(),
  requestM365Sync: z.boolean().default(true),
}).superRefine((value, ctx) => {
  if (value.endAt <= value.startAt) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['endAt'], message: 'endAt must be after startAt.' });
  if (value.endAt.getTime() - value.startAt.getTime() > 8 * 60 * 60 * 1000) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['endAt'], message: 'Meeting duration cannot exceed 8 hours.' });
});
const cancelSchema = z.object({ version: z.number().int().min(1), comment: z.string().trim().max(2000).nullable().optional() });

const LIMA_OFFSET_MS = 5 * 60 * 60 * 1000;
function limaDateKey(date: Date): string {
  const local = new Date(date.getTime() - LIMA_OFFSET_MS);
  return `${local.getUTCFullYear()}-${String(local.getUTCMonth() + 1).padStart(2, '0')}-${String(local.getUTCDate()).padStart(2, '0')}`;
}
function intervalsOverlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean { return aStart < bEnd && aEnd > bStart; }
function scheduleFree(view: string): boolean { return view.length > 0 && [...view].every((value) => value === '0'); }

type SeriesRow = {
  id: string; workspace_id: string; meeting_collaboration_id: string; master_meeting_object_id: string; organizer_user_id: string;
  organizer_graph_user: string; graph_event_id: string | null; lifecycle_status: 'SCHEDULED'|'CANCEL_PENDING'|'CANCELLED';
  sync_status: 'LOCAL_ONLY'|'PENDING'|'SYNCED'|'FAILED'; location: string|null; master_version: number;
};
type OccurrenceRow = {
  id:string; series_id:string; sequence:number; occurrence_date:Date; original_start_at:Date; start_at:Date; end_at:Date; version:number;
  lifecycle_status:'SCHEDULED'|'CANCEL_PENDING'|'CANCELLED'; is_exception:boolean; graph_event_id:string|null;
};

async function getSeries(tx: Prisma.TransactionClient, tenantId: string, seriesId: string): Promise<SeriesRow | null> {
  const rows = await tx.$queryRaw<SeriesRow[]>(Prisma.sql`
    SELECT s.id, s.workspace_id, s.meeting_collaboration_id, s.master_meeting_object_id,
           c.organizer_user_id, c.organizer_graph_user, c.graph_event_id, c.lifecycle_status, c.sync_status, c.location,
           o.version AS master_version
    FROM meeting_recurrence_series_v1 s
    JOIN meeting_collaboration_v1 c ON c.id=s.meeting_collaboration_id AND c.tenant_id=s.tenant_id
    JOIN nexus_objects o ON o.id=s.master_meeting_object_id AND o.tenant_id=s.tenant_id AND o.deleted_at IS NULL
    WHERE s.tenant_id=${tenantId}::uuid AND s.id=${seriesId}::uuid LIMIT 1
  `);
  return rows[0] ?? null;
}
async function getOccurrence(tx: Prisma.TransactionClient, tenantId: string, seriesId: string, occurrenceId: string): Promise<OccurrenceRow | null> {
  const rows = await tx.$queryRaw<OccurrenceRow[]>(Prisma.sql`
    SELECT id, series_id, sequence, occurrence_date, original_start_at, start_at, end_at, version, lifecycle_status, is_exception, graph_event_id
    FROM meeting_recurrence_occurrences_v1
    WHERE tenant_id=${tenantId}::uuid AND series_id=${seriesId}::uuid AND id=${occurrenceId}::uuid LIMIT 1
  `);
  return rows[0] ?? null;
}
async function schedulesForSeries(tx: Prisma.TransactionClient, tenantId: string, series: SeriesRow): Promise<string[]> {
  const attendees = await tx.$queryRaw<Array<{email:string}>>(Prisma.sql`
    SELECT email FROM meeting_collaboration_attendees_v1 WHERE tenant_id=${tenantId}::uuid AND meeting_collaboration_id=${series.meeting_collaboration_id}::uuid
  `);
  const resources = await tx.$queryRaw<Array<{email:string}>>(Prisma.sql`
    SELECT DISTINCT r.email
    FROM meeting_occurrence_resource_bookings_v1 b
    JOIN meeting_recurrence_occurrences_v1 o ON o.id=b.occurrence_id AND o.tenant_id=b.tenant_id
    JOIN meeting_resources_v1 r ON r.id=b.meeting_resource_id AND r.tenant_id=b.tenant_id
    WHERE b.tenant_id=${tenantId}::uuid AND o.series_id=${series.id}::uuid
  `);
  return [...new Set([...attendees.map((item) => item.email.toLowerCase()), ...resources.map((item) => item.email.toLowerCase())])];
}
async function validateGraphSlot(
  graph: MicrosoftGraphAvailabilityClient,
  organizerGraphUser: string,
  organizerEmail: string,
  otherSchedules: string[],
  startAt: Date,
  endAt: Date,
): Promise<boolean> {
  const schedules = [...new Set([organizerEmail.toLowerCase(), ...otherSchedules])];
  if (schedules.length > 20) throw new Error('M365_GETSCHEDULE_ENTITY_LIMIT');
  const results = await graph.getSchedule({ organizerGraphUser, schedules, startAt, endAt, intervalMinutes: 30 });
  const byEmail = new Map(results.map((item) => [item.scheduleId.toLowerCase(), item]));
  return schedules.every((email) => {
    const schedule = byEmail.get(email);
    return Boolean(schedule && scheduleFree(schedule.availabilityView));
  });
}

export async function recurringMeetingLifecycleV1Routes(app: FastifyInstance): Promise<void> {
  const graph = new MicrosoftGraphAvailabilityClient();
  app.addHook('onClose', async () => graph.close());

  app.put('/api/v1/meetings-v3/recurring/:seriesId/reschedule', { preHandler: [authenticate, resolveActor] }, async (request, reply) => {
    const params = seriesParams.safeParse(request.params); const body = rescheduleSchema.safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: 'validation_error' });
    const actor = request.actor!;
    const prepared = await withTenant(actor.tenantId, async (tx) => {
      const series = await getSeries(tx, actor.tenantId, params.data.seriesId);
      if (!series) return { kind:'missing' as const };
      const canManage = await canManageWorkspace(tx, actor, series.workspace_id);
      if (!canManage && series.organizer_user_id !== actor.userId) return { kind:'forbidden' as const };
      if (series.lifecycle_status !== 'SCHEDULED') return { kind:'not-scheduled' as const };
      if (series.master_version !== body.data.version) return { kind:'version-conflict' as const };
      const occurrences = await tx.$queryRaw<OccurrenceRow[]>(Prisma.sql`
        SELECT id, series_id, sequence, occurrence_date, original_start_at, start_at, end_at, version, lifecycle_status, is_exception, graph_event_id
        FROM meeting_recurrence_occurrences_v1 WHERE tenant_id=${actor.tenantId}::uuid AND series_id=${series.id}::uuid ORDER BY sequence
      `);
      if (occurrences.some((item) => item.is_exception || item.lifecycle_status !== 'SCHEDULED')) return { kind:'has-exceptions' as const };
      const schedules = await schedulesForSeries(tx, actor.tenantId, series);
      return { kind:'ready' as const, series, occurrences, schedules };
    });
    if (prepared.kind==='missing') return reply.code(404).send({error:'recurring_series_not_found'});
    if (prepared.kind==='forbidden') return reply.code(403).send({error:'recurring_series_update_denied'});
    if (prepared.kind==='not-scheduled') return reply.code(409).send({error:'recurring_series_not_scheduled'});
    if (prepared.kind==='version-conflict') return reply.code(409).send({error:'version_conflict'});
    if (prepared.kind==='has-exceptions') return reply.code(409).send({error:'series_has_exceptions_v1', message:'Recurring Meetings V1 only reschedules the whole series before individual exceptions/cancellations exist.'});

    const first = prepared.occurrences[0]!;
    if (limaDateKey(body.data.startAt) !== limaDateKey(first.start_at)) return reply.code(409).send({error:'series_reschedule_date_change_not_supported_v1'});
    const deltaMs = body.data.startAt.getTime() - first.start_at.getTime();
    const durationMs = body.data.endAt.getTime() - body.data.startAt.getTime();
    const planned = prepared.occurrences.map((item) => ({ ...item, nextStart:new Date(item.start_at.getTime()+deltaMs), nextEnd:new Date(item.start_at.getTime()+deltaMs+durationMs) }));
    if (planned.some((item) => limaDateKey(item.nextStart)!==limaDateKey(item.start_at) || limaDateKey(item.nextEnd)!==limaDateKey(item.end_at))) {
      return reply.code(409).send({error:'series_reschedule_crosses_occurrence_date_v1'});
    }
    const mustSync = Boolean(prepared.series.graph_event_id) || body.data.requestM365Sync;
    if (mustSync && !(config.M365_CALENDAR_SYNC_ENABLED && config.MEETING_CALENDAR_WORKER_AVAILABLE)) return reply.code(409).send({error:'m365_calendar_sync_unavailable'});
    if (mustSync && !config.M365_AVAILABILITY_ENABLED) return reply.code(409).send({error:'m365_availability_disabled'});
    if (mustSync && prepared.series.graph_event_id && intervalsOverlap(first.start_at, first.end_at, body.data.startAt, body.data.endAt)) {
      return reply.code(409).send({error:'series_reschedule_partial_overlap_requires_nonoverlap_v1'});
    }
    if (mustSync) {
      try {
        for (const item of planned) {
          const free = await validateGraphSlot(graph, prepared.series.organizer_graph_user, actor.email, prepared.schedules, item.nextStart, item.nextEnd);
          if (!free) return reply.code(409).send({error:'recurring_meeting_slot_conflict', sequence:item.sequence});
        }
      } catch (error) {
        if (error instanceof Error && error.message==='M365_GETSCHEDULE_ENTITY_LIMIT') return reply.code(409).send({error:'m365_getschedule_entity_limit'});
        if (error instanceof MicrosoftGraphAvailabilityConfigurationError) return reply.code(409).send({error:'m365_availability_disabled'});
        if (error instanceof MicrosoftGraphAvailabilityError) return reply.code(error.retryable?503:502).send({error:'m365_availability_failed'});
        throw error;
      }
    }

    return withTenant(actor.tenantId, async (tx) => {
      const objectUpdated = await tx.nexusObject.updateMany({ where:{ id:prepared.series.master_meeting_object_id, tenantId:actor.tenantId, version:body.data.version, deletedAt:null }, data:{ startDate:body.data.startAt, dueDate:body.data.endAt, version:{increment:1} } });
      if (objectUpdated.count!==1) return reply.code(409).send({error:'version_conflict'});
      for (const item of planned) {
        await tx.$executeRaw(Prisma.sql`
          UPDATE meeting_recurrence_occurrences_v1 SET start_at=${item.nextStart}, end_at=${item.nextEnd}, version=version+1, updated_at=CURRENT_TIMESTAMP
          WHERE tenant_id=${actor.tenantId}::uuid AND id=${item.id}::uuid
        `);
      }
      const nextSync = mustSync?'PENDING':'LOCAL_ONLY';
      await tx.$executeRaw(Prisma.sql`
        UPDATE meeting_collaboration_v1 SET start_at=${body.data.startAt}, end_at=${body.data.endAt},
          location=${body.data.location===undefined?prepared.series.location:body.data.location}, sync_status=${nextSync}::"MeetingM365SyncStatusV1", sync_error=NULL, updated_at=CURRENT_TIMESTAMP
        WHERE tenant_id=${actor.tenantId}::uuid AND id=${prepared.series.meeting_collaboration_id}::uuid
      `);
      if (mustSync) await tx.domainEvent.create({data:{tenantId:actor.tenantId,aggregateId:prepared.series.master_meeting_object_id,eventType:'bridata.meeting.m365.sync.requested',payload:{collaborationId:prepared.series.meeting_collaboration_id,meetingObjectId:prepared.series.master_meeting_object_id,reason:'recurring_series_rescheduled_v1'}}});
      await tx.auditLog.create({data:{tenantId:actor.tenantId,userId:actor.userId,action:'RECURRING_SERIES_RESCHEDULED_V1',resource:'NEXUS_OBJECT',resourceId:prepared.series.master_meeting_object_id,correlationId:request.id,ipAddress:request.ip,details:{seriesId:prepared.series.id,occurrenceCount:planned.length,syncRequested:mustSync}}});
      return {seriesId:prepared.series.id,masterMeetingObjectId:prepared.series.master_meeting_object_id,version:body.data.version+1,syncStatus:nextSync};
    });
  });

  app.put('/api/v1/meetings-v3/recurring/:seriesId/occurrences/:occurrenceId', { preHandler:[authenticate,resolveActor] }, async (request,reply) => {
    const params=occurrenceParams.safeParse(request.params); const body=rescheduleSchema.safeParse(request.body);
    if(!params.success||!body.success) return reply.code(400).send({error:'validation_error'});
    const actor=request.actor!;
    const prepared=await withTenant(actor.tenantId,async(tx)=>{
      const series=await getSeries(tx,actor.tenantId,params.data.seriesId); if(!series)return{kind:'missing-series' as const};
      const canManage=await canManageWorkspace(tx,actor,series.workspace_id); if(!canManage&&series.organizer_user_id!==actor.userId)return{kind:'forbidden' as const};
      if(series.lifecycle_status!=='SCHEDULED')return{kind:'series-not-scheduled' as const};
      const occurrence=await getOccurrence(tx,actor.tenantId,series.id,params.data.occurrenceId); if(!occurrence)return{kind:'missing-occurrence' as const};
      if(occurrence.lifecycle_status!=='SCHEDULED')return{kind:'occurrence-not-scheduled' as const};
      if(occurrence.version!==body.data.version)return{kind:'version-conflict' as const};
      const neighbors=await tx.$queryRaw<Array<{sequence:number;start_at:Date}>>(Prisma.sql`
        SELECT sequence,start_at FROM meeting_recurrence_occurrences_v1
        WHERE tenant_id=${actor.tenantId}::uuid AND series_id=${series.id}::uuid AND sequence IN (${occurrence.sequence-1},${occurrence.sequence+1})
      `);
      const schedules=await schedulesForSeries(tx,actor.tenantId,series);
      return{kind:'ready' as const,series,occurrence,neighbors,schedules};
    });
    if(prepared.kind==='missing-series')return reply.code(404).send({error:'recurring_series_not_found'});
    if(prepared.kind==='missing-occurrence')return reply.code(404).send({error:'recurring_occurrence_not_found'});
    if(prepared.kind==='forbidden')return reply.code(403).send({error:'recurring_occurrence_update_denied'});
    if(prepared.kind==='series-not-scheduled'||prepared.kind==='occurrence-not-scheduled')return reply.code(409).send({error:'recurring_occurrence_not_schedulable'});
    if(prepared.kind==='version-conflict')return reply.code(409).send({error:'version_conflict'});
    const newDate=limaDateKey(body.data.startAt);
    const previous=prepared.neighbors.find((item)=>item.sequence===prepared.occurrence.sequence-1);
    const next=prepared.neighbors.find((item)=>item.sequence===prepared.occurrence.sequence+1);
    if(previous&&newDate<=limaDateKey(previous.start_at))return reply.code(409).send({error:'occurrence_crosses_previous_boundary'});
    if(next&&newDate>=limaDateKey(next.start_at))return reply.code(409).send({error:'occurrence_crosses_next_boundary'});
    const mustSync=Boolean(prepared.series.graph_event_id)||body.data.requestM365Sync;
    if(mustSync&&!(config.M365_CALENDAR_SYNC_ENABLED&&config.MEETING_CALENDAR_WORKER_AVAILABLE))return reply.code(409).send({error:'m365_calendar_sync_unavailable'});
    if(mustSync&&!config.M365_AVAILABILITY_ENABLED)return reply.code(409).send({error:'m365_availability_disabled'});
    if(mustSync&&prepared.series.graph_event_id&&intervalsOverlap(prepared.occurrence.start_at,prepared.occurrence.end_at,body.data.startAt,body.data.endAt))return reply.code(409).send({error:'occurrence_partial_overlap_requires_nonoverlap_v1'});
    if(mustSync){
      try{const free=await validateGraphSlot(graph,prepared.series.organizer_graph_user,actor.email,prepared.schedules,body.data.startAt,body.data.endAt);if(!free)return reply.code(409).send({error:'recurring_meeting_slot_conflict'});}
      catch(error){if(error instanceof Error&&error.message==='M365_GETSCHEDULE_ENTITY_LIMIT')return reply.code(409).send({error:'m365_getschedule_entity_limit'});if(error instanceof MicrosoftGraphAvailabilityConfigurationError)return reply.code(409).send({error:'m365_availability_disabled'});if(error instanceof MicrosoftGraphAvailabilityError)return reply.code(error.retryable?503:502).send({error:'m365_availability_failed'});throw error;}
    }
    return withTenant(actor.tenantId,async(tx)=>{
      const updated=await tx.$executeRaw(Prisma.sql`
        UPDATE meeting_recurrence_occurrences_v1 SET occurrence_date=${newDate}::date,start_at=${body.data.startAt},end_at=${body.data.endAt},
          version=version+1,is_exception=true,updated_at=CURRENT_TIMESTAMP
        WHERE tenant_id=${actor.tenantId}::uuid AND id=${prepared.occurrence.id}::uuid AND version=${body.data.version} AND lifecycle_status='SCHEDULED'
      `);
      if(updated!==1)return reply.code(409).send({error:'version_conflict'});
      if(mustSync)await tx.domainEvent.create({data:{tenantId:actor.tenantId,aggregateId:prepared.series.master_meeting_object_id,eventType:'bridata.meeting.recurrence.occurrence.sync.requested',payload:{seriesId:prepared.series.id,occurrenceId:prepared.occurrence.id,collaborationId:prepared.series.meeting_collaboration_id,location:body.data.location===undefined?prepared.series.location:body.data.location}}});
      await tx.auditLog.create({data:{tenantId:actor.tenantId,userId:actor.userId,action:'RECURRING_OCCURRENCE_RESCHEDULED_V1',resource:'MEETING_RECURRENCE_OCCURRENCE_V1',resourceId:prepared.occurrence.id,correlationId:request.id,ipAddress:request.ip,details:{seriesId:prepared.series.id,previousStartAt:prepared.occurrence.start_at.toISOString(),startAt:body.data.startAt.toISOString(),syncRequested:mustSync}}});
      return{seriesId:prepared.series.id,occurrenceId:prepared.occurrence.id,version:body.data.version+1,lifecycleStatus:'SCHEDULED',syncRequested:mustSync};
    });
  });

  app.post('/api/v1/meetings-v3/recurring/:seriesId/occurrences/:occurrenceId/cancel', {preHandler:[authenticate,resolveActor]}, async(request,reply)=>{
    const params=occurrenceParams.safeParse(request.params);const body=cancelSchema.safeParse(request.body);if(!params.success||!body.success)return reply.code(400).send({error:'validation_error'});
    const actor=request.actor!;
    return withTenant(actor.tenantId,async(tx)=>{
      const series=await getSeries(tx,actor.tenantId,params.data.seriesId);if(!series)return reply.code(404).send({error:'recurring_series_not_found'});
      const canManage=await canManageWorkspace(tx,actor,series.workspace_id);if(!canManage&&series.organizer_user_id!==actor.userId)return reply.code(403).send({error:'recurring_occurrence_cancel_denied'});
      const occurrence=await getOccurrence(tx,actor.tenantId,series.id,params.data.occurrenceId);if(!occurrence)return reply.code(404).send({error:'recurring_occurrence_not_found'});
      if(occurrence.lifecycle_status==='CANCELLED')return{seriesId:series.id,occurrenceId:occurrence.id,lifecycleStatus:'CANCELLED',alreadyCancelled:true};
      if(occurrence.lifecycle_status==='CANCEL_PENDING')return{seriesId:series.id,occurrenceId:occurrence.id,lifecycleStatus:'CANCEL_PENDING',alreadyCancelled:false};
      if(occurrence.version!==body.data.version)return reply.code(409).send({error:'version_conflict'});
      const external=Boolean(series.graph_event_id);
      const lifecycle=external?'CANCEL_PENDING':'CANCELLED';
      const updated=await tx.$executeRaw(Prisma.sql`
        UPDATE meeting_recurrence_occurrences_v1 SET lifecycle_status=${lifecycle}::"MeetingLifecycleStatusV2",version=version+1,is_exception=true,
          cancellation_comment=${body.data.comment??null},cancelled_at=${external?null:new Date()},updated_at=CURRENT_TIMESTAMP
        WHERE tenant_id=${actor.tenantId}::uuid AND id=${occurrence.id}::uuid AND version=${body.data.version}
      `);if(updated!==1)return reply.code(409).send({error:'version_conflict'});
      if(external)await tx.domainEvent.create({data:{tenantId:actor.tenantId,aggregateId:series.master_meeting_object_id,eventType:'bridata.meeting.recurrence.occurrence.cancel.requested',payload:{seriesId:series.id,occurrenceId:occurrence.id,collaborationId:series.meeting_collaboration_id,comment:body.data.comment??null}}});
      await tx.auditLog.create({data:{tenantId:actor.tenantId,userId:actor.userId,action:'RECURRING_OCCURRENCE_CANCELLED_V1',resource:'MEETING_RECURRENCE_OCCURRENCE_V1',resourceId:occurrence.id,correlationId:request.id,ipAddress:request.ip,details:{seriesId:series.id,lifecycleStatus:lifecycle,externalCancellationRequested:external}}});
      return{seriesId:series.id,occurrenceId:occurrence.id,version:body.data.version+1,lifecycleStatus:lifecycle};
    });
  });

  app.post('/api/v1/meetings-v3/recurring/:seriesId/cancel', {preHandler:[authenticate,resolveActor]}, async(request,reply)=>{
    const params=seriesParams.safeParse(request.params);const body=cancelSchema.safeParse(request.body);if(!params.success||!body.success)return reply.code(400).send({error:'validation_error'});
    const actor=request.actor!;
    return withTenant(actor.tenantId,async(tx)=>{
      const series=await getSeries(tx,actor.tenantId,params.data.seriesId);if(!series)return reply.code(404).send({error:'recurring_series_not_found'});
      const canManage=await canManageWorkspace(tx,actor,series.workspace_id);if(!canManage&&series.organizer_user_id!==actor.userId)return reply.code(403).send({error:'recurring_series_cancel_denied'});
      if(series.lifecycle_status==='CANCELLED')return{seriesId:series.id,lifecycleStatus:'CANCELLED',alreadyCancelled:true};
      if(series.lifecycle_status==='CANCEL_PENDING')return{seriesId:series.id,lifecycleStatus:'CANCEL_PENDING',alreadyCancelled:false};
      if(series.master_version!==body.data.version)return reply.code(409).send({error:'version_conflict'});
      const objectUpdated=await tx.nexusObject.updateMany({where:{id:series.master_meeting_object_id,tenantId:actor.tenantId,version:body.data.version,deletedAt:null},data:{status:'CANCELLED',version:{increment:1}}});if(objectUpdated.count!==1)return reply.code(409).send({error:'version_conflict'});
      const external=Boolean(series.graph_event_id);const lifecycle=external?'CANCEL_PENDING':'CANCELLED';const sync=external?'PENDING':'LOCAL_ONLY';
      await tx.$executeRaw(Prisma.sql`
        UPDATE meeting_collaboration_v1 SET lifecycle_status=${lifecycle}::"MeetingLifecycleStatusV2",sync_status=${sync}::"MeetingM365SyncStatusV1",
          cancelled_at=${external?null:new Date()},cancelled_by=${actor.userId}::uuid,cancellation_comment=${body.data.comment??null},sync_error=NULL,updated_at=CURRENT_TIMESTAMP
        WHERE tenant_id=${actor.tenantId}::uuid AND id=${series.meeting_collaboration_id}::uuid
      `);
      if(external)await tx.domainEvent.create({data:{tenantId:actor.tenantId,aggregateId:series.master_meeting_object_id,eventType:'bridata.meeting.m365.cancel.requested',payload:{collaborationId:series.meeting_collaboration_id,meetingObjectId:series.master_meeting_object_id}}});
      await tx.auditLog.create({data:{tenantId:actor.tenantId,userId:actor.userId,action:'RECURRING_SERIES_CANCELLED_V1',resource:'NEXUS_OBJECT',resourceId:series.master_meeting_object_id,correlationId:request.id,ipAddress:request.ip,details:{seriesId:series.id,lifecycleStatus:lifecycle,externalCancellationRequested:external}}});
      return{seriesId:series.id,masterMeetingObjectId:series.master_meeting_object_id,version:body.data.version+1,lifecycleStatus:lifecycle,syncStatus:sync};
    });
  });
}
